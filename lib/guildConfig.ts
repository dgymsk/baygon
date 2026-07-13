import { sql } from "@/lib/db";
import { getDiscordConfig } from "@/lib/discordConfig";
import { parseGuildMeta, guildMetaPadrao, type GuildMeta } from "@/lib/guild";

/**
 * Identidade da ALIANÇA e das GUILDAS participantes — leitura/gravação (server).
 * Persistida em guild_meta (singleton id=1). Os tipos e helpers puros (parse, resolvers,
 * iconeUrl) ficam em lib/guild.ts (client-safe) e são re-exportados aqui p/ compat.
 */

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

export type { GuildEntry, Alliance, GuildMeta } from "@/lib/guild";
export { guildMetaPadrao, parseGuildMeta, guildaPorId, guildaPorTag, iconeUrl } from "@/lib/guild";

export async function getGuildMeta(): Promise<GuildMeta> {
  try {
    const rows = (await sql`SELECT config FROM guild_meta WHERE id = 1`) as { config: string | null }[];
    return parseGuildMeta(rows[0]?.config ?? null);
  } catch {
    return guildMetaPadrao(); // tabela ainda não migrada → padrão
  }
}

export async function setGuildMeta(raw: unknown): Promise<GuildMeta> {
  const meta = parseGuildMeta(raw);
  await sql`INSERT INTO guild_meta (id, config) VALUES (1, ${JSON.stringify(meta)})
    ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config`;
  return meta;
}

/**
 * Puxa nome/ícone/banner do SERVIDOR do Discord da aliança (bot token + guildId da config).
 * Retorna null se não configurado ou se a API falhar. Usado pra popular a marca do app.
 */
export async function fetchAllianceFromDiscord(): Promise<{ nome: string; icone: string; banner: string } | null> {
  const { guildId } = await getDiscordConfig();
  if (!BOT_TOKEN || !guildId) return null;
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }, cache: "no-store",
    });
    if (!res.ok) return null;
    const g = (await res.json()) as { name?: string; icon?: string | null; banner?: string | null };
    const cdn = (kind: string, hash?: string | null) =>
      hash ? `https://cdn.discordapp.com/${kind}/${guildId}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}?size=${kind === "banners" ? 1024 : 256}` : "";
    return { nome: g.name ?? "", icone: cdn("icons", g.icon), banner: cdn("banners", g.banner) };
  } catch {
    return null;
  }
}
