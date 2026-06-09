import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import { fetchConfirmados } from "@/lib/confirmados";

/**
 * Composição de PTs (squads): por membro, em qual PT está e se é líder (coroa).
 * Replace-all (o conjunto enviado É a verdade) atrelado à war_key p/ auto-reset.
 */
export type PtRow = { chave: string; familia: string; pt: string | null; lider: boolean };

const PTS_VALIDAS = new Set(["1", "2", "defesa", "ungabunga"]);

async function readPt(): Promise<PtRow[]> {
  return (await sql`SELECT chave, familia, pt, lider FROM pt_scan ORDER BY familia`) as PtRow[];
}

/** LEITURA PURA (sem escrita). War nova → conjunto antigo não conta. */
export async function getPt(currentWarKey: string | null): Promise<PtRow[]> {
  if (!currentWarKey) return readPt();
  const meta = (await sql`SELECT war_key FROM pt_meta WHERE id = 1`) as { war_key: string | null }[];
  const stored = meta[0]?.war_key ?? null;
  if (stored !== currentWarKey) return [];
  return readPt();
}

/**
 * Substitui todo o conjunto de marcações pelo enviado. Relê a war ATUAL no servidor.
 * `warKeyCliente` = a war que o board renderizou; se o bot já trocou de war, o cliente
 * está stale e NÃO gravamos as marcações obsoletas como se fossem da war nova.
 */
export async function savePt(marcacoes: unknown, warKeyCliente?: string | null): Promise<PtRow[]> {
  const conf = await fetchConfirmados();
  const warKey = conf.ok ? (conf.messageId ?? null) : null;
  if (!warKey) return readPt(); // war desconhecida (bot fora do ar) → não escreve (evita DELETE destrutivo)
  if (warKeyCliente && warKeyCliente !== warKey) return getPt(warKey); // cliente stale → ignora

  const lista = Array.isArray(marcacoes) ? marcacoes : [];
  const map = new Map<string, { familia: string; pt: string | null; lider: boolean }>();
  const lideresPorPt = new Set<string>(); // defesa: no máx. 1 líder por PT (o 1º vence)
  for (const m of lista) {
    const fam = (m as { familia?: unknown })?.familia;
    const familia = typeof fam === "string" ? fam.replace(/\s+/g, " ").trim() : "";
    const k = chaveNome(familia);
    if (!k) continue;
    const ptRaw = (m as { pt?: unknown })?.pt;
    const pt = typeof ptRaw === "string" && PTS_VALIDAS.has(ptRaw) ? ptRaw : null;
    let lider = !!(m as { lider?: unknown })?.lider;
    if (lider && pt) { if (lideresPorPt.has(pt)) lider = false; else lideresPorPt.add(pt); }
    else if (lider && !pt) lider = false; // coroa sem PT não faz sentido → descarta
    if (!pt && !lider) continue; // sem marca nenhuma → não persiste
    map.set(k, { familia, pt, lider });
  }

  const stmts = [sql`DELETE FROM pt_scan`]; // replace-all
  stmts.push(sql`INSERT INTO pt_meta (id, war_key) VALUES (1, ${warKey}) ON CONFLICT (id) DO UPDATE SET war_key = EXCLUDED.war_key`);
  for (const [k, v] of map) {
    stmts.push(sql`INSERT INTO pt_scan (chave, familia, pt, lider, atualizado) VALUES (${k}, ${v.familia}, ${v.pt}, ${v.lider}, now())`);
  }
  await sql.transaction(stmts);
  return readPt();
}

export async function resetPt(): Promise<void> {
  await sql`DELETE FROM pt_scan`;
}
