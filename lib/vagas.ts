import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";

export type Guilda = "MANI" | "RESO";
export type VagaGuilda = { hidden: number; texto: string };
export type Vagas = Record<Guilda, VagaGuilda>;

const clampHidden = (n: unknown) => Math.max(0, Math.min(999, Math.trunc(Number(n) || 0)));

export async function getVagas(): Promise<Vagas> {
  const rows = (await sql`SELECT guilda, hidden, texto FROM vagas_config`) as { guilda: Guilda; hidden: number; texto: string }[];
  const out: Vagas = { MANI: { hidden: 0, texto: "" }, RESO: { hidden: 0, texto: "" } };
  for (const r of rows) {
    if (r.guilda === "MANI" || r.guilda === "RESO") out[r.guilda] = { hidden: Number(r.hidden) || 0, texto: r.texto ?? "" };
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
  const atual = await getVagas();
  const merge = (g: Guilda): VagaGuilda => {
    const pg = p[g];
    const cur = atual[g];
    if (!pg || typeof pg !== "object" || Array.isArray(pg)) return cur;
    const o = pg as Record<string, unknown>;
    return {
      hidden: "hidden" in o ? clampHidden(o.hidden) : cur.hidden,
      texto: "texto" in o ? String(o.texto ?? "").slice(0, 4000) : cur.texto,
    };
  };
  const mani = merge("MANI");
  const reso = merge("RESO");
  await sql.transaction([
    sql`INSERT INTO vagas_config (guilda, hidden, texto) VALUES ('MANI', ${mani.hidden}, ${mani.texto})
        ON CONFLICT (guilda) DO UPDATE SET hidden = EXCLUDED.hidden, texto = EXCLUDED.texto`,
    sql`INSERT INTO vagas_config (guilda, hidden, texto) VALUES ('RESO', ${reso.hidden}, ${reso.texto})
        ON CONFLICT (guilda) DO UPDATE SET hidden = EXCLUDED.hidden, texto = EXCLUDED.texto`,
  ]);
  return { MANI: mani, RESO: reso };
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
