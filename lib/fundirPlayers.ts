import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";

/**
 * FUNDIR dois cadastros que são a MESMA pessoa.
 *
 * O caso que cria isto: alguém troca o nome de família no jogo. O print da war seguinte traz o nome
 * novo, o app não reconhece e cadastra um jogador do zero — sem Discord, sem Garmoth, sem grupo. A
 * partir daí a pessoa tem duas vidas: o histórico antigo numa e as estatísticas novas na outra, e
 * nenhuma das duas conta a verdade.
 *
 * Renomear NÃO resolve, e é recusado de propósito (ver lib/renomearPlayer.ts): com os dois nomes
 * existindo, um UPDATE do nome bate na PK. Fundir é a operação que faltava.
 *
 * QUEM VENCE. O `vencedor` é o cadastro que SOBREVIVE — normalmente o que tem `discord_id`, porque
 * é o vínculo que o app usa como identidade e o único que não se recupera sozinho. O `perdedor` tem
 * o histórico movido pra ele e depois deixa de existir.
 *
 * CONFLITO. Se os dois têm linha pro MESMO fato (a mesma métrica na mesma war, a mesma PT no mesmo
 * evento), a do VENCEDOR fica e a do perdedor é descartada. Não somamos: é a mesma pessoa, e somar
 * dano de duas leituras da mesma war inventaria número. Não escolhemos a maior: escolher por valor
 * seria otimizar o número em vez de preservar o registro.
 */
export type PreviaFusao = {
  vencedor: string;
  perdedor: string;
  /** por tabela: quantas linhas MUDAM de dono e quantas são descartadas por já existirem no vencedor */
  move: Record<string, number>;
  descarta: Record<string, number>;
  /** wars em que os DOIS têm estatística — se houver, os dois jogaram junto e pode não ser a mesma pessoa */
  warsEmComum: number[];
};

/** As 5 com FK: identidade é `nome_familia`. A chave de conflito de cada uma está no comentário. */
const POR_NOME = [
  { t: "desempenho",        conflito: "(war_id, metrica)" },        // PK (war_id, nome_familia, metrica)
  { t: "discrepancia",      conflito: "(war_id, metrica, populacao)" },
  { t: "war_player",        conflito: "(war_id)" },                  // PK (war_id, nome_familia)
  { t: "garmoth_build",     conflito: "(linha única)" },             // PK (nome_familia)
  { t: "garmoth_gear_hist", conflito: "(nenhuma — PK é id)" },
] as const;

/** As 11 com `chave`: a partição de conflito de cada índice único. */
const POR_CHAVE = [
  { t: "evento_escalacao",    conflito: "(evento_id)" },
  { t: "evento_presenca",     conflito: "(evento_id)" },
  { t: "participacao_membro", conflito: "(tipo)" },
  { t: "player_funcao",       conflito: "(funcao_id)" },
  { t: "dm_lote_alvo",        conflito: "(lote_id)" },
  { t: "participar_scan",     conflito: "(chave)" },
  { t: "pt_scan",             conflito: "(chave)" },
  { t: "remocao_scan",        conflito: "(chave)" },
  { t: "intencao_marca",      conflito: "(nenhuma)" },
  { t: "intencao_resp",       conflito: "(nenhuma)" },
  { t: "participacao_resp",   conflito: "(nenhuma)" },
] as const;

/** As wars em que os dois têm estatística — o sinal de que talvez NÃO sejam a mesma pessoa. */
export async function warsEmComum(a: string, b: string): Promise<number[]> {
  const rows = (await sql`
    SELECT war_id::int AS war_id FROM (
      SELECT DISTINCT war_id FROM desempenho WHERE nome_familia = ${a}
      INTERSECT SELECT DISTINCT war_id FROM desempenho WHERE nome_familia = ${b}) x
    ORDER BY war_id`) as { war_id: number }[];
  return rows.map((r) => r.war_id);
}

export type ResultadoFusao =
  | { ok: true; vencedor: string; perdedor: string; nomeFinal: string; move: Record<string, number>; descarta: Record<string, number> }
  | { ok: false; codigo: "nao_existe" | "mesmo" | "jogaram_juntos"; erro: string; warsEmComum?: number[] };

/**
 * Funde `perdedor` em `vencedor`. Se `forcar` não vier, recusa quando os dois têm estatística na
 * MESMA war — porque isso quer dizer que os dois estavam em campo ao mesmo tempo, e aí não é a
 * mesma pessoa. A staff pode forçar (dupla leitura do mesmo print acontece), mas tem que ver o
 * número antes.
 */
export async function fundirPlayers(perdedorBruto: unknown, vencedorBruto: unknown, o: { forcar?: boolean } = {}): Promise<ResultadoFusao> {
  const perdedor = typeof perdedorBruto === "string" ? perdedorBruto.trim() : "";
  const vencedor = typeof vencedorBruto === "string" ? vencedorBruto.trim() : "";
  if (!perdedor || !vencedor) return { ok: false, codigo: "nao_existe", erro: "informe os dois cadastros" };
  if (perdedor === vencedor) return { ok: false, codigo: "mesmo", erro: "os dois nomes são o mesmo cadastro" };

  const existem = (await sql`SELECT nome_familia FROM players WHERE nome_familia IN (${perdedor}, ${vencedor})`) as { nome_familia: string }[];
  if (existem.length < 2) {
    const falta = [perdedor, vencedor].filter((n) => !existem.some((e) => e.nome_familia === n));
    return { ok: false, codigo: "nao_existe", erro: `não está no cadastro: ${falta.join(", ")}` };
  }

  const juntos = await warsEmComum(perdedor, vencedor);
  if (juntos.length && !o.forcar) {
    return { ok: false, codigo: "jogaram_juntos", warsEmComum: juntos,
      erro: `Os dois têm estatística nas wars ${juntos.join(", ")} — estavam em campo ao mesmo tempo, então provavelmente não são a mesma pessoa.` };
  }

  const kP = chaveNome(perdedor), kV = chaveNome(vencedor);
  const move: Record<string, number> = {};
  const descarta: Record<string, number> = {};
  const reg = (mapa: Record<string, number>, t: string, n: number) => { if (n) mapa[t] = n; };

  /**
   * Cada tabela é feita em DOIS passos, e a ordem importa:
   *   1. MOVE o que não conflita  (WHERE NOT EXISTS a linha equivalente do vencedor);
   *   2. APAGA o que sobrou       (é conflito: o vencedor já tem aquele fato).
   *
   * Sequencial, e não numa transação única, de propósito: são ~30 statements com predicado que
   * depende do estado da linha anterior, e `sql.transaction` do driver HTTP só aceita array
   * estático — não dá pra ler-e-ramificar lá dentro. A operação é idempotente por construção
   * (mover o que não conflita e apagar o resto pode rodar de novo sem estragar), então uma
   * interrupção no meio deixa estado consistente e reexecutável, não corrompido.
   */

  // --- desempenho: PK (war_id, nome_familia, metrica) ---
  reg(move, "desempenho", (await sql`
    UPDATE desempenho d SET nome_familia = ${vencedor} WHERE d.nome_familia = ${perdedor}
      AND NOT EXISTS (SELECT 1 FROM desempenho v WHERE v.nome_familia = ${vencedor} AND v.war_id = d.war_id AND v.metrica = d.metrica)
    RETURNING 1`).length);
  reg(descarta, "desempenho", (await sql`DELETE FROM desempenho WHERE nome_familia = ${perdedor} RETURNING 1`).length);

  // --- discrepancia: derivada, PK inclui populacao ---
  reg(move, "discrepancia", (await sql`
    UPDATE discrepancia d SET nome_familia = ${vencedor} WHERE d.nome_familia = ${perdedor}
      AND NOT EXISTS (SELECT 1 FROM discrepancia v WHERE v.nome_familia = ${vencedor} AND v.war_id = d.war_id AND v.metrica = d.metrica AND v.populacao = d.populacao)
    RETURNING 1`).length);
  reg(descarta, "discrepancia", (await sql`DELETE FROM discrepancia WHERE nome_familia = ${perdedor} RETURNING 1`).length);

  // --- war_player: PK (war_id, nome_familia). O carimbo do vencedor vence: ele é quem sobrevive ---
  reg(move, "war_player", (await sql`
    UPDATE war_player p SET nome_familia = ${vencedor} WHERE p.nome_familia = ${perdedor}
      AND NOT EXISTS (SELECT 1 FROM war_player v WHERE v.nome_familia = ${vencedor} AND v.war_id = p.war_id)
    RETURNING 1`).length);
  reg(descarta, "war_player", (await sql`DELETE FROM war_player WHERE nome_familia = ${perdedor} RETURNING 1`).length);

  // --- garmoth: build é uma linha por jogador (a do vencedor fica); hist não tem conflito ---
  reg(move, "garmoth_build", (await sql`
    UPDATE garmoth_build b SET nome_familia = ${vencedor} WHERE b.nome_familia = ${perdedor}
      AND NOT EXISTS (SELECT 1 FROM garmoth_build v WHERE v.nome_familia = ${vencedor})
    RETURNING 1`).length);
  reg(descarta, "garmoth_build", (await sql`DELETE FROM garmoth_build WHERE nome_familia = ${perdedor} RETURNING 1`).length);
  reg(move, "garmoth_gear_hist", (await sql`
    UPDATE garmoth_gear_hist SET nome_familia = ${vencedor} WHERE nome_familia = ${perdedor} RETURNING 1`).length);

  // --- as de chave, uma a uma (o driver exige tagged template; nome de tabela nunca é interpolado) ---
  reg(move, "evento_escalacao", (await sql`
    UPDATE evento_escalacao e SET chave = ${kV}, familia = ${vencedor} WHERE e.chave = ${kP}
      AND NOT EXISTS (SELECT 1 FROM evento_escalacao v WHERE v.chave = ${kV} AND v.evento_id = e.evento_id) RETURNING 1`).length);
  reg(descarta, "evento_escalacao", (await sql`DELETE FROM evento_escalacao WHERE chave = ${kP} RETURNING 1`).length);

  reg(move, "evento_presenca", (await sql`
    UPDATE evento_presenca e SET chave = ${kV}, familia = ${vencedor} WHERE e.chave = ${kP}
      AND NOT EXISTS (SELECT 1 FROM evento_presenca v WHERE v.chave = ${kV} AND v.evento_id = e.evento_id) RETURNING 1`).length);
  reg(descarta, "evento_presenca", (await sql`DELETE FROM evento_presenca WHERE chave = ${kP} RETURNING 1`).length);

  reg(move, "participacao_membro", (await sql`
    UPDATE participacao_membro m SET chave = ${kV}, familia = ${vencedor} WHERE m.chave = ${kP}
      AND NOT EXISTS (SELECT 1 FROM participacao_membro v WHERE v.chave = ${kV} AND v.tipo = m.tipo) RETURNING 1`).length);
  reg(descarta, "participacao_membro", (await sql`DELETE FROM participacao_membro WHERE chave = ${kP} RETURNING 1`).length);

  reg(move, "player_funcao", (await sql`
    UPDATE player_funcao f SET chave = ${kV}, familia = ${vencedor} WHERE f.chave = ${kP}
      AND NOT EXISTS (SELECT 1 FROM player_funcao v WHERE v.chave = ${kV} AND v.funcao_id = f.funcao_id) RETURNING 1`).length);
  reg(descarta, "player_funcao", (await sql`DELETE FROM player_funcao WHERE chave = ${kP} RETURNING 1`).length);

  reg(move, "dm_lote_alvo", (await sql`
    UPDATE dm_lote_alvo a SET chave = ${kV}, familia = ${vencedor} WHERE a.chave = ${kP}
      AND NOT EXISTS (SELECT 1 FROM dm_lote_alvo v WHERE v.chave = ${kV} AND v.lote_id = a.lote_id) RETURNING 1`).length);
  reg(descarta, "dm_lote_alvo", (await sql`DELETE FROM dm_lote_alvo WHERE chave = ${kP} RETURNING 1`).length);

  // nas três de scan a chave é a PK inteira: move só se o vencedor não tiver linha
  reg(move, "participar_scan", (await sql`
    UPDATE participar_scan SET chave = ${kV}, familia = ${vencedor} WHERE chave = ${kP}
      AND NOT EXISTS (SELECT 1 FROM participar_scan v WHERE v.chave = ${kV}) RETURNING 1`).length);
  reg(descarta, "participar_scan", (await sql`DELETE FROM participar_scan WHERE chave = ${kP} RETURNING 1`).length);
  reg(move, "pt_scan", (await sql`
    UPDATE pt_scan SET chave = ${kV}, familia = ${vencedor} WHERE chave = ${kP}
      AND NOT EXISTS (SELECT 1 FROM pt_scan v WHERE v.chave = ${kV}) RETURNING 1`).length);
  reg(descarta, "pt_scan", (await sql`DELETE FROM pt_scan WHERE chave = ${kP} RETURNING 1`).length);
  reg(move, "remocao_scan", (await sql`
    UPDATE remocao_scan SET chave = ${kV}, familia = ${vencedor} WHERE chave = ${kP}
      AND NOT EXISTS (SELECT 1 FROM remocao_scan v WHERE v.chave = ${kV}) RETURNING 1`).length);
  reg(descarta, "remocao_scan", (await sql`DELETE FROM remocao_scan WHERE chave = ${kP} RETURNING 1`).length);

  // estas três não têm índice único sobre chave: a identidade lá é o user_id do Discord
  reg(move, "intencao_marca", (await sql`UPDATE intencao_marca SET chave = ${kV}, familia = ${vencedor} WHERE chave = ${kP} RETURNING 1`).length);
  reg(move, "intencao_resp", (await sql`UPDATE intencao_resp SET chave = ${kV}, familia = ${vencedor} WHERE chave = ${kP} RETURNING 1`).length);
  reg(move, "participacao_resp", (await sql`UPDATE participacao_resp SET chave = ${kV}, familia = ${vencedor} WHERE chave = ${kP} RETURNING 1`).length);
  reg(move, "registro_jornada", (await sql`UPDATE registro_jornada SET familia = ${vencedor} WHERE familia = ${perdedor} RETURNING 1`).length);

  /**
   * O cadastro perdedor deixa de existir. A esta altura nada mais aponta pra ele — o que conflitava
   * foi descartado acima, de propósito e contado, e não em silêncio por CASCADE.
   *
   * `desempenho` e `discrepancia` NÃO têm ON DELETE CASCADE: se sobrasse linha nelas, este DELETE
   * falharia com 23503 em vez de apagar histórico às escondidas. É o guarda-corpo final.
   */
  const morreu = (await sql`DELETE FROM players WHERE nome_familia = ${perdedor} RETURNING nome_familia`) as { nome_familia: string }[];
  if (!morreu[0]) return { ok: false, codigo: "nao_existe", erro: "o cadastro perdedor não pôde ser removido" };

  return { ok: true, vencedor, perdedor, nomeFinal: vencedor, move, descarta };
}
