import { sql } from "@/lib/db";
import { TIPOS, type Tipo } from "@/lib/participacaoConfig";

/**
 * Canais do bot de intenção, por tipo de war. São DOIS e de propósito:
 *   canalChamada — onde sai o convite pra marcar a função (todo mundo responde);
 *   canalLista   — onde sai a escalação pronta (resultado, pra consulta).
 * Misturar os dois no mesmo canal faz um enterrar o outro.
 *
 * Canal vazio → cai no canal da tela /participacao, pra não quebrar quem já usava.
 */
export type CanalCfg = { canalChamada: string; canalLista: string };
export type IntencaoConfig = Record<Tipo, CanalCfg>;

const dig = (s: unknown) => (typeof s === "string" ? s.replace(/[^0-9]/g, "").slice(0, 25) : "");

export function parseIntencaoConfig(raw: unknown): IntencaoConfig {
  let obj: unknown = raw;
  if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { obj = null; } }
  const o = (obj ?? {}) as Partial<Record<Tipo, Partial<CanalCfg>>>;
  const out = {} as IntencaoConfig;
  for (const t of TIPOS) out[t] = { canalChamada: dig(o[t]?.canalChamada), canalLista: dig(o[t]?.canalLista) };
  return out;
}

export async function getIntencaoConfig(): Promise<IntencaoConfig> {
  const rows = (await sql`SELECT config FROM intencao_config WHERE id = 1`) as { config: string | null }[];
  return parseIntencaoConfig(rows[0]?.config ?? null);
}

export async function setIntencaoConfig(raw: unknown): Promise<IntencaoConfig> {
  const cfg = parseIntencaoConfig(raw);
  await sql`INSERT INTO intencao_config (id, config) VALUES (1, ${JSON.stringify(cfg)})
    ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config`;
  return cfg;
}
