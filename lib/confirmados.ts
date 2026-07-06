/**
 * Lê a mensagem de confirmação do bot Apollo (embed) num canal do Discord,
 * via bot token, e extrai os players confirmados por grupo + a lista de espera.
 */

import { sql } from "@/lib/db";
import { parseConfig } from "@/lib/ptConfig";
import { getDiscordConfig } from "@/lib/discordConfig";

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

/** Canal do embed do Apollo, escolhido pelo MODO (nodewar|siege) do "Montar PTs".
 *  Os canais vêm da config geral do Discord (discord_config, com fallback pro env). */
async function canalDoModo(): Promise<string | undefined> {
  const dc = await getDiscordConfig();
  try {
    const rows = (await sql`SELECT pt_config FROM pt_meta WHERE id = 1`) as { pt_config: string | null }[];
    const siege = rows[0]?.pt_config ? parseConfig(rows[0].pt_config).modo === "siege" : false;
    return (siege ? dc.confirmSiege : dc.confirmNodewar) || undefined;
  } catch {
    return dc.confirmNodewar || undefined; // banco indisponível → assume nodewar
  }
}

export type Tag = "M" | "R" | null;
// iconKey: chave do ícone (pt) da linha — usado p/ casar quem está na espera com seu grupo.
export type PlayerConf = { tag: Tag; nome: string; nota: string | null; iconKey?: string | null };
export type GrupoConf = { nome: string; capacidade: string | null; limite: number | null; iconKey: string | null; players: PlayerConf[] };
export type Confirmados = {
  ok: boolean;
  erro?: string;
  title?: string;
  inicioUnix?: number;
  messageTs?: string;
  messageId?: string; // id da mensagem do bot = chave da war (p/ auto-reset do scan)
  grupos: GrupoConf[];
  listaEspera: PlayerConf[];
};

// remove emojis custom (<:nome:id>), unicode, menções (<@&id>), cadeado e blockquote
function limpa(s: string): string {
  return s
    .replace(/<a?:\w+:\d+>/g, "")
    .replace(/<@[!&]?\d+>/g, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200B}]/gu, "")
    .trim();
}

/**
 * Extrai a CHAVE do ícone (pt) no começo de uma string. Custom emoji <:nome:id>
 * (ou animado <a:nome:id>) → "c<id>"; emoji unicode (ex.: 🛡) → "u<char>". Mesma
 * chave nos dois lados (nome do grupo e linha da espera) = mesma pt. Sem ícone → null.
 */
function iconeChave(raw: string): string | null {
  const s = raw.replace(/^>>>\s*/, "").replace(/^\u{1F512}/u, "").trimStart();
  const cm = s.match(/^<a?:\w+:(\d+)>/);
  if (cm) return `c${cm[1]}`;
  const um = s.match(/^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/u);
  if (um) return `u${um[1].replace(/[\uFE0F\u200B\u200D]/g, "")}`;
  return null;
}

function parsePlayer(line: string): PlayerConf | null {
  const iconKey = iconeChave(line);
  const s = limpa(line.replace(/^>>>\s*/, "")).replace(/\\([_*~`])/g, "$1").trim();
  const m = s.match(/^\[([MR])\]\s*(.+)$/);
  if (!m) return null;
  let nome = m[2].trim();
  let nota: string | null = null;
  const pm = nome.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (pm) { nome = pm[1].trim(); nota = pm[2].trim(); }
  return nome ? { tag: m[1] as Tag, nome, nota, iconKey } : null;
}

// Cache curto em memória: o Discord limita por canal (429). Numa rajada de leituras
// (render da página + cada save relendo a war + router.refresh) compartilhamos 1 chamada.
let cache: { at: number; channel: string; data: Confirmados } | null = null;
const TTL_MS = Number(process.env.CONFIRMADOS_TTL_MS ?? 10_000);
const sleepC = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchConfirmados(): Promise<Confirmados> {
  const CHANNEL = await canalDoModo();
  if (!BOT_TOKEN || !CHANNEL) return { ok: false, erro: "bot não configurado", grupos: [], listaEspera: [] };

  if (cache && cache.data.ok && cache.channel === CHANNEL && Date.now() - cache.at < TTL_MS) return cache.data;

  let msgs: { id?: string; embeds?: { title?: string; fields?: { name: string; value: string }[] }[]; author?: { username?: string; bot?: boolean }; timestamp?: string }[];
  try {
    const url = `https://discord.com/api/v10/channels/${CHANNEL}/messages?limit=15`;
    const opts = { headers: { Authorization: `Bot ${BOT_TOKEN}` }, cache: "no-store" as const };
    let res: Response | null = null;
    for (let t = 0; t < 2; t++) { // 1 tentativa + 1 retry honrando o Retry-After do 429
      res = await fetch(url, opts);
      if (res.status !== 429) break;
      const ra = Number(res.headers.get("retry-after")) || 1;
      if (t === 1 || ra > 3) break; // não espera demais (mantém o render rápido)
      await sleepC(Math.min(ra, 3) * 1000 + 100);
    }
    if (!res || !res.ok) {
      const status = res?.status ?? 0;
      // erro transiente (limite/instabilidade) → devolve o último bom (do MESMO canal), em vez de quebrar a tela
      if (cache?.data.ok && cache.channel === CHANNEL && (status === 429 || status >= 500 || status === 0)) return cache.data;
      const erro = status === 403 ? "bot sem acesso ao canal"
        : status === 429 ? "Discord 429 (limite de chamadas — tente de novo em alguns segundos)"
        : `Discord ${status || "rede"}`;
      return { ok: false, erro, grupos: [], listaEspera: [] };
    }
    msgs = await res.json();
  } catch (e) {
    if (cache?.data.ok && cache.channel === CHANNEL) return cache.data; // rede caiu → usa o último bom (mesmo canal)
    return { ok: false, erro: (e as Error).message, grupos: [], listaEspera: [] };
  }

  const apollo = msgs.find((m) => m.embeds?.length && m.author?.bot) ?? msgs.find((m) => m.embeds?.length);
  const embed = apollo?.embeds?.[0];
  if (!embed?.fields?.length) return { ok: false, erro: "nenhuma mensagem de confirmação encontrada", grupos: [], listaEspera: [] };

  const grupos: GrupoConf[] = [];
  const listaEspera: PlayerConf[] = [];
  let inWaitlist = false;
  let inicioUnix: number | undefined;

  for (const f of embed.fields) {
    const nome = limpa(f.name);
    if (/^hor[aá]rio$/i.test(nome)) {
      const t = f.value.match(/<t:(\d+):/);
      if (t) inicioUnix = Number(t[1]);
      continue;
    }
    // a espera é detectada ANTES de tentar casar como grupo — o Apollo pode titular
    // o cabeçalho da espera com contagem ("Lista de espera (3/30)"), que casaria o
    // regex de capacidade e viraria um "grupo" fantasma, comendo os reservas.
    if (/lista de espera/i.test(nome) || inWaitlist || !nome) {
      inWaitlist = true;
      listaEspera.push(...f.value.split("\n").map(parsePlayer).filter((p): p is PlayerConf => !!p));
      continue;
    }
    const cap = nome.match(/^(.*?)\s*\((\d+\/(\d+))\)\s*$/);
    if (cap) {
      const players = f.value.split("\n").map(parsePlayer).filter((p): p is PlayerConf => !!p);
      grupos.push({ nome: cap[1].trim(), capacidade: cap[2], limite: Number(cap[3]), iconKey: iconeChave(f.name), players });
    }
  }

  const data: Confirmados = { ok: true, title: embed.title, inicioUnix, messageTs: apollo?.timestamp, messageId: apollo?.id, grupos, listaEspera };
  cache = { at: Date.now(), channel: CHANNEL, data };
  return data;
}
