import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";

export type StatusRow = { familia: string; participar: boolean };

/**
 * Lê o status "Participar" persistido. Se a mensagem do bot mudou (nova war),
 * RESETA automaticamente o scan e volta vazio (atrela ao novo war_key).
 */
export async function getStatus(currentWarKey: string | null): Promise<StatusRow[]> {
  if (currentWarKey) {
    const meta = (await sql`SELECT war_key FROM participar_meta WHERE id = 1`) as { war_key: string | null }[];
    const stored = meta[0]?.war_key ?? null;
    if (stored !== currentWarKey) {
      await sql.transaction([
        sql`DELETE FROM participar_scan`,
        sql`INSERT INTO participar_meta (id, war_key) VALUES (1, ${currentWarKey})
            ON CONFLICT (id) DO UPDATE SET war_key = EXCLUDED.war_key`,
      ]);
      return [];
    }
  }
  return (await sql`SELECT familia, participar FROM participar_scan ORDER BY familia`) as StatusRow[];
}

/** Acumula os membros lidos (upsert por chave canônica; o mais recente vence). */
export async function saveStatus(membros: unknown, warKey: string | null): Promise<StatusRow[]> {
  const lista = Array.isArray(membros) ? membros : [];
  const map = new Map<string, { familia: string; participar: boolean }>();
  for (const m of lista) {
    const fam = (m as { familia?: unknown })?.familia;
    const familia = typeof fam === "string" ? fam.replace(/\s+/g, " ").trim() : "";
    const k = chaveNome(familia);
    if (!k) continue;
    map.set(k, { familia, participar: !!(m as { participar?: unknown })?.participar });
  }
  const stmts = [];
  if (warKey) stmts.push(sql`INSERT INTO participar_meta (id, war_key) VALUES (1, ${warKey}) ON CONFLICT (id) DO UPDATE SET war_key = EXCLUDED.war_key`);
  for (const [k, v] of map) {
    stmts.push(sql`INSERT INTO participar_scan (chave, familia, participar, atualizado) VALUES (${k}, ${v.familia}, ${v.participar}, now())
      ON CONFLICT (chave) DO UPDATE SET familia = EXCLUDED.familia, participar = EXCLUDED.participar, atualizado = now()`);
  }
  if (stmts.length) await sql.transaction(stmts);
  return (await sql`SELECT familia, participar FROM participar_scan ORDER BY familia`) as StatusRow[];
}

export async function resetStatus(): Promise<void> {
  await sql`DELETE FROM participar_scan`;
}
