import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";

/**
 * O histórico recente de cada jogador, do jeito que aparece ao lado do nome no card: SEIS quadrados
 * (as últimas node wars) e UMA bola (a siege mais recente). Serve pra montar escalação com o
 * passado à vista, sem depender da memória de quem está montando.
 *
 * Duas decisões que o desenho impõe:
 *
 * 1. "NÃO RESPONDEU" ≠ "SEM DADO". Silêncio só é silêncio de quem estava lá pra responder. Quem se
 *    registrou depois da guerra não tem culpa nenhuma, e pintá-lo de cinza seria acusação
 *    retroativa — a pior espécie, porque parece dado. Por isso a elegibilidade vem de
 *    `players.registrado_em` (NULL = já estava antes deste controle).
 *
 * 2. "ESCALADO E NÃO JOGOU" exige que a war TENHA estatística. Sem o print gravado ninguém faltou:
 *    a informação não existe, e o X vermelho seria acusação igualmente falsa. Esse caso vira
 *    `sem_stat`.
 *
 * 3. SÓ EVENTO FINALIZADO VIRA QUADRADO. Enquanto o evento está aberto, "marcou e não foi escalado"
 *    é só o retrato de um trabalho em andamento — a escalação ainda vai ser montada, e a pessoa
 *    aparecia de laranja no card como se tivesse ficado de fora. Mesma coisa pro cinza de "não
 *    respondeu": ele ainda tem tempo de responder. A história de alguém só fecha quando a guerra
 *    fecha.
 */
export type EstadoWar =
  | "jogou"          // escalado e jogou — verde
  | "faltou"         // escalado e não apareceu na estatística — X de borda vermelha
  | "jogou_sem_escala" // não escalado e jogou — azul
  | "marcou"         // marcou e não foi escalado — laranja
  | "nao_respondeu"  // estava no elenco e não respondeu a chamada — O cinza
  | "recusou"        // disse que não ia — traço cinza
  | "sem_stat"       // escalado, mas a war não teve estatística gravada
  | "sem"            // não estava no sistema nessa data, ou não houve guerra nesse espaço
  ;

export type WarHistorico = { eventoId: number; data: string; titulo: string; tipo: string; temWar: boolean };
export type HistoricoJogador = { nodewars: EstadoWar[]; siege: EstadoWar | null };
export type HistoricoSemana = {
  /** SEMPRE 6 posições, da mais antiga pra mais recente. `null` = não houve guerra nesse espaço. */
  nodewars: (WarHistorico | null)[];
  siege: WarHistorico | null;
  porChave: Map<string, HistoricoJogador>;
};

const QUADRADOS = 6;

/** Junta as 4 fontes de sinal de um conjunto de eventos, como chaves "eventoId|chaveNome". */
async function sinais(ids: number[]) {
  if (!ids.length) return { marcou: new Set<string>(), recusou: new Set<string>(), escalado: new Set<string>(), jogou: new Set<string>() };
  const arr = ids as unknown as number[];
  const [marcas, recusas, escalados, jogaram] = await Promise.all([
    sql`SELECT ip.evento_id::int AS evento_id, im.chave
        FROM intencao_marca im JOIN intencao_post ip ON ip.message_id = im.message_id
        WHERE ip.evento_id = ANY(${arr})` as Promise<unknown>,
    sql`SELECT ip.evento_id::int AS evento_id, ir.chave
        FROM intencao_resp ir JOIN intencao_post ip ON ip.message_id = ir.message_id
        WHERE ip.evento_id = ANY(${arr}) AND ir.resposta = 'nao'` as Promise<unknown>,
    sql`SELECT evento_id::int AS evento_id, chave FROM evento_escalacao
        WHERE evento_id = ANY(${arr}) AND party_id IS NOT NULL` as Promise<unknown>,
    // a estatística guarda nome de família; a identidade do resto do app é chaveNome — o casamento
    // é feito aqui, com a MESMA função das outras telas, e não com um LOWER() paralelo no SQL
    sql`SELECT r.evento_id::int AS evento_id, d.nome_familia
        FROM evento_resultado r JOIN desempenho d ON d.war_id = r.war_id
        WHERE r.evento_id = ANY(${arr}) GROUP BY r.evento_id, d.nome_familia` as Promise<unknown>,
  ]);
  const monta = (linhas: unknown, campo: "chave" | "nome_familia") => {
    const s = new Set<string>();
    for (const l of linhas as Record<string, string | number>[]) {
      const bruto = String(l[campo] ?? "");
      if (bruto) s.add(`${l.evento_id}|${campo === "chave" ? bruto : chaveNome(bruto)}`);
    }
    return s;
  };
  return {
    marcou: monta(marcas, "chave"), recusou: monta(recusas, "chave"),
    escalado: monta(escalados, "chave"), jogou: monta(jogaram, "nome_familia"),
  };
}

export async function historicoSemana(eventoAtualId: number): Promise<HistoricoSemana> {
  const dataAtual = (await sql`SELECT data::text AS data FROM evento WHERE id = ${eventoAtualId}`) as { data: string }[];
  const corte = dataAtual[0]?.data ?? null;

  /**
   * As 6 últimas node wars ANTES desta, e só as FINALIZADAS.
   *
   * O `e.id <> atual` sozinho não bastava: qualquer outro evento ainda aberto (a node war de
   * amanhã, um evento criado pra semana que vem) já virava quadrado, e todo mundo que tinha
   * marcado nele aparecia de laranja — "marcou e não foi escalado" — antes de a escalação sequer
   * ter sido montada. Com o filtro de status, o `<> atual` vira redundância defensiva: o evento
   * que está sendo montado nunca está finalizado.
   *
   * Os OUTROS tipos (rosas etc.) não entram em quadrado nem em bola: cada linha do histórico é uma
   * série homogênea, e misturar formatos de guerra na mesma sequência tornaria a comparação falsa.
   */
  const nw = (await sql`
    SELECT e.id::int AS evento_id, e.data::text AS data, COALESCE(e.titulo, e.tipo) AS titulo, e.tipo,
           r.war_id::int AS war_id
    FROM evento e LEFT JOIN evento_resultado r ON r.evento_id = e.id
    WHERE e.id <> ${eventoAtualId} AND e.tipo = 'nodewar' AND e.status = 'finalizado'
      AND (${corte}::date IS NULL OR e.data <= ${corte}::date)
    ORDER BY e.data DESC, e.id DESC LIMIT ${QUADRADOS}`) as { evento_id: number; data: string; titulo: string; tipo: string; war_id: number | null }[];

  const sg = (await sql`
    SELECT e.id::int AS evento_id, e.data::text AS data, COALESCE(e.titulo, e.tipo) AS titulo, e.tipo,
           r.war_id::int AS war_id
    FROM evento e LEFT JOIN evento_resultado r ON r.evento_id = e.id
    WHERE e.id <> ${eventoAtualId} AND e.tipo = 'siege' AND e.status = 'finalizado'
      AND (${corte}::date IS NULL OR e.data <= ${corte}::date)
    ORDER BY e.data DESC, e.id DESC LIMIT 1`) as { evento_id: number; data: string; titulo: string; tipo: string; war_id: number | null }[];

  const vm = (w: (typeof nw)[number]): WarHistorico =>
    ({ eventoId: w.evento_id, data: w.data, titulo: w.titulo, tipo: w.tipo, temWar: w.war_id != null });

  // ordem da tela: mais ANTIGA primeiro. Com menos de 6 guerras, os espaços vazios ficam no começo —
  // assim a guerra mais recente é sempre o último quadrado, e a posição não dança de um dia pro outro
  const nodewars: (WarHistorico | null)[] = [
    ...Array(Math.max(0, QUADRADOS - nw.length)).fill(null),
    ...nw.slice().reverse().map(vm),
  ];
  const siege = sg[0] ? vm(sg[0]) : null;

  const eventos = [...nw, ...sg];
  const s = await sinais(eventos.map((e) => e.evento_id));

  // quem já estava no sistema em cada data. NULL em `registrado_em` = veterano (já estava antes do
  // controle existir), então vale pra qualquer data.
  const players = (await sql`
    SELECT nome_familia, registrado_em::text AS registrado_em FROM players
  `) as { nome_familia: string; registrado_em: string | null }[];
  const desde = new Map(players.map((p) => [chaveNome(p.nome_familia), p.registrado_em]));

  const chaves = new Set<string>([...desde.keys()]);
  for (const st of [s.marcou, s.recusou, s.escalado, s.jogou]) for (const k of st) chaves.add(k.split("|")[1]);

  const estadoDe = (chave: string, w: WarHistorico | null): EstadoWar => {
    if (!w) return "sem";
    const k = `${w.eventoId}|${chave}`;
    // a ordem dos testes É a regra: quem jogou jogou, e quem não tinha estatística nunca "faltou"
    if (s.jogou.has(k)) return s.escalado.has(k) ? "jogou" : "jogou_sem_escala";
    if (s.escalado.has(k)) return w.temWar ? "faltou" : "sem_stat";
    if (s.recusou.has(k)) return "recusou";
    if (s.marcou.has(k)) return "marcou";
    // silêncio só conta contra quem já estava aqui pra responder
    const reg = desde.get(chave);
    if (reg && reg.slice(0, 10) > w.data) return "sem";
    return desde.has(chave) ? "nao_respondeu" : "sem";
  };

  const porChave = new Map<string, HistoricoJogador>();
  for (const chave of chaves) {
    porChave.set(chave, {
      nodewars: nodewars.map((w) => estadoDe(chave, w)),
      siege: siege ? estadoDe(chave, siege) : null,
    });
  }
  return { nodewars, siege, porChave };
}
