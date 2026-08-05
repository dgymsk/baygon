import { getDiscordConfig } from "@/lib/discordConfig";

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

export type EmojiGuild = { id: string; name: string; animated: boolean; guilda: string };
let emojiCache: { at: number; chave: string; data: EmojiGuild[] } | null = null;

/**
 * Emojis customizados de TODOS os servidores onde o bot está (cache de 60s).
 *
 * Não só o servidor ativo: um bot pode usar emoji de qualquer guild da qual participa, em qualquer
 * canal. Listar só o ativo escondia os que a guilda usa de verdade — depois da migração pro Psicose
 * (13 emojis) sumiram do seletor os ícones de classe e de PT, que moram na BAYGON e na Manicômio,
 * mesmo continuando a renderizar normalmente onde já estavam salvos.
 *
 * Os do servidor ativo vêm primeiro: com nome repetido entre servidores (`:flame:` existe em dois),
 * quem resolve por nome deve casar com o de casa.
 */
export async function listarEmojisGuild(): Promise<EmojiGuild[]> {
  const ativo = (await getDiscordConfig()).guildId;
  if (!BOT_TOKEN) return [];
  try {
    const gres = await botFetch(`/users/@me/guilds`);
    if (!gres.ok) return emojiCache?.data ?? [];
    const guilds = (await gres.json()) as { id: string; name: string }[];
    // ativo primeiro, o resto por nome — a ordem é o critério de desempate na resolução por nome
    const ordenadas = [...guilds].sort((a, b) =>
      (a.id === ativo ? -1 : 0) - (b.id === ativo ? -1 : 0) || a.name.localeCompare(b.name, "pt-BR"));

    // cache inclui as guilds: trocar o servidor ativo (ou entrar/sair de um) tem que invalidar
    const chave = ordenadas.map((g) => g.id).join(",");
    if (emojiCache && emojiCache.chave === chave && Date.now() - emojiCache.at < 60_000) return emojiCache.data;

    const listas = await Promise.all(ordenadas.map(async (g) => {
      const res = await botFetch(`/guilds/${g.id}/emojis`);
      if (!res.ok) return [];
      const arr = (await res.json()) as { id: string; name: string; animated?: boolean }[];
      return arr.filter((e) => e.id && e.name).map((e) => ({ id: e.id, name: e.name, animated: !!e.animated, guilda: g.name }));
    }));
    const vistos = new Set<string>();
    const data: EmojiGuild[] = [];
    for (const e of listas.flat()) { if (vistos.has(e.id)) continue; vistos.add(e.id); data.push(e); }
    emojiCache = { at: Date.now(), chave, data };
    return data;
  } catch { return emojiCache?.data ?? []; }
}

export type RoleGuild = { id: string; name: string };
let roleCache: { at: number; data: RoleGuild[] } | null = null;

/** Cargos do servidor ATIVO (sem @everyone), do topo pro fim (cache de 60s). Vazio se sem bot/guild. */
export async function listarRolesGuild(): Promise<RoleGuild[]> {
  const gid = (await getDiscordConfig()).guildId;
  if (!BOT_TOKEN || !gid) return [];
  if (roleCache && Date.now() - roleCache.at < 60_000) return roleCache.data;
  try {
    const res = await botFetch(`/guilds/${gid}/roles`);
    if (!res.ok) return roleCache?.data ?? [];
    const arr = (await res.json()) as { id: string; name: string; position: number }[];
    const data = arr
      .filter((r) => r.id && r.id !== gid) // remove @everyone (id == guildId)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, name: r.name }));
    roleCache = { at: Date.now(), data };
    return data;
  } catch { return roleCache?.data ?? []; }
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
