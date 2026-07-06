import { sql } from "@/lib/db";

/**
 * Config geral do Discord (qual servidor está ativo + cargos de staff + canais do Apollo).
 * Persistida em discord_config; se um campo estiver vazio, cai no ENV (fallback p/ migração).
 * Usado pelo gate de login (auth.ts), pelas operações do bot (emojis, comandos) e na leitura
 * das confirmações (lib/confirmados.ts).
 */
export type DiscordConfig = { guildId: string; staffRoleIds: string[]; confirmNodewar: string; confirmSiege: string; logChannel: string };

const dig = (s: unknown) => (typeof s === "string" ? s.replace(/[^0-9]/g, "").slice(0, 25) : "");
const envGuild = () => (process.env.DISCORD_GUILD_ID ?? "").split(",").map((s) => s.trim()).filter(Boolean)[0] ?? "";
const envStaff = () => (process.env.DISCORD_STAFF_ROLE_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Parseia com FALLBACK pro env (campo vazio → env). É o valor EFETIVO usado em runtime. */
export function parseDiscordConfig(raw: unknown): DiscordConfig {
  let obj: unknown = raw;
  if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { obj = null; } }
  const c = (obj ?? {}) as Partial<DiscordConfig>;
  const roles = Array.isArray(c.staffRoleIds) ? c.staffRoleIds.map(dig).filter(Boolean) : [];
  return {
    guildId: dig(c.guildId) || envGuild(),
    staffRoleIds: roles.length ? roles : envStaff(),
    confirmNodewar: dig(c.confirmNodewar) || (process.env.DISCORD_CONFIRM_CHANNEL_ID_NODEWAR ?? process.env.DISCORD_CONFIRM_CHANNEL_ID ?? ""),
    confirmSiege: dig(c.confirmSiege) || (process.env.DISCORD_CONFIRM_CHANNEL_ID_SIEGE ?? ""),
    logChannel: dig(c.logChannel) || (process.env.DISCORD_LOG_CHANNEL_ID ?? ""),
  };
}

/** Sanitiza p/ GRAVAR (sem fallback — campo vazio fica vazio, o env cobre em runtime). */
function sanitizaStore(raw: unknown): DiscordConfig {
  const c = (raw ?? {}) as Partial<DiscordConfig>;
  const roles = Array.isArray(c.staffRoleIds) ? [...new Set(c.staffRoleIds.map(dig).filter(Boolean))] : (typeof c.staffRoleIds === "string" ? (c.staffRoleIds as string).split(",").map(dig).filter(Boolean) : []);
  return { guildId: dig(c.guildId), staffRoleIds: roles, confirmNodewar: dig(c.confirmNodewar), confirmSiege: dig(c.confirmSiege), logChannel: dig(c.logChannel) };
}

export async function getDiscordConfig(): Promise<DiscordConfig> {
  const rows = (await sql`SELECT config FROM discord_config WHERE id = 1`) as { config: string | null }[];
  return parseDiscordConfig(rows[0]?.config ?? null);
}
export async function setDiscordConfig(raw: unknown): Promise<DiscordConfig> {
  const s = sanitizaStore(raw);
  await sql`INSERT INTO discord_config (id, config) VALUES (1, ${JSON.stringify(s)})
    ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config`;
  return parseDiscordConfig(JSON.stringify(s));
}
