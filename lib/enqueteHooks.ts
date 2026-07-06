import type { Enquete } from "@/lib/enquete";
import { aoVotarParticipacao } from "@/lib/participacaoDm";
import { atualizarRelatorioPorEnquete } from "@/lib/buzinador";

/**
 * Dispatch de efeitos colaterais de um voto. Mantém o webhook e a primitiva lib/enquete.ts
 * desacoplados dos consumidores: o roteador de cliques só chama dispatchVotoHook.
 * - contexto 'participacao': espelha o voto em participacao_resp (confirm por DM).
 * - SEMPRE: atualiza (edita) a mensagem do relatório do Buzinador com o tally novo — no-op se a
 *   enquete não estiver ligada a um envio/relatório postado.
 */
export async function dispatchVotoHook(e: Enquete, voto: { userId: string; username: string; idx: number }): Promise<void> {
  if (e.contexto === "participacao") await aoVotarParticipacao(e, voto);
  await atualizarRelatorioPorEnquete(e.id); // relatório ao vivo
}
