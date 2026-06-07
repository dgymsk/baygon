import { sql } from "@/lib/db";

/** Gerenciamento de grupos (página /config). Grupo é texto em players.grupo + grupos_metricas.grupo. */

const METRICAS_BASE = ["dano_em_player", "dano_do_pino", "tempo_morto"];

const existe = async (g: string) =>
  (await sql`SELECT 1 WHERE EXISTS (SELECT 1 FROM players WHERE grupo = ${g})
                       OR EXISTS (SELECT 1 FROM grupos_metricas WHERE grupo = ${g})`).length > 0;

/** Lista de grupos canônicos (players ∪ grupos_metricas), exceto Indefinido. */
export async function listGruposCanonicos(): Promise<string[]> {
  const rows = (await sql`
    SELECT grupo FROM players
    UNION SELECT grupo FROM grupos_metricas
  `) as { grupo: string }[];
  return rows.map((r) => r.grupo).filter((g) => g && g !== "Indefinido").sort();
}

const MAXLEN = 40;
const valido = (g: string) => g.length > 0 && g.length <= MAXLEN && g !== "Indefinido";

export async function createGrupo(nome: string): Promise<"ok" | "existe" | "invalido"> {
  const g = nome.trim();
  if (!valido(g)) return "invalido";
  // dup case-insensitive (evita "Ranged" vs "ranged")
  const dup = await sql`SELECT 1 WHERE EXISTS (SELECT 1 FROM players WHERE lower(grupo) = lower(${g}))
                                   OR EXISTS (SELECT 1 FROM grupos_metricas WHERE lower(grupo) = lower(${g}))`;
  if (dup.length) return "existe";
  // métricas baseline; se nenhuma existir, cai pras 3 primeiras métricas — garante que o grupo persista
  let valid = ((await sql`SELECT metrica FROM metricas WHERE metrica = ANY(${METRICAS_BASE}::text[])`) as { metrica: string }[]).map((r) => r.metrica);
  if (!valid.length) valid = ((await sql`SELECT metrica FROM metricas ORDER BY metrica LIMIT 3`) as { metrica: string }[]).map((r) => r.metrica);
  if (!valid.length) return "invalido"; // não há métrica nenhuma no sistema
  await sql`INSERT INTO grupos_metricas (grupo, metrica)
            SELECT ${g}, m FROM unnest(${valid}::text[]) AS m
            ON CONFLICT (grupo, metrica) DO NOTHING`;
  return "ok";
}

export async function renameGrupo(from: string, to: string): Promise<"ok" | "merge" | "invalido" | "nao_existe"> {
  const f = from.trim(), t = to.trim();
  if (!f || f === "Indefinido" || !valido(t)) return "invalido";
  if (!(await existe(f))) return "nao_existe";
  if (f === t) return "ok";
  const merge = await existe(t); // só informativo; a transação é segura nos dois casos
  // Unificado e atômico: copia (união) as métricas do 'from' pro 'to' sem violar a PK,
  // apaga as do 'from' e move os players. Funciona pra rename puro E merge.
  await sql.transaction([
    sql`INSERT INTO grupos_metricas (grupo, metrica, peso)
        SELECT ${t}, metrica, peso FROM grupos_metricas WHERE grupo = ${f}
        ON CONFLICT (grupo, metrica) DO NOTHING`,
    sql`DELETE FROM grupos_metricas WHERE grupo = ${f}`,
    sql`UPDATE players SET grupo = ${t} WHERE grupo = ${f}`,
  ]);
  return merge ? "merge" : "ok";
}

/** Exclui o grupo: manda os membros para 'Indefinido' e remove a config de métricas. */
export async function deleteGrupo(nome: string): Promise<"ok" | "invalido"> {
  const g = nome.trim();
  if (!g || g === "Indefinido") return "invalido";
  await sql.transaction([
    sql`UPDATE players SET grupo = 'Indefinido' WHERE grupo = ${g}`,
    sql`DELETE FROM grupos_metricas WHERE grupo = ${g}`,
  ]);
  return "ok";
}
