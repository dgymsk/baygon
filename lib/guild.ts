/**
 * Identidade da aliança/guildas — parte PURA (sem acesso a banco), importável tanto
 * no servidor quanto em componentes client. As funções de leitura/gravação e o fetch
 * do Discord ficam em lib/guildConfig.ts (server-only).
 */

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
const idOk = (v: unknown) => str(v, 12).toUpperCase().replace(/[^A-Z0-9]/g, "");
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

// ————— resolvers —————
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
