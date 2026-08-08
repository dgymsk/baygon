import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";

/**
 * As últimas guerras de cada jogador, em uma bolinha por war — o "histórico da semana" que aparece
 * no card ao passar o mouse na escalação.
 *
 * Serve pra decidir escalação com o passado à vista: quem vem jogando, quem marca e não aparece,
 * quem avisou que não podia. Sem isso a decisão depende da memória de quem está montando.
 *
 * A distinção que mais importa é entre FALTOU e NÃO DÁ PRA SABER: numa guerra sem estatística
 * gravada ninguém "faltou" — a informação não existe, e pintar de vermelho seria acusação falsa.
 * Por isso `escalado_sem_war` é um estado próprio, e não um vermelho mais claro.
 */
export type EstadoWar =
  | "sem"               // não marcou, não foi escalado, não jogou — passou longe
  | "recusou"           // disse que não vai no bot
  | "marcou"            // marcou e NÃO foi escalado
  | "jogou"             // está na estatística final da war
  | "faltou"            // foi escalado e não apareceu na estatística
  | "escalado_sem_war"; // foi escalado, mas a war não teve estatística gravada

export type WarHistorico = { eventoId: number; data: string; titulo: string; temWar: boolean };
export type HistoricoSemana = { wars: WarHistorico[]; porChave: Map<string, EstadoWar[]> };

/**
 * Monta o histórico das últimas `limite` guerras ANTERIORES ao evento aberto (ele não entra: o
 * card está sendo usado justamente pra decidir esta guerra, e ela ainda não aconteceu).
 *
 * A ordem do array é a mesma de `wars` — mais recente primeiro —, então a posição da bolinha
 * significa a mesma war pra todo mundo.
 */
export async function historicoSemana(eventoAtualId: number, limite = 7): Promise<HistoricoSemana> {
  const wars = (await sql`
    SELECT e.id::int AS evento_id, e.data::text AS data, COALESCE(e.titulo, e.tipo) AS titulo,
           r.war_id::int AS war_id
    FROM evento e
    LEFT JOIN evento_resultado r ON r.evento_id = e.id
    WHERE e.id <> ${eventoAtualId}
      AND e.data <= COALESCE((SELECT data FROM evento WHERE id = ${eventoAtualId}), e.data)
    ORDER BY e.data DESC, e.id DESC
    LIMIT ${limite}`) as { evento_id: number; data: string; titulo: string; war_id: number | null }[];

  if (!wars.length) return { wars: [], porChave: new Map() };
  const ids = wars.map((w) => w.evento_id);

  const [marcas, recusas, escalados, jogaram] = await Promise.all([
    sql`SELECT ip.evento_id::int AS evento_id, im.chave
        FROM intencao_marca im JOIN intencao_post ip ON ip.message_id = im.message_id
        WHERE ip.evento_id = ANY(${ids as unknown as number[]})` as Promise<unknown>,
    sql`SELECT ip.evento_id::int AS evento_id, ir.chave
        FROM intencao_resp ir JOIN intencao_post ip ON ip.message_id = ir.message_id
        WHERE ip.evento_id = ANY(${ids as unknown as number[]}) AND ir.resposta = 'nao'` as Promise<unknown>,
    sql`SELECT evento_id::int AS evento_id, chave FROM evento_escalacao
        WHERE evento_id = ANY(${ids as unknown as number[]}) AND party_id IS NOT NULL` as Promise<unknown>,
    // a estatística guarda nome de família; a identidade do resto do app é a chaveNome — o casamento
    // é feito aqui, e não no SQL, pra usar exatamente a mesma função das outras telas
    sql`SELECT r.evento_id::int AS evento_id, d.nome_familia
        FROM evento_resultado r JOIN desempenho d ON d.war_id = r.war_id
        WHERE r.evento_id = ANY(${ids as unknown as number[]})
        GROUP BY r.evento_id, d.nome_familia` as Promise<unknown>,
  ]);

  const setDe = (linhas: unknown, campo: "chave" | "nome_familia") => {
    const s = new Set<string>();
    for (const l of linhas as Record<string, string | number>[]) {
      const bruto = String(l[campo] ?? "");
      if (bruto) s.add(`${l.evento_id}|${campo === "chave" ? bruto : chaveNome(bruto)}`);
    }
    return s;
  };
  const sMarcou = setDe(marcas, "chave");
  const sRecusou = setDe(recusas, "chave");
  const sEscalado = setDe(escalados, "chave");
  const sJogou = setDe(jogaram, "nome_familia");

  // todo mundo que aparece em qualquer estágio de qualquer uma das wars
  const chaves = new Set<string>();
  for (const s of [sMarcou, sRecusou, sEscalado, sJogou]) for (const k of s) chaves.add(k.split("|")[1]);

  const porChave = new Map<string, EstadoWar[]>();
  for (const chave of chaves) {
    porChave.set(chave, wars.map((w) => {
      const k = `${w.evento_id}|${chave}`;
      // a ordem do teste É a regra de precedência: quem jogou jogou, independente do que marcou;
      // e "escalado sem estatística" nunca vira falta
      if (sJogou.has(k)) return "jogou";
      if (sEscalado.has(k)) return w.war_id != null ? "faltou" : "escalado_sem_war";
      if (sRecusou.has(k)) return "recusou";
      if (sMarcou.has(k)) return "marcou";
      return "sem";
    }));
  }

  return {
    wars: wars.map((w) => ({ eventoId: w.evento_id, data: w.data, titulo: w.titulo, temWar: w.war_id != null })),
    porChave,
  };
}
