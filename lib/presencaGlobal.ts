import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import { sinais, type EstadoWar } from "@/lib/historicoSemana";

/**
 * GRADE GLOBAL DE PRESENÇA — uma linha por jogador, uma coluna por evento do período.
 *
 * O histórico do card responde "como está o Fulano". Esta tela responde a outra pergunta, que é a
 * da staff antes da guerra: "quem tem aparecido?" — o mesmo dado lido pela transversal, com o
 * elenco inteiro de uma guilda à vista de uma vez.
 *
 * O ESTADO DE CADA CÉLULA É O MESMO dos quadradinhos, e vem da MESMA função (`sinais` de
 * lib/historicoSemana). Reimplementar aqui daria duas definições de "marcou" e "faltou" que só
 * divergiriam no dia em que uma das duas mudasse.
 *
 * Uma diferença deliberada em relação ao card: aqui entram TODOS os tipos de guerra e também os
 * eventos ABERTOS. No card, evento aberto não vira quadrado, porque lá a pergunta é sobre histórico
 * fechado e "marcou e não foi escalado" a meio caminho parecia acusação. Aqui é o contrário: o que
 * se quer ver é justamente o que está em andamento.
 */
export type ColunaPresenca = {
  eventoId: number;
  titulo: string;
  tipo: string;
  data: string;
  status: string;
  temWar: boolean;
};

export type LinhaPresenca = {
  chave: string;
  familia: string;
  guilda: string;
  /** Um estado por coluna, na mesma ordem de `colunas`. */
  celulas: EstadoWar[];
  /** Quantas vezes JOGOU no período — é por isso que a staff ordena. */
  jogou: number;
  /** Está no provisório do evento escolhido. */
  provisorio: boolean;
  /**
   * Marcou uma função na chamada do bot DO EVENTO ESCOLHIDO pro provisório.
   *
   * Só faz sentido com um evento aberto selecionado, e é por isso que não é uma coluna: é um dado
   * do EVENTO que se está montando, não do período. Fora dessa seleção, sempre false.
   */
  marcouBot: boolean;
};

export type GradePresenca = {
  colunas: ColunaPresenca[];
  linhas: LinhaPresenca[];
  guildas: string[];
  /** Eventos ainda ABERTOS, pra escolher de qual se está montando o provisório. */
  abertos: { eventoId: number; titulo: string; data: string; tipo: string }[];
};

export async function gradePresenca(o: {
  de: string; ate: string; guilda?: string | null; eventoProvisorio?: number | null;
}): Promise<GradePresenca> {
  const de = /^\d{4}-\d{2}-\d{2}$/.test(o.de) ? o.de : null;
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(o.ate) ? o.ate : null;
  if (!de || !ate) return { colunas: [], linhas: [], guildas: [], abertos: [] };

  const evs = (await sql`
    SELECT e.id::int AS "eventoId", COALESCE(e.titulo, e.tipo) AS titulo, e.tipo,
           e.data::text AS data, e.status, (r.war_id IS NOT NULL) AS "temWar"
    FROM evento e LEFT JOIN evento_resultado r ON r.evento_id = e.id
    WHERE e.data BETWEEN ${de}::date AND ${ate}::date
    ORDER BY e.data, e.id`) as ColunaPresenca[];

  const [players, abertos, prov, marcasEvento] = (await Promise.all([
    // ATIVOS apenas: a grade é ferramenta de montar guerra, e ex-membro não entra em guerra nenhuma
    sql`SELECT nome_familia, guilda, registrado_em::text AS registrado_em FROM players
        WHERE ativo ORDER BY nome_familia`,
    sql`SELECT id::int AS "eventoId", COALESCE(titulo, tipo) AS titulo, data::text AS data, tipo
        FROM evento WHERE status <> 'finalizado' ORDER BY data DESC, id DESC LIMIT 20`,
    o.eventoProvisorio
      ? sql`SELECT chave FROM evento_provisorio WHERE evento_id = ${o.eventoProvisorio}`
      : Promise.resolve([] as { chave: string }[]),
    // quem marcou no bot NESTE evento. Vem separado de `sinais` de propósito: aquele apura o período
    // inteiro pra pintar quadrado, e o evento escolhido pode nem estar dentro do período.
    o.eventoProvisorio
      ? sql`SELECT DISTINCT im.chave FROM intencao_marca im
            JOIN intencao_post ip ON ip.message_id = im.message_id
            WHERE ip.evento_id = ${o.eventoProvisorio}`
      : Promise.resolve([] as { chave: string }[]),
  ])) as [
    { nome_familia: string; guilda: string; registrado_em: string | null }[],
    { eventoId: number; titulo: string; data: string; tipo: string }[],
    { chave: string }[],
    { chave: string }[],
  ];

  const guildas = [...new Set(players.map((p) => p.guilda))].sort();
  const alvo = o.guilda && guildas.includes(o.guilda) ? o.guilda : null;
  const doFiltro = alvo ? players.filter((p) => p.guilda === alvo) : players;

  const s = await sinais(evs.map((e) => e.eventoId));
  const desde = new Map(players.map((p) => [chaveNome(p.nome_familia), p.registrado_em]));
  const provSet = new Set(prov.map((r) => r.chave));
  const marcouSet = new Set(marcasEvento.map((r) => r.chave));

  /**
   * A MESMA ordem de testes do card (lib/historicoSemana): quem jogou jogou, e quem não tinha
   * estatística nunca "faltou". O silêncio só conta contra quem já estava aqui para responder —
   * `registrado_em` posterior à data do evento vira "sem", não "não respondeu".
   */
  const estado = (chave: string, e: ColunaPresenca): EstadoWar => {
    const k = `${e.eventoId}|${chave}`;
    if (s.jogou.has(k)) return s.escalado.has(k) ? "jogou" : "jogou_sem_escala";
    if (s.escalado.has(k)) return e.temWar ? "faltou" : "sem_stat";
    if (s.recusou.has(k)) return "recusou";
    if (s.marcou.has(k)) return "marcou";
    const reg = desde.get(chave);
    if (reg && reg.slice(0, 10) > e.data) return "sem";
    return desde.has(chave) ? "nao_respondeu" : "sem";
  };

  const linhas: LinhaPresenca[] = doFiltro.map((p) => {
    const chave = chaveNome(p.nome_familia);
    const celulas = evs.map((e) => estado(chave, e));
    return {
      chave, familia: p.nome_familia, guilda: p.guilda, celulas,
      jogou: celulas.filter((c) => c === "jogou" || c === "jogou_sem_escala").length,
      provisorio: provSet.has(chave),
      marcouBot: marcouSet.has(chave),
    };
  });

  return { colunas: evs, linhas, guildas, abertos };
}

/** Liga/desliga o provisório de alguém num evento. Devolve o estado que ficou gravado. */
export async function marcarProvisorio(eventoId: number, familia: string, marcar: boolean): Promise<{ ok: boolean; provisorio: boolean }> {
  const nome = (familia ?? "").trim();
  if (!nome || !Number.isFinite(eventoId)) return { ok: false, provisorio: false };
  const chave = chaveNome(nome);
  if (!chave) return { ok: false, provisorio: false };
  if (marcar) {
    await sql`INSERT INTO evento_provisorio (evento_id, chave, familia) VALUES (${eventoId}, ${chave}, ${nome})
              ON CONFLICT (evento_id, chave) DO UPDATE SET familia = EXCLUDED.familia`;
    return { ok: true, provisorio: true };
  }
  await sql`DELETE FROM evento_provisorio WHERE evento_id = ${eventoId} AND chave = ${chave}`;
  return { ok: true, provisorio: false };
}

/** As chaves marcadas como provisório num evento — o que a escalação usa pra pintar o card. */
export async function provisoriosDoEvento(eventoId: number): Promise<string[]> {
  return ((await sql`SELECT chave FROM evento_provisorio WHERE evento_id = ${eventoId}`) as { chave: string }[]).map((r) => r.chave);
}
