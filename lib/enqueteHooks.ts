import type { Enquete } from "@/lib/enquete";
import { aoVotarParticipacao } from "@/lib/participacaoDm";

/**
 * Dispatch de efeitos colaterais de um voto, POR CONTEXTO da enquete. Mantém o webhook e a
 * primitiva lib/enquete.ts desacoplados dos consumidores: o roteador de cliques só chama
 * dispatchVotoHook; cada contexto tem seu adaptador. Um contexto sem hook é no-op (ex.: 'buzinador'
 * só grava o voto e mostra o tally no relatório — nada mais a fazer).
 */
export async function dispatchVotoHook(e: Enquete, voto: { userId: string; username: string; idx: number }): Promise<void> {
  switch (e.contexto) {
    case "participacao":
      await aoVotarParticipacao(e, voto);
      break;
    default:
      break; // 'buzinador' e demais: sem efeito extra
  }
}
