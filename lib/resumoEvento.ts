import { sql } from "@/lib/db";
import { partiesDoEvento } from "@/lib/party";
import { getPreset } from "@/lib/intencaoPreset";
import { historicoLotes, type LoteResumo } from "@/lib/loteDM";
import { getGuildMeta } from "@/lib/guildConfig";
import type { Tier } from "@/lib/tier";

/**
 * O evento inteiro numa leitura só — a "folha da guerra".
 *
 * Existe porque a informação do evento está espalhada por abas que servem pra TRABALHAR (arrastar,
 * conferir, gravar). Depois que a war acaba, ninguém quer trabalhar: quer olhar. Aqui é só leitura,
 * numa página que cabe num print e responde "o que aconteceu nessa guerra" sem clique nenhum.
 *
 * Tudo vem do banco no servidor: nenhuma conta é refeita no cliente, então o resumo não muda de
 * número dependendo de quem abre.
 */
export type LinhaResumo = {
  chave: string; familia: string;
  guilda: string | null; guildaNome: string | null; classe: string | null; gs: number | null; lendario: boolean;
  party: string | null; ordemPt: number | null;
  funcao: string | null;          // o que marcou no bot
  confirmouDm: boolean | null;    // resposta da convocação
  ingame: boolean;                // apareceu na conferência
  jogou: boolean | null;          // tem estatística gravada na war
};

export type ResumoEvento = {
  evento: { id: number; uuid: string; titulo: string; data: string; tipo: string; tier: Tier | null; status: string; resultado: string | null; tamanhoMax: number | null };
  war: { id: number; territorio: string | null; aliancas: string[] } | null;
  presetNome: string | null;
  parties: { id: number; nome: string; icone: string | null; membros: LinhaResumo[] }[];
  foraDePt: LinhaResumo[];        // marcou/apareceu mas não entrou em PT
  totais: { marcaram: number; naoVao: number; escalados: number; aceitaram: number; recusaram: number; recusaramForaDePt: number; semResposta: number; ingame: number; jogaram: number };
  porGuilda: { guilda: string; total: number; lendarios: number }[];
  chamadas: LoteResumo[];
};

export async function resumoEvento(uuid: string): Promise<ResumoEvento | null> {
  const evs = (await sql`
    SELECT e.id::int AS id, e.uuid, COALESCE(e.titulo, e.tipo) AS titulo, e.data::text AS data, e.tipo, e.tier,
           e.status, e.tamanho_max::int AS tamanho_max, COALESCE(e.preset_id, p.preset_id)::int AS preset_id,
           r.resultado, r.war_id::int AS war_id
    FROM evento e
    LEFT JOIN LATERAL (SELECT ip.preset_id FROM intencao_post ip WHERE ip.evento_id = e.id ORDER BY ip.criado DESC LIMIT 1) p ON TRUE
    LEFT JOIN evento_resultado r ON r.evento_id = e.id
    WHERE e.uuid = ${uuid}::uuid LIMIT 1`) as {
      id: number; uuid: string; titulo: string; data: string; tipo: string; tier: Tier | null;
      status: string; tamanho_max: number | null; preset_id: number | null; resultado: string | null; war_id: number | null;
    }[];
  const ev = evs[0];
  if (!ev) return null;

  const [preset, proprias, chamadas, meta, linhas, war, catalogo] = await Promise.all([
    ev.preset_id ? getPreset(ev.preset_id) : Promise.resolve(null),
    partiesDoEvento(ev.id),
    historicoLotes(ev.id, { comAlvos: false }),   // o resumo só mostra o placar; a lista nominal é da aba Chamadas
    getGuildMeta(),
    // uma consulta só junta o funil inteiro por pessoa: escalação, marca na chamada, presença e
    // estatística. Separado daria N+1 e, pior, números que não fecham entre si
    sql`
      SELECT x.chave, x.familia, x.party_id::int AS party_id, x.ordem_pt::int AS ordem_pt, x.confirmou,
             pl.guilda, pl.classe_bdo AS classe, pl.lendario,
             -- GS = (ap+aap)/2 + dp, a MESMA conta de lib/players.perfilGear. Duas fórmulas
             -- diferentes pro mesmo número seria o tipo de divergência que ninguém percebe
             CASE WHEN gb.ap IS NOT NULL AND gb.aap IS NOT NULL AND gb.dp IS NOT NULL
                  THEN round((gb.ap + gb.aap) / 2.0 + gb.dp)::int END AS gs,
             f.nome AS funcao,
             (ep.chave IS NOT NULL) AS ingame,
             CASE WHEN ${ev.war_id}::int IS NULL THEN NULL ELSE (d.nome_familia IS NOT NULL) END AS jogou
      FROM evento_escalacao x
      LEFT JOIN players pl ON pl.nome_familia = x.familia
      LEFT JOIN garmoth_build gb ON gb.nome_familia = x.familia
      LEFT JOIN LATERAL (
        SELECT fu.nome FROM intencao_marca im
        JOIN intencao_post ip ON ip.message_id = im.message_id
        JOIN funcao fu ON fu.id = im.funcao_id
        WHERE ip.evento_id = ${ev.id} AND im.chave = x.chave LIMIT 1) f ON TRUE
      LEFT JOIN evento_presenca ep ON ep.evento_id = ${ev.id} AND ep.chave = x.chave AND ep.participar
      LEFT JOIN LATERAL (SELECT DISTINCT nome_familia FROM desempenho dd WHERE dd.war_id = ${ev.war_id}::int AND dd.nome_familia = x.familia) d ON TRUE
      WHERE x.evento_id = ${ev.id}
      ORDER BY x.party_id NULLS LAST, x.ordem_pt NULLS LAST, x.familia` as Promise<unknown>,
    ev.war_id != null
      ? sql`SELECT war_id::int AS war_id, territorio, COALESCE(aliancas, '{}')::text[] AS aliancas FROM wars WHERE war_id = ${ev.war_id}`
      : Promise.resolve([] as unknown[]),
    sql`SELECT id::int AS id, nome, icone FROM party ORDER BY ordem, id` as Promise<unknown>,
  ]);

  const rows = linhas as {
    chave: string; familia: string; party_id: number | null; ordem_pt: number | null; confirmou: boolean | null;
    guilda: string | null; classe: string | null; lendario: boolean | null; gs: number | null;
    funcao: string | null; ingame: boolean; jogou: boolean | null;
  }[];
  const pcat = catalogo as { id: number; nome: string; icone: string | null }[];
  const w = (war as { war_id: number; territorio: string | null; aliancas: string[] }[])[0] ?? null;

  // o id da guilda (MANI/OSSD) é chave de banco, não rótulo de tela — resolve pelo nome configurado.
  // Declarado ANTES de `vm`: ele é chamado logo abaixo, e um const declarado depois estouraria em
  // "Cannot access before initialization" — que o tsc não pega.
  const nomeGuilda = new Map(meta.guildas.map((g) => [g.id, g.nome]));

  const vm = (r: (typeof rows)[number]): LinhaResumo => ({
    chave: r.chave, familia: r.familia, guilda: r.guilda, classe: r.classe, gs: r.gs, lendario: !!r.lendario,
    guildaNome: r.guilda ? nomeGuilda.get(r.guilda) ?? r.guilda : null,
    party: pcat.find((p) => p.id === r.party_id)?.nome ?? null, ordemPt: r.ordem_pt,
    funcao: r.funcao, confirmouDm: r.confirmou, ingame: r.ingame, jogou: r.jogou,
  });

  const ordem = proprias ?? (preset?.parties ?? []).map((v) => v.party_id);
  const parties = ordem
    .map((id) => pcat.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ id: p.id, nome: p.nome, icone: p.icone, membros: rows.filter((r) => r.party_id === p.id).map(vm) }));
  // party_id apontando pra PT que NÃO está mais na lista do evento também cai aqui: senão a pessoa
  // some da tela e continua contando nos totais — o pior dos dois mundos
  const conhecidas = new Set(parties.map((p) => p.id));
  const foraDePt = rows.filter((r) => r.party_id == null || !conhecidas.has(r.party_id)).map(vm);

  // "marcaram" e "não vão" vêm da CHAMADA, não da escalação: quem marcou e não foi escalado não
  // tem linha em evento_escalacao, e contar por ali esconderia justamente quem ficou de fora
  const [c] = (await sql`
    SELECT
      (SELECT count(DISTINCT im.chave)::int FROM intencao_marca im JOIN intencao_post ip ON ip.message_id = im.message_id WHERE ip.evento_id = ${ev.id}) AS marcaram,
      (SELECT count(*)::int FROM intencao_resp ir JOIN intencao_post ip ON ip.message_id = ir.message_id WHERE ip.evento_id = ${ev.id} AND ir.resposta = 'nao') AS nao_vao
  `) as { marcaram: number; nao_vao: number }[];

  // MESMA população que as PTs desenhadas: com `party_id != null` puro, quem está numa PT que saiu
  // da lista contaria nos totais e ainda apareceria em "fora de PT" — somando duas vezes
  const escalados = rows.filter((r) => r.party_id != null && conhecidas.has(r.party_id));
  const porGuildaMap = new Map<string, { total: number; lendarios: number }>();
  for (const r of escalados) {
    const k = (r.guilda && (nomeGuilda.get(r.guilda) ?? r.guilda)) || "sem guilda";
    const v = porGuildaMap.get(k) ?? { total: 0, lendarios: 0 };
    v.total++; if (r.lendario) v.lendarios++;
    porGuildaMap.set(k, v);
  }

  return {
    evento: { id: ev.id, uuid: ev.uuid, titulo: ev.titulo, data: ev.data, tipo: ev.tipo, tier: ev.tier, status: ev.status, resultado: ev.resultado, tamanhoMax: ev.tamanho_max ?? preset?.tamanho_max ?? null },
    war: w ? { id: w.war_id, territorio: w.territorio, aliancas: w.aliancas ?? [] } : null,
    presetNome: preset?.nome ?? null,
    parties, foraDePt,
    totais: {
      marcaram: c?.marcaram ?? 0, naoVao: c?.nao_vao ?? 0,
      escalados: escalados.length,
      aceitaram: escalados.filter((r) => r.confirmou === true).length,
      // sobre ESCALADOS, como os vizinhos: contar sobre todas as linhas fazia
      // aceitaram+recusaram+semResposta passar do total de escalados e o card não fechar
      recusaram: escalados.filter((r) => r.confirmou === false).length,
      recusaramForaDePt: rows.filter((r) => r.party_id == null && r.confirmou === false).length,
      semResposta: escalados.filter((r) => r.confirmou == null).length,
      ingame: escalados.filter((r) => r.ingame).length,
      jogaram: rows.filter((r) => r.jogou === true).length,
    },
    porGuilda: [...porGuildaMap.entries()].map(([guilda, v]) => ({ guilda, ...v })).sort((a, b) => b.total - a.total),
    chamadas,
  };
}
