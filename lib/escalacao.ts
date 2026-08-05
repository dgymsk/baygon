import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";

/**
 * Escalação final do evento: quem joga e em QUAL PT. É aqui que a intenção múltipla do bot
 * (a pessoa pode marcar 3 PTs) vira decisão — por isso a PK é (evento_id, chave): uma PT só
 * por pessoa no time que entra em campo.
 *
 * Gravação por DELTA (uma op por linha), como em lib/remocaoStatus.ts: duas pessoas montando a
 * escalação ao mesmo tempo não sobrescrevem o trabalho uma da outra.
 */
export type EscalacaoRow = { chave: string; familia: string; party_id: number | null; confirmou: boolean | null; convidado_em: string | null; respondeu_em: string | null };
export type EscalacaoOp = { familia: string; partyId?: number | null };

export async function getEscalacao(eventoId: number): Promise<EscalacaoRow[]> {
  return (await sql`SELECT chave, familia, party_id::int AS party_id, confirmou, convidado_em::text AS convidado_em, respondeu_em::text AS respondeu_em FROM evento_escalacao WHERE evento_id = ${eventoId} ORDER BY familia`) as EscalacaoRow[];
}

/**
 * Aplica um lote de deltas. `partyId` numérico = escala naquela PT (move, se já estava em outra);
 * `null`/ausente = tira da escalação. Ignora linha sem família válida.
 */
export async function aplicarEscalacao(eventoId: number, ops: unknown): Promise<EscalacaoRow[]> {
  const lista = Array.isArray(ops) ? ops : [];
  for (const o of lista) {
    const r = (o ?? {}) as { familia?: unknown; partyId?: unknown };
    const familia = typeof r.familia === "string" ? r.familia.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    const chave = chaveNome(familia);
    if (!chave) continue;
    const pid = r.partyId === null || r.partyId === undefined || r.partyId === "" ? null : Math.trunc(Number(r.partyId));
    if (pid == null || !Number.isFinite(pid)) {
      await sql`DELETE FROM evento_escalacao WHERE evento_id = ${eventoId} AND chave = ${chave}`;
      continue;
    }
    await sql`INSERT INTO evento_escalacao (evento_id, chave, familia, party_id, atualizado)
      VALUES (${eventoId}, ${chave}, ${familia}, ${pid}, now())
      ON CONFLICT (evento_id, chave) DO UPDATE SET familia = EXCLUDED.familia, party_id = EXCLUDED.party_id, atualizado = now()`;
  }
  return getEscalacao(eventoId);
}

export async function limparEscalacao(eventoId: number): Promise<void> {
  await sql`DELETE FROM evento_escalacao WHERE evento_id = ${eventoId}`;
}
