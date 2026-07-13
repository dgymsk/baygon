import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import { getGuildMeta } from "@/lib/guildConfig";

export type VagaGuilda = { hidden: number; texto: string };
/** Vagas por guilda, chaveadas pelo id da guilda configurada (ex. MANI/RESO). */
export type Vagas = Record<string, VagaGuilda>;

const clampHidden = (n: unknown) => Math.max(0, Math.min(999, Math.trunc(Number(n) || 0)));

export async function getVagas(): Promise<Vagas> {
  const meta = await getGuildMeta();
  const rows = (await sql`SELECT guilda, hidden, texto FROM vagas_config`) as { guilda: string; hidden: number; texto: string }[];
  const out: Vagas = {};
  for (const g of meta.guildas) out[g.id] = { hidden: 0, texto: "" }; // toda guilda configurada tem um slot
  const salvo = new Map(rows.map((r) => [r.guilda, r]));
  for (const g of meta.guildas) {
    const r = salvo.get(g.id);
    if (r) out[g.id] = { hidden: Number(r.hidden) || 0, texto: r.texto ?? "" };
  }
  return out;
}

/**
 * Merge-update: só altera o que vier no patch. Guilda ou campo ausente = mantém
 * o valor atual (NÃO zera). texto "" explícito limpa de propósito. Devolve o
 * estado final. Body fora do formato é ignorado campo a campo (sem apagar).
 */
export async function saveVagas(patch: unknown): Promise<Vagas> {
  const p = (patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {}) as Record<string, unknown>;
  const [meta, atual] = await Promise.all([getGuildMeta(), getVagas()]);
  const merge = (id: string): VagaGuilda => {
    const pg = p[id];
    const cur = atual[id] ?? { hidden: 0, texto: "" };
    if (!pg || typeof pg !== "object" || Array.isArray(pg)) return cur;
    const o = pg as Record<string, unknown>;
    return {
      hidden: "hidden" in o ? clampHidden(o.hidden) : cur.hidden,
      texto: "texto" in o ? String(o.texto ?? "").slice(0, 4000) : cur.texto,
    };
  };
  const finais: Vagas = {};
  const stmts = meta.guildas.map((g) => {
    const v = merge(g.id);
    finais[g.id] = v;
    return sql`INSERT INTO vagas_config (guilda, hidden, texto) VALUES (${g.id}, ${v.hidden}, ${v.texto})
        ON CONFLICT (guilda) DO UPDATE SET hidden = EXCLUDED.hidden, texto = EXCLUDED.texto`;
  });
  if (stmts.length) await sql.transaction(stmts);
  return finais;
}

/** Nomes do texto: 1 por linha (ou vírgula/;), espaços internos colapsados, sem duplicatas (case/acento). */
export function nomesDoTexto(texto: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (texto ?? "").split(/[\n,;]+/)) {
    const nome = raw.replace(/\s+/g, " ").trim();
    if (!nome) continue;
    const k = chaveNome(nome);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(nome);
  }
  return out;
}
