/**
 * Lê a mensagem de confirmação do bot Apollo (embed) nos canais do Discord, via bot token.
 * Aqui mora só o I/O (quais canais, fetch, cache, erros); o parse do embed é puro e fica em
 * lib/apolloEmbed.ts.
 */

import { sql } from "@/lib/db";
import { parseConfig } from "@/lib/ptConfig";
import { getDiscordConfig, canaisDe } from "@/lib/discordConfig";
import { getGuildMeta } from "@/lib/guildConfig";
import { parseEmbedApollo, inicioDoEmbed, tagRegex, type GrupoConf, type PlayerConf } from "@/lib/apolloEmbed";

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
  salas?: SalaConf[];   // todas as salas configuradas do modo, p/ o seletor da tela
  escolha?: Escolha;    // por que esta sala foi escolhida
  grupos: GrupoConf[];
  listaEspera: PlayerConf[];
};
export type SalaConf = { id: string; nome?: string; inicioUnix?: number; titulo?: string; hoje: boolean };
export type Escolha = "manual" | "dia" | "recente";

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

/** Nomes das salas (#sala) — só pra mostrar na tela e no seletor. Cache próprio: nome de canal
 *  quase nunca muda. Quando falta algum, puxa a lista do servidor INTEIRO numa chamada só,
 *  em vez de uma por canal. */
const nomesCanal = new Map<string, string>();
async function carregarNomes(canais: string[]): Promise<void> {
  if (canais.every((c) => nomesCanal.has(c))) return;
  try {
    const { guildId } = await getDiscordConfig();
    if (!guildId) return;
    const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers: { Authorization: `Bot ${BOT_TOKEN}` }, cache: "no-store" });
    if (!r.ok) return;
    for (const c of (await r.json()) as { id?: string; name?: string }[]) if (c.id && c.name) nomesCanal.set(c.id, c.name);
  } catch { /* fica sem nome — a tela mostra o id */ }
}

/** Data (YYYY-MM-DD) no fuso da guilda — "hoje" é o dia de Brasília, não o do servidor. */
const FUSO = process.env.FUSO_GUILDA ?? "America/Sao_Paulo";
const diaLocal = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

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

/**
 * Lê a confirmação do Apollo. Com várias salas configuradas (uma por dia da semana), a escolha é:
 *   1. `warKey` — usado pelos caminhos de ESCRITA: resolve a sala da mensagem que o cliente está
 *      vendo, pra um save não ser rejeitado só porque a escolha automática mudou no meio;
 *   2. `canal` — escolha manual do seletor da tela (?sala=);
 *   3. a war de HOJE (início do evento cai no dia de hoje, fuso de Brasília);
 *   4. o post mais recente (comportamento antigo, quando não há war hoje).
 *
 * O passo 3 existe porque o Apollo publica a war de amanhã ANTES da de hoje acontecer (~20:20):
 * por "mais recente" a tela pulava pro dia seguinte no meio da war em andamento.
 */
export async function fetchConfirmados(opts: { canal?: string; warKey?: string } = {}): Promise<Confirmados> {
  const [canais, meta] = await Promise.all([canaisDoModo(), getGuildMeta()]);
  const tagRe = tagRegex(meta.guildas.map((g) => g.tag).filter(Boolean));
  if (!BOT_TOKEN || !canais.length) return { ok: false, erro: "bot não configurado", grupos: [], listaEspera: [] };

  const forcado = opts.canal && canais.includes(opts.canal) ? opts.canal : undefined;
  const chave = `${canais.join(",")}|${forcado ?? ""}|${opts.warKey ?? ""}`;
  if (cache && cache.data.ok && cache.chave === chave && Date.now() - cache.at < TTL_MS) return cache.data;

  const lidos = await Promise.all(canais.map(lerCanal));
  await carregarNomes(canais);
  const hoje = diaLocal(new Date());

  type Cand = { canal: string; msg: MsgApollo; inicio?: number; hoje: boolean };
  const cands: Cand[] = [];
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
    const inicio = inicioDoEmbed(m.embeds[0]);
    cands.push({ canal: canais[i], msg: m, inicio, hoje: !!inicio && diaLocal(new Date(inicio * 1000)) === hoje });
  });

  const maisRecente = (a: Cand[]) => a.reduce<Cand | undefined>((b, c) => (!b || (c.msg.timestamp ?? "") > (b.msg.timestamp ?? "") ? c : b), undefined);
  let escolha: Escolha = "recente";
  let alvo: Cand | undefined;
  if (opts.warKey) alvo = cands.find((c) => c.msg.id === opts.warKey);          // 1) a war que o cliente vê
  if (!alvo && forcado) { alvo = cands.find((c) => c.canal === forcado); escolha = "manual"; }  // 2) seletor
  if (!alvo) {                                                                  // 3) a war de hoje
    const doDia = maisRecente(cands.filter((c) => c.hoje));
    if (doDia) { alvo = doDia; escolha = "dia"; }
  }
  if (!alvo) { alvo = maisRecente(cands); escolha = "recente"; }                 // 4) fallback

  const salas: SalaConf[] = canais.map((id) => {
    const c = cands.find((x) => x.canal === id);
    return { id, nome: nomesCanal.get(id), inicioUnix: c?.inicio, titulo: c?.msg.embeds?.[0]?.title, hoje: !!c?.hoje };
  });

  if (!alvo) {
    // transiente (limite/instabilidade) → devolve o último bom em vez de quebrar a tela
    if (cache?.data.ok && cache.chave === chave && transiente) return cache.data;
    const erro = falhas === canais.length
      ? (proibido ? "bot sem acesso ao(s) canal(is)" : transiente ? "Discord indisponível (limite/instabilidade)" : "falha ao ler o Discord")
      : "nenhuma mensagem de confirmação encontrada";
    return { ok: false, erro, salas, canaisLidos: canais.length, grupos: [], listaEspera: [] };
  }

  const embed = alvo.msg.embeds![0];
  const { grupos, listaEspera, inicioUnix } = parseEmbedApollo(embed, tagRe);

  const data: Confirmados = {
    ok: true, title: embed.title, inicioUnix, messageTs: alvo.msg.timestamp, messageId: alvo.msg.id,
    canalId: alvo.canal, canalNome: nomesCanal.get(alvo.canal), canaisLidos: canais.length, salas, escolha,
    grupos, listaEspera,
  };
  cache = { at: Date.now(), chave, data };
  return data;
}
