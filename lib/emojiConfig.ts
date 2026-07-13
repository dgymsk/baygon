import { sql } from "@/lib/db";
import { listarEmojisGuild, resolverEmoji } from "@/lib/discordApi";

/** Mapa de emojis por classe e por guilda (MANI/RESO), usado no embed do bot. */
export type EmojiMap = { classes: Record<string, string>; guildas: Record<string, string> };

const limpaMapa = (o: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (o && typeof o === "object") for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k.slice(0, 60)] = v.trim().slice(0, 80);
  }
  return out;
};

export async function getEmojiMap(): Promise<EmojiMap> {
  const rows = (await sql`SELECT config FROM emoji_config WHERE id = 1`) as { config: { classes?: unknown; guildas?: unknown } | null }[];
  const c = rows[0]?.config ?? {};
  return { classes: limpaMapa(c.classes), guildas: limpaMapa(c.guildas) };
}

export async function setEmojiMap(raw: unknown): Promise<EmojiMap> {
  const c = (raw ?? {}) as { classes?: unknown; guildas?: unknown };
  const m: EmojiMap = { classes: limpaMapa(c.classes), guildas: limpaMapa(c.guildas) };
  await sql`INSERT INTO emoji_config (id, config) VALUES (1, ${JSON.stringify(m)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config`;
  return m;
}

/** Mapa com cada valor RESOLVIDO (':nome:' → '<:nome:id>' via emojis do server; unicode/formatado passa). */
export async function getEmojiMapResolvido(): Promise<EmojiMap> {
  const [m, emojis] = await Promise.all([getEmojiMap(), listarEmojisGuild()]);
  const res = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, resolverEmoji(v, emojis)]));
  return { classes: res(m.classes), guildas: res(m.guildas) };
}
