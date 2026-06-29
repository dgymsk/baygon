import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import { fetchConfirmados } from "@/lib/confirmados";
import { ptChaveValida, parseConfig, configPadrao, type PtConfig } from "@/lib/ptConfig";

/**
 * Composição de PTs (squads), por LINHA (delta) — seguro p/ duas pessoas editando junto.
 * Por membro: em qual PT está (chave do template ativo) e se é líder (coroa).
 * Atrelado à war_key (auto-reset ao trocar a war). O TEMPLATE (pt_config) persiste.
 */
export type PtRow = { chave: string; familia: string; pt: string | null; lider: boolean };
export type PtOp = { familia: string; pt?: string | null; lider?: boolean };

/** LEITURA PURA do template das PTs (config por modo). Persiste entre wars. */
export async function getPtConfig(): Promise<PtConfig> {
  const meta = (await sql`SELECT pt_config FROM pt_meta WHERE id = 1`) as { pt_config: string | null }[];
  return meta[0]?.pt_config ? parseConfig(meta[0].pt_config) : configPadrao();
}

/** Define o template das PTs (não mexe nas marcações nem na war). Sanitiza antes de gravar. */
export async function setPtConfig(raw: unknown): Promise<PtConfig> {
  const cfg = parseConfig(raw);
  await sql`INSERT INTO pt_meta (id, pt_config) VALUES (1, ${JSON.stringify(cfg)})
    ON CONFLICT (id) DO UPDATE SET pt_config = EXCLUDED.pt_config`;
  return cfg;
}

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
 * Aplica um lote de deltas (upsert/delete por membro). Relê a war no servidor; rejeita
 * cliente stale e não escreve com war desconhecida; limpa o scan ao trocar de war.
 */
export async function aplicarOps(ops: unknown, warKeyCliente?: string | null): Promise<PtRow[]> {
  const conf = await fetchConfirmados();
  const warKey = conf.ok ? (conf.messageId ?? null) : null;
  if (!warKey) return readPt(); // war desconhecida (bot fora) → não escreve
  if (warKeyCliente && warKeyCliente !== warKey) return getPt(warKey); // cliente stale

  const lista = Array.isArray(ops) ? ops : [];
  // limpa só na troca de war — guardado pela meta DENTRO da transação (atômico).
  const stmts = [sql`DELETE FROM pt_scan WHERE (SELECT war_key FROM pt_meta WHERE id = 1) IS DISTINCT FROM ${warKey}`];
  stmts.push(sql`INSERT INTO pt_meta (id, war_key) VALUES (1, ${warKey}) ON CONFLICT (id) DO UPDATE SET war_key = EXCLUDED.war_key`);
  for (const o of lista) {
    const famRaw = (o as { familia?: unknown })?.familia;
    const familia = typeof famRaw === "string" ? famRaw.replace(/\s+/g, " ").trim() : "";
    const k = chaveNome(familia);
    if (!k) continue;
    const ptRaw = (o as { pt?: unknown })?.pt;
    const pt = typeof ptRaw === "string" && ptChaveValida(ptRaw) ? ptRaw : null;
    const lider = !!(o as { lider?: unknown })?.lider;
    if (!pt && !lider) {
      stmts.push(sql`DELETE FROM pt_scan WHERE chave = ${k}`);
    } else {
      // 1 líder por PT mesmo com 2 usuários: ao coroar alguém numa PT, tira a coroa dos outros dela
      if (pt && lider) stmts.push(sql`UPDATE pt_scan SET lider = false WHERE pt = ${pt} AND chave <> ${k}`);
      stmts.push(sql`INSERT INTO pt_scan (chave, familia, pt, lider, atualizado) VALUES (${k}, ${familia}, ${pt}, ${lider}, now())
        ON CONFLICT (chave) DO UPDATE SET familia = EXCLUDED.familia, pt = EXCLUDED.pt, lider = EXCLUDED.lider, atualizado = now()`);
    }
  }
  await sql.transaction(stmts);
  return readPt();
}

export async function resetPt(): Promise<void> {
  await sql`DELETE FROM pt_scan`;
}
