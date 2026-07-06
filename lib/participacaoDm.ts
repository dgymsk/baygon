import { sql } from "@/lib/db";
import { upsertResposta } from "@/lib/participacao";
import type { Enquete } from "@/lib/enquete";

/**
 * Cola ENQUETE → PARTICIPAÇÃO (a ÚNICA ponte entre os dois). Permite, no futuro, disparar a
 * confirmação de uma rodada pela DM: cria-se uma enquete `contexto:'participacao'`, `ref_id` =
 * message_id do post; ao votar, o voto entra no MESMO participacao_resp dos botões públicos, e
 * o embed público reflete no próximo rebuild. lib/enquete.ts continua ignorante disso.
 *
 * Convenção de opções da enquete de confirmação: idx 0 = Can (vou), idx 1 = Cant (não vou).
 */
export async function aoVotarParticipacao(e: Enquete, v: { userId: string; username: string; idx: number }): Promise<void> {
  if (!e.ref_id) return;
  const resposta = v.idx === 0 ? "can" : "cant";
  const tipo = ((await sql`SELECT tipo FROM participacao_post WHERE message_id = ${e.ref_id}`) as { tipo: string }[])[0]?.tipo ?? "";
  if (!tipo) return; // rodada não existe mais
  // familia/chave nulos: o rebuild público resolve o confirmado por user_id (entra em "Sem PT").
  await upsertResposta({ warKey: e.ref_id, userId: v.userId, username: v.username.slice(0, 100), familia: null, chave: null, tipo, resposta });
}
