import { sql } from "@/lib/db";
import { getDiscordConfig } from "@/lib/discordConfig";

/**
 * Identidade da ALIANÇA e das GUILDAS participantes — configurável (deixa a solução
 * agnóstica a quais guildas estão na ally). Persistida em guild_meta (singleton id=1),
 * mesmo padrão do discord_config/pt_meta. Se a tabela não existir ainda, cai no padrão
 * (retrocompatível: ids MANI/RESO batem com o que está no banco/CHECK).
 *
 * Modelo N-capaz:
 *  - alliance: marca do app (nome + ícone + banner, puxados do servidor do Discord).
 *  - guildas[]: cada guilda com { id (chave estável = players.guilda), tag (letra que o
 *    Apollo marca no apelido, ex "M"/"R"), nome, icone, cor }.
 */

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

export type GuildEntry = { id: string; tag: string; nome: string; icone: string; cor: string };
export type Alliance = { nome: string; icone: string; banner: string; cor: string };
export type GuildMeta = { alliance: Alliance; guildas: GuildEntry[] };

/** Padrão = identidade atual da aliança (Manicômio + Resonance). */
export function guildMetaPadrao(): GuildMeta {
  return {
    alliance: { nome: "BAYGON", icone: "", banner: "", cor: "#cc0000" },
    guildas: [
      { id: "MANI", tag: "M", nome: "Manicômio", icone: "/guilds/manicomio.png", cor: "#cc0000" },
      { id: "RESO", tag: "R", nome: "Resonance", icone: "/guilds/resonance.png", cor: "#a6a6a6" },
    ],
  };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const hex = (v: unknown) => { const s = str(v, 7); return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : ""; };
// id = chave estável (vai pro banco): alfanumérico maiúsculo, ≤12
const idOk = (v: unknown) => str(v, 12).toUpperCase().replace(/[^A-Z0-9]/g, "");
// tag = letra(s) que o Apollo põe no apelido "[M] Fulano" → maiúsculo, ≤3
const tagOk = (v: unknown) => str(v, 3).toUpperCase().replace(/[^A-Z0-9]/g, "");

function sanitizaEntry(raw: unknown, i: number): GuildEntry | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const id = idOk(o.id) || `G${i + 1}`;
  const nome = str(o.nome, 40) || id;
  return { id, tag: tagOk(o.tag) || id.slice(0, 1), nome, icone: str(o.icone, 240), cor: hex(o.cor) || "#a6a6a6" };
}

export function parseGuildMeta(raw: unknown): GuildMeta {
  let obj: unknown = raw;
  if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { obj = null; } }
  const o = (obj ?? {}) as Partial<GuildMeta>;
  const pad = guildMetaPadrao();
  const a = (o.alliance ?? {}) as Partial<Alliance>;
  const alliance: Alliance = {
    nome: str(a.nome, 40) || pad.alliance.nome,
    icone: str(a.icone, 300),
    banner: str(a.banner, 400),
    cor: hex(a.cor) || pad.alliance.cor,
  };
  const seen = new Set<string>();
  const guildas: GuildEntry[] = [];
  for (const [i, e] of (Array.isArray(o.guildas) ? o.guildas : []).entries()) {
    const g = sanitizaEntry(e, i);
    if (!g || seen.has(g.id)) continue;
    seen.add(g.id);
    guildas.push(g);
    if (guildas.length >= 12) break;
  }
  return { alliance, guildas: guildas.length ? guildas : pad.guildas };
}

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

// ————— resolvers (usados no site e no bot) —————
export const guildaPorId = (m: GuildMeta, id?: string | null) => (id ? m.guildas.find((g) => g.id === id) : undefined);
export const guildaPorTag = (m: GuildMeta, tag?: string | null) =>
  (tag ? m.guildas.find((g) => g.tag.toUpperCase() === tag.toUpperCase()) : undefined);

/** URL de imagem do ícone quando possível (url/caminho ou emoji custom do Discord); emoji unicode → null (renderiza como texto). */
export function iconeUrl(icone: string): string | null {
  const s = (icone || "").trim();
  if (!s) return null;
  if (/^https?:\/\//.test(s) || s.startsWith("/")) return s;
  const m = s.match(/^<(a?):\w+:(\d+)>$/);
  if (m) return `https://cdn.discordapp.com/emojis/${m[2]}.${m[1] ? "gif" : "png"}?size=64`;
  return null;
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
