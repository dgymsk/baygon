import { sql } from "@/lib/db";
import { listFuncoes } from "@/lib/funcao";
import { listParties } from "@/lib/party";
import { getPreset, listPresets, listPlayerFuncoes } from "@/lib/intencaoPreset";
import { desempenhoDaWar, aliancasDaWar } from "@/lib/eventos";
import { getMarcas, getRespostasInt } from "@/lib/intencao";
import { getEscalacao } from "@/lib/escalacao";
import { getPresenca } from "@/lib/presencaEvento";
import { faltasPorChave } from "@/lib/faltas";
import { perfilGear, listPlayers } from "@/lib/players";
import { getGuildMeta } from "@/lib/guildConfig";
import { getEmojiMapResolvido } from "@/lib/emojiConfig";
import { canEditNow } from "@/lib/requireAuth";
import { chaveNome } from "@/lib/nomes";
import { filaDaChamada } from "@/lib/threadChamada";
import type { Tier } from "@/lib/tier";
import EventoBoard, { type JogadorVM, type GrupoVM, type PartyVM } from "./EventoBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Evento · BAYGON" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function HubEventoPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  // o ::uuid do Postgres estoura 500 com texto malformado; barrar antes é mais barato que um try
  if (!UUID_RE.test(uuid)) return <EventoBoard evento={null} grupos={[]} parties={[]} envolvidos={[]} canEdit={false} guildas={[]} />;

  // parte do EVENTO, não do post: evento criado à mão (ou pelo bot antigo) também abre aqui.
  // O post, quando existe, é só a origem da chamada — o LATERAL pega o mais recente dele.
  const rows = (await sql`
    SELECT e.id::int AS evento_id, p.message_id, COALESCE(e.preset_id, p.preset_id)::int AS preset_id,
           e.uuid, COALESCE(e.titulo, e.tipo) AS titulo, e.titulo AS titulo_raw, e.tipo, e.tier, e.exige_registro, e.data::text AS data, e.status,
           r.resultado, r.war_id::int AS war_id
    FROM evento e
    LEFT JOIN LATERAL (SELECT ip.message_id, ip.preset_id FROM intencao_post ip
                       WHERE ip.evento_id = e.id ORDER BY ip.criado DESC LIMIT 1) p ON TRUE
    LEFT JOIN evento_resultado r ON r.evento_id = e.id
    WHERE e.uuid = ${uuid}::uuid LIMIT 1
  `) as { evento_id: number; message_id: string | null; preset_id: number | null; uuid: string; titulo: string; titulo_raw: string | null; tipo: string; tier: Tier | null; exige_registro: boolean; data: string; status: string; resultado: string | null; war_id: number | null }[];

  const ev = rows[0];
  if (!ev) {
    return <EventoBoard evento={null} grupos={[]} parties={[]} envolvidos={[]} canEdit={false} guildas={[]} />;
  }
  const temChamada = ev.message_id != null;

  const [preset, funcoes, parties, marcas, respostas, escalacao, presenca, faltas, perfil, players, meta, canEdit, presets, emojiMap, statsIniciais, aliancasIniciais, vizinhos, playerFuncoes, fila] = await Promise.all([
    ev.preset_id ? getPreset(ev.preset_id) : Promise.resolve(null),
    listFuncoes(), listParties(),
    // sem chamada não há mensagem pra consultar — o tipo vazio precisa vir anotado, senão vira never[]
    ev.message_id ? getMarcas(ev.message_id) : Promise.resolve([] as Awaited<ReturnType<typeof getMarcas>>),
    ev.message_id ? getRespostasInt(ev.message_id) : Promise.resolve([] as Awaited<ReturnType<typeof getRespostasInt>>),
    getEscalacao(ev.evento_id), getPresenca(ev.evento_id), faltasPorChave(), perfilGear(), listPlayers(),
    getGuildMeta(), canEditNow(), listPresets(), getEmojiMapResolvido(),
    ev.war_id != null ? desempenhoDaWar(ev.war_id) : Promise.resolve([]), // pré-carrega a tabela de stats
    ev.war_id != null ? aliancasDaWar(ev.war_id) : Promise.resolve([] as string[]),
    // vizinhos p/ navegar sem voltar ao hub (mais recente → mais antigo). Todos os eventos: filtrar
    // pelos que tiveram chamada deixava o <select> exibindo o nome de OUTRO evento quando o atual
    // não estava na lista.
    sql`SELECT e.uuid, COALESCE(e.titulo, e.tipo) AS titulo, e.data::text AS data, e.status
        FROM evento e ORDER BY e.data DESC, e.criado DESC, e.id DESC LIMIT 40`,
    listPlayerFuncoes(), // pool de quem não teve chamada
    // fila de chegada: o "quem marcou primeiro", que agora aparece no card
    ev.message_id ? filaDaChamada(ev.message_id) : Promise.resolve([] as Awaited<ReturnType<typeof filaDaChamada>>),
  ]);
  const vizinhosVM = vizinhos as { uuid: string; titulo: string; data: string; status: string }[];

  const fById = new Map(funcoes.map((f) => [f.id, f]));
  const ordemFuncoes = funcoes.map((f) => f.id); // pool agrupa por TODAS as funções do catálogo
  const presencaPorChave = new Map(presenca.map((p) => [p.chave, p.participar]));
  const escalaPorChave = new Map(escalacao.map((e) => [e.chave, e.party_id]));
  const ordemPtPorChave = new Map(escalacao.map((e) => [e.chave, e.ordem_pt]));
  // confirmou a ESCALAÇÃO (DM): null = não respondeu, true = aceitou, false = recusou
  const confEscPorChave = new Map(escalacao.map((e) => [e.chave, e.confirmou]));
  // convidado_em separa "ainda não foi chamado" de "chamado e sem responder"
  const convidadoPorChave = new Map(escalacao.map((e) => [e.chave, e.convidado_em]));
  const respondeuPorChave = new Map(escalacao.map((e) => [e.chave, e.respondeu_em]));
  const ingamePorChave = new Map(presenca.filter((p) => p.participar).map((p) => [p.chave, p.atualizado]));
  const recusaram = escalacao.filter((e) => e.confirmou === false);
  const lendarioPorChave = new Map(players.map((p) => [chaveNome(p.nome_familia), !!p.lendario]));
  const nomesQueJogaram = ev.war_id
    ? ((await sql`SELECT DISTINCT nome_familia FROM desempenho WHERE war_id = ${ev.war_id}`) as { nome_familia: string }[]).map((d) => d.nome_familia)
    : [];
  const jogaram = ev.war_id ? new Set(nomesQueJogaram.map(chaveNome)) : null;

  // gear e nº de wars pro mini-card do hover
  const rowPorChave = new Map(players.map((p) => [chaveNome(p.nome_familia), p]));
  const funcaoPorUser = new Map(marcas.map((m) => [m.user_id, fById.get(m.funcao_id)?.nome ?? null]));

  const filaPorChave = new Map(fila.map((x) => [x.chave, x]));
  /**
   * FILLER: apareceu na conferência in-game sem ter marcado na chamada. Não é falha de ninguém —
   * é gente que entrou de última hora —, mas precisa ser ESCALÁVEL: sem estar no pool não havia
   * como arrastar pra uma PT, e a lista publicada mostrava "veio sem estar escalado" sem que
   * houvesse ação possível na tela.
   */
  const marcouNaChamada = new Set(respostas.filter((r) => r.resposta === "vai").map((r) => r.chave).filter((c): c is string => !!c));
  const fillerChaves = new Set(
    presenca.filter((p) => p.participar && !marcouNaChamada.has(p.chave)).map((p) => p.chave),
  );

  const vm = (userId: string, familia: string | null, chaveRaw: string | null): JogadorVM => {
    const chave = chaveRaw ?? chaveNome(familia ?? "");
    const p = perfil.get(chave);
    const f = faltas.get(chave);
    const row = rowPorChave.get(chave);
    return {
      chave, familia: familia ?? userId, userId,
      guilda: p?.guilda ?? null, classe: p?.classe ?? null, gs: p?.gs ?? null,
      ap: row?.garmoth?.ap ?? null, aap: row?.garmoth?.aap ?? null, dp: row?.garmoth?.dp ?? null,
      nWars: row?.n_wars ?? null,
      lendario: lendarioPorChave.get(chave) === true,
      confirmouIngame: presencaPorChave.get(chave) === true,
      jogou: jogaram ? jogaram.has(chave) : null,
      escaladoEm: escalaPorChave.get(chave) ?? null,
      confirmouEscalacao: confEscPorChave.get(chave) ?? null,
      convidado: !!convidadoPorChave.get(chave),
      faltas: f && f.avaliados > 0 ? f.sequencia : null,
      diasSemJogar: f && f.avaliados > 0 ? f.diasSemJogar : null,
      diasDesdeFalta: f && f.avaliados > 0 ? f.diasDesdeFalta : null,
      funcaoNome: funcaoPorUser.get(userId) ?? null,
      marcouEm: filaPorChave.get(chave)?.vaiEm ?? null,
      ordem: filaPorChave.get(chave)?.posicao ?? null,
      convidadoEm: convidadoPorChave.get(chave) ?? null,
      respondeuEm: respondeuPorChave.get(chave) ?? null,
      ingameEm: ingamePorChave.get(chave) ?? null,
      ordemPt: ordemPtPorChave.get(chave) ?? null,
      filler: fillerChaves.has(chave),
    };
  };

  const respVai = respostas.filter((r) => r.resposta === "vai");
  const porUser = new Map(respVai.map((r) => [r.user_id, vm(r.user_id, r.familia, r.chave)]));
  // jogador do elenco, sem passar pela chamada: não há user do Discord na origem. Quem precisa
  // do vínculo é a convocação, e ela o resolve no servidor por players.discord_id.
  const vmFam = (familia: string) => vm("", familia, chaveNome(familia));

  /**
   * Pool agrupado por FUNÇÃO. Com chamada, é quem MARCOU (uma função por pessoa — a marca é única
   * por rodada). Sem chamada, é o elenco ativo pelo `player_funcao`: o modelo já diz que a marca é
   * um recorte por rodada desse atributo, então na falta da rodada o atributo é a resposta honesta.
   * Aí uma pessoa com duas funções aparece nas duas — montando o time do zero é exatamente a
   * sobreposição que interessa, e arrastar pra uma PT a tira das duas de uma vez.
   */
  const ativoPorChave = new Map(players.map((p) => [chaveNome(p.nome_familia), p.ativo]));
  const grupos: GrupoVM[] = ordemFuncoes.map((id: number) => {
    const f = fById.get(id);
    const jogadores = (temChamada
      ? marcas.filter((m) => m.funcao_id === id).map((m) => porUser.get(m.user_id)).filter((j): j is JogadorVM => !!j)
      : playerFuncoes.filter((pf) => pf.funcao_id === id && ativoPorChave.get(pf.chave) !== false).map((pf) => vmFam(pf.familia)))
      // ordem de marcação dentro da função: é a fila, e é ela que decide quem tem prioridade.
      // Sem chamada não há fila — cai no alfabético, que ao menos é estável.
      .sort((a, x) => (a.ordem ?? 1e9) - (x.ordem ?? 1e9) || a.familia.localeCompare(x.familia, "pt-BR"));
    return { funcaoId: id, nome: f?.nome ?? `Função ${id}`, emoji: f?.emoji || null, jogadores };
  }).filter((g) => g.jogadores.length > 0); // grupo vazio virava "— todos escalados —", o que é mentira

  // quem não se encaixa em nenhuma função não pode ficar inescalável
  const comFuncao = new Set(playerFuncoes.map((pf) => pf.chave));
  const semFuncao: JogadorVM[] = temChamada
    ? respVai.filter((r) => !marcas.some((m) => m.user_id === r.user_id)).map((r) => porUser.get(r.user_id)!).filter(Boolean)
    : players.filter((p) => p.ativo && !comFuncao.has(chaveNome(p.nome_familia))).map((p) => vmFam(p.nome_familia));
  if (semFuncao.length) {
    grupos.push({ funcaoId: null, nome: temChamada ? "Sem função marcada" : "Sem função", emoji: null, jogadores: semFuncao });
  }

  // grupo próprio no fim do pool: são os que a lista do Discord chama de "vieram sem estar
  // escalados", e agora dá pra arrastar cada um pra uma PT
  const noPoolAte = new Set(grupos.flatMap((g) => g.jogadores.map((j) => j.chave)));
  const fillers = presenca
    .filter((p) => p.participar && fillerChaves.has(p.chave) && !noPoolAte.has(p.chave))
    .map((p) => vmFam(p.familia));
  if (fillers.length) grupos.push({ funcaoId: null, nome: "Filler — vieram sem marcar", emoji: null, jogadores: fillers });

  // colunas da escalação = as PTs DO PRESET, na ordem dele (não o catálogo inteiro)
  const pById = new Map(parties.map((x) => [x.id, x]));
  const partiesVM: PartyVM[] = (preset?.parties ?? []).map((v) => pById.get(v.party_id)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({ id: x.id, nome: x.nome, icone: x.icone || null }));

  /**
   * Todo mundo que o evento já tocou e que o pool não cobre: escalado, quem apareceu no print de
   * presença e quem tem estatística na war. Antes isso saía do próprio pool, então quem fosse
   * escalado e depois tirasse a marca no Discord simplesmente sumia da tela — escalação gravada no
   * banco e invisível.
   */
  const noPool = new Set(grupos.flatMap((g) => g.jogadores.map((j) => j.chave)));
  const fora = new Map<string, string>();
  for (const e of escalacao) fora.set(e.chave, e.familia);
  for (const p of presenca) fora.set(p.chave, p.familia);
  for (const n of nomesQueJogaram) fora.set(chaveNome(n), n);
  const envolvidos = [...fora].filter(([c]) => !noPool.has(c)).map(([, f]) => vmFam(f));

  return (
    <EventoBoard
      evento={{ uuid: ev.uuid, titulo: ev.titulo, tituloRaw: ev.titulo_raw, tipo: ev.tipo, tier: ev.tier, exigeRegistro: ev.exige_registro, data: ev.data, status: ev.status, resultado: ev.resultado, temWar: ev.war_id != null, eventoId: ev.evento_id, messageId: ev.message_id, warId: ev.war_id, presetId: ev.preset_id }}
      grupos={grupos} parties={partiesVM} envolvidos={envolvidos} temChamada={temChamada}
      canEdit={canEdit && ev.status === "aberto"} podeApagar={canEdit} podeRenomear={canEdit} guildas={meta.guildas} emojisClasse={emojiMap.classes}
      recusaram={recusaram.map((e) => e.familia)}
      vizinhos={vizinhosVM} presets={presets.map((p) => ({ id: p.id, nome: p.nome, tipo: p.tipo }))}
      playersNomes={players.map((p) => p.nome_familia)} statsIniciais={statsIniciais} aliancasIniciais={aliancasIniciais}
    />
  );
}
