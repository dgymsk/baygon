import { sql } from "@/lib/db";

/**
 * CONVOCAÇÃO — a confirmação DA ESCALAÇÃO, por DM. É o passo do meio do funil:
 *
 *   marcou no bot  →  staff escala  →  [CONVOCAÇÃO: aceita ou recusa por DM]  →  aparece in-game
 *
 * Aqui mora só a RESPOSTA (o clique da pessoa na DM). O disparo vive em lib/loteDM.ts, que fatia o
 * envio em lotes com progresso visível — a escalação inteira numa requisição só estourava o tempo
 * da função na Vercel no meio do caminho, deixando parte das DMs enviadas e nenhum relatório.
 *
 * Recusar tira a pessoa da PT na hora (party_id = NULL) mas mantém a linha com confirmou=false —
 * é o que separa "avisou que não vinha" de "sumiu", e a vaga já abre pra staff remanejar.
 */
export async function responderConvocacao(eventoId: number, userId: string, aceita: boolean): Promise<{ ok: boolean; familia?: string; encerrado?: boolean }> {
  // evento ENCERRADO não muda mais: a DM continua viva no privado da pessoa pra sempre, e sem este
  // gate um "❌ Não vou" clicado depois da guerra ainda tirava alguém da PT no registro histórico
  const ev = (await sql`SELECT status FROM evento WHERE id = ${eventoId}`) as { status: string }[];
  if (ev[0]?.status === "finalizado") return { ok: false, encerrado: true };

  const rows = (await sql`
    UPDATE evento_escalacao
    SET confirmou = ${aceita}, respondeu_em = now(),
        party_id = CASE WHEN ${aceita} THEN party_id ELSE NULL END
    WHERE evento_id = ${eventoId} AND user_id = ${userId}
    RETURNING familia`) as { familia: string }[];
  return rows[0] ? { ok: true, familia: rows[0].familia } : { ok: false };
}
