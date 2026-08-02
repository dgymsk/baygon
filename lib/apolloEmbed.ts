/**
 * Parser do embed de confirmação do bot Apollo — PURO, sem I/O (nem banco, nem Discord).
 * Mora separado de lib/confirmados.ts (que faz a leitura do canal e o cache) pra poder ser
 * testado contra embeds reais.
 *
 * O Apollo muda de cara conforme o servidor, e o parser aguenta as duas:
 *  - idioma: campo "Horário"/"Time" e "Lista de espera"/"Waitlist";
 *  - TAG de guilda OPCIONAL: "[M] Fulano" (servidor da aliança) ou só "Fulano" / "[Fulano]"
 *    (servidor sem tag, onde o colchete é o apelido da própria pessoa).
 */

export type Tag = string | null; // tag da guilda vinda do Apollo ([M]/[R]/…), configurável em /guildas
// iconKey: chave do ícone (pt) da linha — usado p/ casar quem está na espera com seu grupo.
export type PlayerConf = { tag: Tag; nome: string; nota: string | null; iconKey?: string | null };
export type GrupoConf = { nome: string; capacidade: string | null; limite: number | null; iconKey: string | null; players: PlayerConf[] };
export type EmbedApollo = { title?: string; fields?: { name: string; value: string }[] };

// remove emojis custom (<:nome:id>), unicode, menções (<@&id>), cadeado e blockquote
export function limpa(s: string): string {
  return s
    .replace(/<a?:\w+:\d+>/g, "")
    .replace(/<@[!&]?\d+>/g, "")
    .replace(/<t:\d+(?::[a-zA-Z])?>/g, "")   // timestamp do Apollo (<t:123:F>) — aparece no campo "Time"
    .replace(/:[a-z0-9_]+:/gi, "")           // shortcode do Discord (:lock:) — a linha do cadeado do Apollo
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200B}]/gu, "")
    .trim();
}

/** Linha que não é jogador: sobra de menção/cadeado/timestamp, separador, vazio. */
export const ehRuido = (s: string) => !/[\p{L}\p{N}]/u.test(s);

/**
 * Extrai a CHAVE do ícone (pt) no começo de uma string. Custom emoji <:nome:id>
 * (ou animado <a:nome:id>) → "c<id>"; emoji unicode (ex.: 🛡) → "u<char>". Mesma
 * chave nos dois lados (nome do grupo e linha da espera) = mesma pt. Sem ícone → null.
 */
export function iconeChave(raw: string): string | null {
  const s = raw.replace(/^>>>\s*/, "").replace(/^\u{1F512}/u, "").trimStart();
  const cm = s.match(/^<a?:\w+:(\d+)>/);
  if (cm) return `c${cm[1]}`;
  const um = s.match(/^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/u);
  if (um) return `u${um[1].replace(/[\uFE0F\u200B\u200D]/g, "")}`;
  return null;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Regex "[TAG] Nome" com as tags configuradas (fallback M|R). */
export function tagRegex(tags: string[]): RegExp {
  const alt = (tags.length ? tags : ["M", "R"]).map(esc).join("|");
  return new RegExp(`^\\[(${alt})\\]\\s*(.+)$`, "i");
}

/** Uma linha do embed → jogador (ou null se for ruído). Sem tag reconhecida → tag = null. */
export function parsePlayer(line: string, tagRe: RegExp): PlayerConf | null {
  const iconKey = iconeChave(line);
  const s = limpa(line.replace(/^>>>\s*/, "")).replace(/\\([_*~`])/g, "$1").trim();
  if (ehRuido(s)) return null;

  const m = s.match(tagRe);
  let tag: Tag = null;
  let nome = s;
  if (m) {
    tag = m[1].toUpperCase();
    nome = m[2].trim();
  } else {
    const so = s.match(/^\[([^\]]+)\]$/); // nick inteiro entre colchetes ("[McFly]") → o nome é o miolo
    if (so) nome = so[1].trim();
  }

  let nota: string | null = null;
  const pm = nome.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (pm) { nome = pm[1].trim(); nota = pm[2].trim(); }
  return nome && !ehRuido(nome) ? { tag, nome, nota, iconKey } : null;
}

/** Embed do Apollo → grupos + lista de espera + horário de início. */
export function parseEmbedApollo(embed: EmbedApollo, tagRe: RegExp): { grupos: GrupoConf[]; listaEspera: PlayerConf[]; inicioUnix?: number } {
  const grupos: GrupoConf[] = [];
  const listaEspera: PlayerConf[] = [];
  let inWaitlist = false;
  let inicioUnix: number | undefined;

  for (const f of embed.fields ?? []) {
    const nome = limpa(f.name);
    // o Apollo pode estar em português ou inglês, dependendo do servidor
    if (/^(hor[aá]rio|time|when)$/i.test(nome)) {
      const t = f.value.match(/<t:(\d+):/);
      if (t) inicioUnix = Number(t[1]);
      continue;
    }
    // a espera é detectada ANTES de tentar casar como grupo — o Apollo pode titular
    // o cabeçalho da espera com contagem ("Lista de espera (3/30)"), que casaria o
    // regex de capacidade e viraria um "grupo" fantasma, comendo os reservas.
    if (/lista de espera|wait\s*list/i.test(nome) || inWaitlist || !nome) {
      inWaitlist = true;
      listaEspera.push(...f.value.split("\n").map((l) => parsePlayer(l, tagRe)).filter((p): p is PlayerConf => !!p));
      continue;
    }
    const cap = nome.match(/^(.*?)\s*\((\d+\/(\d+))\)\s*$/);
    if (cap) {
      const players = f.value.split("\n").map((l) => parsePlayer(l, tagRe)).filter((p): p is PlayerConf => !!p);
      grupos.push({ nome: cap[1].trim(), capacidade: cap[2], limite: Number(cap[3]), iconKey: iconeChave(f.name), players });
    }
  }
  return { grupos, listaEspera, inicioUnix };
}
