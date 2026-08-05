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
export type EscalacaoRow = { chave: string; familia: string; party_id: number | null; ordem_pt: number | null; confirmou: boolean | null; convidado_em: string | null; respondeu_em: string | null };
export type EscalacaoOp = { familia: string; partyId?: number | null };

export async function getEscalacao(eventoId: number): Promise<EscalacaoRow[]> {
  return (await sql`SELECT chave, familia, party_id::int AS party_id, ordem_pt::int AS ordem_pt, confirmou, convidado_em::text AS convidado_em, respondeu_em::text AS respondeu_em FROM evento_escalacao WHERE evento_id = ${eventoId} ORDER BY party_id NULLS LAST, ordem_pt NULLS LAST, familia`) as EscalacaoRow[];
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
    // entra no FIM da PT. Se já estava nela, mantém a posição — arrastar de volta pro mesmo lugar
    // não pode reordenar sozinho; quem reordena é o reordenarParty.
    await sql`INSERT INTO evento_escalacao (evento_id, chave, familia, party_id, ordem_pt, atualizado)
      VALUES (${eventoId}, ${chave}, ${familia}, ${pid},
              COALESCE((SELECT max(ordem_pt) + 1 FROM evento_escalacao WHERE evento_id = ${eventoId} AND party_id = ${pid}), 0), now())
      ON CONFLICT (evento_id, chave) DO UPDATE SET familia = EXCLUDED.familia, party_id = EXCLUDED.party_id,
        ordem_pt = CASE WHEN evento_escalacao.party_id IS DISTINCT FROM EXCLUDED.party_id THEN EXCLUDED.ordem_pt ELSE evento_escalacao.ordem_pt END,
        atualizado = now()`;
  }
  return getEscalacao(eventoId);
}

/**
 * Regrava a ordem de UMA party. Recebe as chaves na ordem final — posição 0 é o líder.
 *
 * Só mexe em quem está naquela party: mandar uma chave de outra PT (ou inexistente) não pode
 * arrastá-la pra cá por engano, então o WHERE prende os dois lados.
 */
export async function reordenarParty(eventoId: number, partyId: unknown, chaves: unknown): Promise<EscalacaoRow[]> {
  const pid = Math.trunc(Number(partyId));
  const lista = (Array.isArray(chaves) ? chaves : []).filter((x): x is string => typeof x === "string" && !!x).slice(0, 200);
  if (!Number.isFinite(pid) || !lista.length) return getEscalacao(eventoId);
  await sql`
    UPDATE evento_escalacao e SET ordem_pt = s.n, atualizado = now()
    FROM (SELECT chave, (ordinality - 1)::int AS n FROM unnest(${lista}::text[]) WITH ORDINALITY AS t(chave, ordinality)) s
    WHERE e.evento_id = ${eventoId} AND e.party_id = ${pid} AND e.chave = s.chave`;
  return getEscalacao(eventoId);
}

export async function limparEscalacao(eventoId: number): Promise<void> {
  await sql`DELETE FROM evento_escalacao WHERE evento_id = ${eventoId}`;
}
