import { chaveNome } from "@/lib/nomes";

/**
 * Template das PTs (squads) do board "Montar PTs", conforme o tipo de evento.
 *  - nodewar: PT1, PT2, Defesa, UngaBunga (fixo);
 *  - siege:   N PTs numeradas (1-5, slider) + PTs NOMEADAS editáveis (ex.: Flanco, Defesa).
 * As chaves do siege (sg.. e x..) são separadas das de nodewar, então marcar num modo
 * não mistura com o outro. Puro (sem imports de servidor) — usável no client.
 */
export type PtIcon = { kind: "num"; n: string } | { kind: "cdn"; id: string } | { kind: "emoji"; e: string } | { kind: "txt"; t: string };
export type PtDef = { key: string; nome: string; icon: PtIcon };

const FLAME_ID = "1459738870592835584"; // emoji "flame" do bot = Defesa (nodewar)
const UNGA_ID = "1512543325851353208"; // emoji ":ungaungacore:" = UngaBunga (nodewar)

export const SIEGE_MIN = 1;
export const SIEGE_MAX = 5;
export const MAX_EXTRAS = 8;
export const clampSiege = (n: number) => Math.max(SIEGE_MIN, Math.min(SIEGE_MAX, Math.trunc(Number(n) || SIEGE_MIN)));

const FIXAS = new Set(["1", "2", "defesa", "ungabunga", "sg1", "sg2", "sg3", "sg4", "sg5"]);

/** Chave estável de uma PT nomeada (namespace "x" + slug do nome). */
export function xKey(nome: string): string {
  return "x" + chaveNome(nome).replace(/[^a-z0-9]/g, "").slice(0, 40);
}

/** Parseia o texto das PTs nomeadas (sep. por vírgula/linha/;) → lista {key, nome} sem repetir. */
export function parseExtras(texto: string): { key: string; nome: string }[] {
  const out: { key: string; nome: string }[] = [];
  const visto = new Set<string>();
  for (const raw of (texto || "").split(/[\n,;]+/)) {
    const nome = raw.replace(/\s+/g, " ").trim().slice(0, 24);
    if (!nome) continue;
    const key = xKey(nome);
    if (key === "x" || visto.has(key)) continue; // vazio após slug, ou duplicado
    visto.add(key);
    out.push({ key, nome });
    if (out.length >= MAX_EXTRAS) break;
  }
  return out;
}

export function ptsAtivas(modo: string, siegePts: number, siegeExtras: string): PtDef[] {
  if (modo === "siege") {
    const n = clampSiege(siegePts);
    const out: PtDef[] = [];
    for (let i = 1; i <= n; i++) out.push({ key: `sg${i}`, nome: `PT${i}`, icon: { kind: "num", n: String(i) } });
    for (const e of parseExtras(siegeExtras)) out.push({ key: e.key, nome: e.nome, icon: { kind: "txt", t: e.nome.slice(0, 2).toUpperCase() } });
    return out;
  }
  return [
    { key: "1", nome: "PT1", icon: { kind: "num", n: "1" } },
    { key: "2", nome: "PT2", icon: { kind: "num", n: "2" } },
    { key: "defesa", nome: "Defesa", icon: { kind: "cdn", id: FLAME_ID } },
    { key: "ungabunga", nome: "UngaBunga", icon: { kind: "cdn", id: UNGA_ID } },
  ];
}

/** Chave de PT válida p/ gravar (fixas do template OU PT nomeada "x<slug>"). */
export function ptChaveValida(k: string): boolean {
  return FIXAS.has(k) || /^x[a-z0-9]{1,40}$/.test(k);
}
