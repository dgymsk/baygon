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
export type EscalacaoRow = { chave: string; familia: string; pt_id: number | null };
export type EscalacaoOp = { familia: string; ptId?: number | null };

export async function getEscalacao(eventoId: number): Promise<EscalacaoRow[]> {
  return (await sql`SELECT chave, familia, pt_id::int AS pt_id FROM evento_escalacao WHERE evento_id = ${eventoId} ORDER BY familia`) as EscalacaoRow[];
}

/**
 * Aplica um lote de deltas. `ptId` numérico = escala naquela PT (move, se já estava em outra);
 * `null`/ausente = tira da escalação. Ignora linha sem família válida.
 */
export async function aplicarEscalacao(eventoId: number, ops: unknown): Promise<EscalacaoRow[]> {
  const lista = Array.isArray(ops) ? ops : [];
  for (const o of lista) {
    const r = (o ?? {}) as { familia?: unknown; ptId?: unknown };
    const familia = typeof r.familia === "string" ? r.familia.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    const chave = chaveNome(familia);
    if (!chave) continue;
    const pid = r.ptId === null || r.ptId === undefined || r.ptId === "" ? null : Math.trunc(Number(r.ptId));
    if (pid == null || !Number.isFinite(pid)) {
      await sql`DELETE FROM evento_escalacao WHERE evento_id = ${eventoId} AND chave = ${chave}`;
      continue;
    }
    await sql`INSERT INTO evento_escalacao (evento_id, chave, familia, pt_id, atualizado)
      VALUES (${eventoId}, ${chave}, ${familia}, ${pid}, now())
      ON CONFLICT (evento_id, chave) DO UPDATE SET familia = EXCLUDED.familia, pt_id = EXCLUDED.pt_id, atualizado = now()`;
  }
  return getEscalacao(eventoId);
}

export async function limparEscalacao(eventoId: number): Promise<void> {
  await sql`DELETE FROM evento_escalacao WHERE evento_id = ${eventoId}`;
}
