import { sql } from "@/lib/db";

export type Guilda = "MANI" | "RESO";
export type VagaGuilda = { hidden: number; texto: string };
export type Vagas = Record<Guilda, VagaGuilda>;

const VAZIO: Vagas = { MANI: { hidden: 0, texto: "" }, RESO: { hidden: 0, texto: "" } };

export async function getVagas(): Promise<Vagas> {
  const rows = (await sql`SELECT guilda, hidden, texto FROM vagas_config`) as { guilda: Guilda; hidden: number; texto: string }[];
  const out: Vagas = { MANI: { hidden: 0, texto: "" }, RESO: { hidden: 0, texto: "" } };
  for (const r of rows) {
    if (r.guilda === "MANI" || r.guilda === "RESO") out[r.guilda] = { hidden: Number(r.hidden) || 0, texto: r.texto ?? "" };
  }
  return out;
}

export async function saveVagas(v: Vagas): Promise<void> {
  const norm = (g: VagaGuilda): VagaGuilda => ({
    hidden: Math.max(0, Math.min(999, Math.trunc(Number(g?.hidden) || 0))),
    texto: typeof g?.texto === "string" ? g.texto.slice(0, 4000) : "",
  });
  const mani = norm(v?.MANI ?? VAZIO.MANI);
  const reso = norm(v?.RESO ?? VAZIO.RESO);
  await sql.transaction([
    sql`INSERT INTO vagas_config (guilda, hidden, texto) VALUES ('MANI', ${mani.hidden}, ${mani.texto})
        ON CONFLICT (guilda) DO UPDATE SET hidden = EXCLUDED.hidden, texto = EXCLUDED.texto`,
    sql`INSERT INTO vagas_config (guilda, hidden, texto) VALUES ('RESO', ${reso.hidden}, ${reso.texto})
        ON CONFLICT (guilda) DO UPDATE SET hidden = EXCLUDED.hidden, texto = EXCLUDED.texto`,
  ]);
}

/** Extrai nomes de família do texto (1 por linha, ou separados por vírgula/;). */
export function nomesDoTexto(texto: string): string[] {
  return (texto ?? "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
