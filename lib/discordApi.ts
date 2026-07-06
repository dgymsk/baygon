/** Chamadas REST autenticadas com o BOT TOKEN (mesmo bot da leitura de confirmados). */
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API = "https://discord.com/api/v10";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const botConfigurado = () => !!BOT_TOKEN;

/** Fetch autenticado honrando Retry-After (429), como em lib/confirmados.ts. */
export async function botFetch(path: string, init: RequestInit = {}, tentativas = 3): Promise<Response> {
  const headers = { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) };
  let res = await fetch(`${API}${path}`, { ...init, headers, cache: "no-store" });
  for (let t = 1; t < tentativas && res.status === 429; t++) {
    const ra = Number(res.headers.get("retry-after")) || 1;
    if (ra > 5) break;
    await sleep(Math.min(ra, 5) * 1000 + 100);
    res = await fetch(`${API}${path}`, { ...init, headers, cache: "no-store" });
  }
  return res;
}

export type EmojiGuild = { id: string; name: string; animated: boolean };
let emojiCache: { at: number; data: EmojiGuild[] } | null = null;

/** Emojis customizados do servidor (cache de 60s). Vazio se sem bot/guild. */
export async function listarEmojisGuild(): Promise<EmojiGuild[]> {
  const gid = (process.env.DISCORD_GUILD_ID ?? "").split(",").map((s) => s.trim()).filter(Boolean)[0];
  if (!BOT_TOKEN || !gid) return [];
  if (emojiCache && Date.now() - emojiCache.at < 60_000) return emojiCache.data;
  try {
    const res = await botFetch(`/guilds/${gid}/emojis`);
    if (!res.ok) return emojiCache?.data ?? [];
    const arr = (await res.json()) as { id: string; name: string; animated?: boolean }[];
    const data = arr.filter((e) => e.id && e.name).map((e) => ({ id: e.id, name: e.name, animated: !!e.animated }));
    emojiCache = { at: Date.now(), data };
    return data;
  } catch { return emojiCache?.data ?? []; }
}

/** Resolve um input de emoji: ':nome:'/'nome' → '<:nome:id>' (via emojis do server); mantém unicode/já-formatado. */
export function resolverEmoji(input: string, emojis: EmojiGuild[]): string {
  const s = (input || "").trim();
  if (!s || /^<a?:\w+:\d+>$/.test(s)) return s; // vazio ou já no formato completo
  const m = s.match(/^:?([\w~]+):?$/); // ':nome:' ou 'nome'
  if (m) {
    const e = emojis.find((x) => x.name.toLowerCase() === m[1].toLowerCase());
    if (e) return `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`;
  }
  return s; // emoji unicode ou nome não encontrado — mantém como veio
}
