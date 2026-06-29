import { chaveNome } from "@/lib/nomes";

/**
 * Template das PTs (squads) do board "Montar PTs". Config POR MODO (nodewar | siege),
 * cada um com N PTs numeradas (slider) + PTs NOMEADAS editáveis, cada uma com um ícone
 * (emoji unicode, emoji do Discord "<:nome:id>", ou nada → iniciais).
 * Chaves: numeradas = "1".."5" (nodewar) / "sg1".."sg5" (siege); nomeadas = id estável.
 * Modos não misturam marcações (chaves distintas). Puro — usável no client.
 */
export type PtIcon = { kind: "num"; n: string } | { kind: "cdn"; id: string } | { kind: "emoji"; e: string } | { kind: "txt"; t: string };
export type PtDef = { key: string; nome: string; icon: PtIcon };

export type PtEntry = { id: string; nome: string; icone: string };
export type ModoCfg = { num: number; extras: PtEntry[] };
export type PtConfig = { modo: "nodewar" | "siege"; nodewar: ModoCfg; siege: ModoCfg };

export const NUM_MIN = 0;
export const NUM_MAX = 5;
export const MAX_EXTRAS = 8;
export const clampNum = (n: unknown) => Math.max(NUM_MIN, Math.min(NUM_MAX, Math.trunc(Number(n) || 0)));

/** Config padrão (preserva as chaves atuais: "1","2","defesa","ungabunga","sg1..","xflanco","xdefesa"). */
export function configPadrao(): PtConfig {
  return {
    modo: "nodewar",
    nodewar: { num: 2, extras: [{ id: "defesa", nome: "Defesa", icone: "🔥" }, { id: "ungabunga", nome: "UngaBunga", icone: "🦍" }] },
    siege: { num: 3, extras: [{ id: "xflanco", nome: "Flanco", icone: "⚔️" }, { id: "xdefesa", nome: "Defesa", icone: "🔥" }] },
  };
}

/** id estável de uma PT nomeada nova (slug do nome + sufixo, alfanumérico). */
export function novoId(nome: string, usados: Set<string>): string {
  const base = ("x" + chaveNome(nome).replace(/[^a-z0-9]/g, "").slice(0, 30)) || "x";
  let id = base;
  let i = 2;
  while (id === "x" || usados.has(id)) id = `${base}${i++}`;
  return id;
}

const idOk = (s: string) => /^[a-z0-9]{1,40}$/.test(s);

function sanitizaModo(raw: unknown, padrao: ModoCfg): ModoCfg {
  const r = (raw ?? {}) as { num?: unknown; extras?: unknown };
  const num = clampNum(r.num ?? padrao.num);
  const extras: PtEntry[] = [];
  const usados = new Set<string>();
  for (const e of Array.isArray(r.extras) ? r.extras : []) {
    const o = (e ?? {}) as { id?: unknown; nome?: unknown; icone?: unknown };
    const nome = typeof o.nome === "string" ? o.nome.replace(/\s+/g, " ").trim().slice(0, 24) : "";
    if (!nome) continue;
    // aceita o id do cliente só se for alfanumérico E não colidir com chave numerada ("2","sg1")
    const idCliente = typeof o.id === "string" && idOk(o.id) && !/^(sg)?\d+$/.test(o.id);
    let id = idCliente ? (o.id as string) : novoId(nome, usados);
    if (usados.has(id)) id = novoId(nome, usados);
    usados.add(id);
    const icone = typeof o.icone === "string" ? o.icone.trim().slice(0, 24) : "";
    extras.push({ id, nome, icone });
    if (extras.length >= MAX_EXTRAS) break;
  }
  return { num, extras };
}

/** Parseia/sanitiza a config (de JSON do banco ou do cliente) com defaults. */
export function parseConfig(raw: unknown): PtConfig {
  let obj: unknown = raw;
  if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { obj = null; } }
  const o = (obj ?? {}) as Partial<PtConfig>;
  const pad = configPadrao();
  return {
    modo: o.modo === "siege" ? "siege" : "nodewar",
    nodewar: sanitizaModo(o.nodewar, pad.nodewar),
    siege: sanitizaModo(o.siege, pad.siege),
  };
}

export function iconeDe(icone: string, nome: string): PtIcon {
  const m = (icone || "").trim().match(/^<a?:\w+:(\d+)>$/);
  if (m) return { kind: "cdn", id: m[1] };
  const e = (icone || "").trim();
  if (e) return { kind: "emoji", e: e.slice(0, 4) };
  return { kind: "txt", t: nome.slice(0, 2).toUpperCase() };
}

/** PTs ATIVAS do modo atual (numeradas + nomeadas, com ícone). */
export function ptsAtivas(cfg: PtConfig): PtDef[] {
  const m = cfg.modo === "siege" ? cfg.siege : cfg.nodewar;
  const prefixo = cfg.modo === "siege" ? "sg" : "";
  const out: PtDef[] = [];
  for (let i = 1; i <= clampNum(m.num); i++) out.push({ key: `${prefixo}${i}`, nome: `PT${i}`, icon: { kind: "num", n: String(i) } });
  for (const e of m.extras) out.push({ key: e.id, nome: e.nome, icon: iconeDe(e.icone, e.nome) });
  return out;
}

/** Chave de PT válida p/ gravar (numeradas ou id de PT nomeada — alfanumérico). */
export function ptChaveValida(k: string): boolean {
  return idOk(k);
}
