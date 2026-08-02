/**
 * Lê a mensagem de confirmação do bot Apollo (embed) nos canais do Discord, via bot token.
 * Aqui mora só o I/O (quais canais, fetch, cache, erros); o parse do embed é puro e fica em
 * lib/apolloEmbed.ts.
 */

import { sql } from "@/lib/db";
import { parseConfig } from "@/lib/ptConfig";
import { getDiscordConfig, canaisDe } from "@/lib/discordConfig";
import { getGuildMeta } from "@/lib/guildConfig";
import { parseEmbedApollo, tagRegex, type GrupoConf, type PlayerConf } from "@/lib/apolloEmbed";

// os tipos do parse moram em lib/apolloEmbed.ts; re-exportados aqui pra não quebrar quem importa
export type { Tag, PlayerConf, GrupoConf } from "@/lib/apolloEmbed";

export type Confirmados = {
  ok: boolean;
  erro?: string;
  title?: string;
  inicioUnix?: number;
  messageTs?: string;
  messageId?: string; // id da mensagem do bot = chave da war (p/ auto-reset do scan)
  canalId?: string;   // de QUAL canal veio o embed (com N canais configurados, importa saber)
  canalNome?: string;
  canaisLidos?: number; // quantos canais foram consultados nesta leitura
  grupos: GrupoConf[];
  listaEspera: PlayerConf[];
};

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

/** Canais do embed do Apollo, escolhidos pelo MODO (nodewar|siege) do "Montar PTs".
 *  Vêm da config geral do Discord (discord_config, com fallback pro env). É uma LISTA:
 *  onde o Apollo posta um evento por canal de dia da semana, lemos todos e ficamos com o
 *  post mais recente. Config de canal único continua funcionando (lista de 1). */
async function canaisDoModo(): Promise<string[]> {
  const dc = await getDiscordConfig();
  try {
    const rows = (await sql`SELECT pt_config FROM pt_meta WHERE id = 1`) as { pt_config: string | null }[];
    const siege = rows[0]?.pt_config ? parseConfig(rows[0].pt_config).modo === "siege" : false;
    return canaisDe(siege ? dc.confirmSiege : dc.confirmNodewar);
  } catch {
    return canaisDe(dc.confirmNodewar); // banco indisponível → assume nodewar
  }
}

type MsgApollo = { id?: string; embeds?: { title?: string; fields?: { name: string; value: string }[] }[]; author?: { username?: string; bot?: boolean }; timestamp?: string };

// Cache curto em memória: o Discord limita por canal (429). Numa rajada de leituras
// (render da página + cada save relendo a war + router.refresh) compartilhamos 1 chamada.
// A chave é a LISTA de canais — trocar o modo/os canais invalida o cache.
let cache: { at: number; chave: string; data: Confirmados } | null = null;
const TTL_MS = Number(process.env.CONFIRMADOS_TTL_MS ?? 10_000);
const sleepC = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Nome do canal (#sala) — só pra mostrar na tela de qual sala veio a leitura.
 *  Cache próprio: nome de canal quase nunca muda e não vale uma chamada por render. */
const nomesCanal = new Map<string, string>();
async function nomeDoCanal(id: string): Promise<string | undefined> {
  const cached = nomesCanal.get(id);
  if (cached) return cached;
  try {
    const r = await fetch(`https://discord.com/api/v10/channels/${id}`, { headers: { Authorization: `Bot ${BOT_TOKEN}` }, cache: "no-store" });
    if (!r.ok) return undefined;
    const nome = ((await r.json()) as { name?: string }).name;
    if (nome) nomesCanal.set(id, nome);
    return nome;
  } catch {
    return undefined;
  }
}

/** Últimas mensagens de UM canal, com 1 retry honrando o Retry-After do 429. */
async function lerCanal(channel: string): Promise<{ ok: true; msgs: MsgApollo[] } | { ok: false; status: number }> {
  const url = `https://discord.com/api/v10/channels/${channel}/messages?limit=15`;
  const opts = { headers: { Authorization: `Bot ${BOT_TOKEN}` }, cache: "no-store" as const };
  try {
    let res: Response | null = null;
    for (let t = 0; t < 2; t++) {
      res = await fetch(url, opts);
      if (res.status !== 429) break;
      const ra = Number(res.headers.get("retry-after")) || 1;
      if (t === 1 || ra > 3) break; // não espera demais (mantém o render rápido)
      await sleepC(Math.min(ra, 3) * 1000 + 100);
    }
    if (!res || !res.ok) return { ok: false, status: res?.status ?? 0 };
    return { ok: true, msgs: (await res.json()) as MsgApollo[] };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function fetchConfirmados(): Promise<Confirmados> {
  const [canais, meta] = await Promise.all([canaisDoModo(), getGuildMeta()]);
  const tagRe = tagRegex(meta.guildas.map((g) => g.tag).filter(Boolean));
  if (!BOT_TOKEN || !canais.length) return { ok: false, erro: "bot não configurado", grupos: [], listaEspera: [] };

  const chave = canais.join(",");
  if (cache && cache.data.ok && cache.chave === chave && Date.now() - cache.at < TTL_MS) return cache.data;

  // lê os canais em paralelo e fica com o embed do Apollo MAIS RECENTE entre eles
  const lidos = await Promise.all(canais.map(lerCanal));
  let apollo: MsgApollo | undefined;
  let canalId: string | undefined;
  let falhas = 0, proibido = 0, transiente = false;
  lidos.forEach((r, i) => {
    if (!r.ok) {
      falhas++;
      if (r.status === 403) proibido++;
      if (r.status === 429 || r.status >= 500 || r.status === 0) transiente = true;
      return;
    }
    const m = r.msgs.find((x) => x.embeds?.length && x.author?.bot) ?? r.msgs.find((x) => x.embeds?.length);
    if (!m?.embeds?.[0]?.fields?.length) return;
    if (!apollo || (m.timestamp ?? "") > (apollo.timestamp ?? "")) { apollo = m; canalId = canais[i]; }
  });

  if (!apollo) {
    // transiente (limite/instabilidade) → devolve o último bom (dos MESMOS canais) em vez de quebrar a tela
    if (cache?.data.ok && cache.chave === chave && transiente) return cache.data;
    const erro = falhas === canais.length
      ? (proibido ? "bot sem acesso ao(s) canal(is)" : transiente ? "Discord indisponível (limite/instabilidade)" : "falha ao ler o Discord")
      : "nenhuma mensagem de confirmação encontrada";
    return { ok: false, erro, grupos: [], listaEspera: [] };
  }
  const msg: MsgApollo = apollo;
  const embed = msg.embeds![0];
  const { grupos, listaEspera, inicioUnix } = parseEmbedApollo(embed, tagRe);
  const canalNome = canalId ? await nomeDoCanal(canalId) : undefined;

  const data: Confirmados = {
    ok: true, title: embed.title, inicioUnix, messageTs: msg.timestamp, messageId: msg.id,
    canalId, canalNome, canaisLidos: canais.length, grupos, listaEspera,
  };
  cache = { at: Date.now(), chave, data };
  return data;
}
