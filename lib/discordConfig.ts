import { sql } from "@/lib/db";

/**
 * Config geral do Discord (qual servidor está ativo + cargos de staff + canais do Apollo).
 * Persistida em discord_config; se um campo estiver vazio, cai no ENV (fallback p/ migração).
 * Usado pelo gate de login (auth.ts), pelas operações do bot (emojis, comandos) e na leitura
 * das confirmações (lib/confirmados.ts).
 */
export type DiscordConfig = { guildId: string; staffRoleIds: string[]; confirmNodewar: string; confirmSiege: string; logChannel: string; reportChannel: string; registroRoleId: string; registerChannel: string };

const dig = (s: unknown) => (typeof s === "string" ? s.replace(/[^0-9]/g, "").slice(0, 25) : "");
/** LISTA de IDs de canal (CSV). O Apollo pode postar em N canais — no Psicose é um por dia
 *  da semana. Aceita string com vírgulas/espaços ou array; devolve CSV sem repetidos.
 *  Um ID só continua valendo (compat com a config antiga de canal único). */
const digs = (s: unknown) => {
  const bruto = Array.isArray(s) ? s : typeof s === "string" ? s.split(/[^0-9]+/) : [];
  return [...new Set(bruto.map(dig).filter(Boolean))].slice(0, 12).join(",");
};
/** CSV de canais → array (usado por quem vai ler os canais). */
export const canaisDe = (csv: string): string[] => csv.split(",").map((s) => s.trim()).filter(Boolean);
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
    confirmNodewar: digs(c.confirmNodewar) || (process.env.DISCORD_CONFIRM_CHANNEL_ID_NODEWAR ?? process.env.DISCORD_CONFIRM_CHANNEL_ID ?? ""),
    confirmSiege: digs(c.confirmSiege) || (process.env.DISCORD_CONFIRM_CHANNEL_ID_SIEGE ?? ""),
    logChannel: dig(c.logChannel) || (process.env.DISCORD_LOG_CHANNEL_ID ?? ""),
    reportChannel: dig(c.reportChannel) || (process.env.DISCORD_REPORT_CHANNEL_ID ?? ""),
    registroRoleId: dig(c.registroRoleId),
    registerChannel: dig(c.registerChannel),
  };
}

/** Sanitiza p/ GRAVAR (sem fallback — campo vazio fica vazio, o env cobre em runtime). */
function sanitizaStore(raw: unknown): DiscordConfig {
  const c = (raw ?? {}) as Partial<DiscordConfig>;
  const roles = Array.isArray(c.staffRoleIds) ? [...new Set(c.staffRoleIds.map(dig).filter(Boolean))] : (typeof c.staffRoleIds === "string" ? (c.staffRoleIds as string).split(",").map(dig).filter(Boolean) : []);
  return { guildId: dig(c.guildId), staffRoleIds: roles, confirmNodewar: digs(c.confirmNodewar), confirmSiege: digs(c.confirmSiege), logChannel: dig(c.logChannel), reportChannel: dig(c.reportChannel), registroRoleId: dig(c.registroRoleId), registerChannel: dig(c.registerChannel) };
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
