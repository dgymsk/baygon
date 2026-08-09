import { sql } from "@/lib/db";

/**
 * Gerenciamento de grupos (página /config). Grupo é texto em players.grupo + grupos_metricas.grupo.
 *
 * DUAS colunas de player apontam pra cá: `grupo` (node war) e `grupo_siege` (siege, NULL = herda).
 * Todo lugar daqui trata as duas — o catálogo de grupos é UM só, compartilhado pelos dois tipos.
 * Esquecer um gêmeo não dá erro: o jogador fica apontando pra um nome de grupo que não existe mais
 * em `grupos_metricas`, e o INNER JOIN de lib/score.ts o apaga do painel inteiro, calado.
 */

const METRICAS_BASE = ["dano_em_player", "dano_do_pino", "tempo_morto"];

const existe = async (g: string) =>
  (await sql`SELECT 1 WHERE EXISTS (SELECT 1 FROM players WHERE grupo = ${g} OR grupo_siege = ${g})
                       OR EXISTS (SELECT 1 FROM grupos_metricas WHERE grupo = ${g})`).length > 0;

/** Lista de grupos canônicos (players ∪ grupos_metricas), exceto Indefinido. */
export async function listGruposCanonicos(): Promise<string[]> {
  const rows = (await sql`
    SELECT grupo FROM players
    UNION SELECT grupo_siege FROM players WHERE grupo_siege IS NOT NULL
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
  const dup = await sql`SELECT 1 WHERE EXISTS (SELECT 1 FROM players WHERE lower(grupo) = lower(${g}) OR lower(grupo_siege) = lower(${g}))
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
    // o gêmeo da siege, na MESMA transação: sem ele o `DELETE` acima já tirou as métricas do nome
    // velho e quem era desse grupo na siege sumiria do painel pelo INNER JOIN, sem erro nenhum
    sql`UPDATE players SET grupo_siege = ${t} WHERE grupo_siege = ${f}`,
  ]);
  return merge ? "merge" : "ok";
}

/** Exclui o grupo: manda os membros para 'Indefinido' e remove a config de métricas. */
export async function deleteGrupo(nome: string): Promise<"ok" | "invalido"> {
  const g = nome.trim();
  if (!g || g === "Indefinido") return "invalido";
  await sql.transaction([
    sql`UPDATE players SET grupo = 'Indefinido' WHERE grupo = ${g}`,
    // 'Indefinido' e NÃO NULL: NULL faria o jogador voltar a HERDAR o grupo de node war e ser
    // avaliado pelas métricas dele na siege — número plausível e falso é pior que ausência.
    // 'Indefinido' espelha o que já acontece do lado do node war (some do painel, à vista).
    sql`UPDATE players SET grupo_siege = 'Indefinido' WHERE grupo_siege = ${g}`,
    sql`DELETE FROM grupos_metricas WHERE grupo = ${g}`,
  ]);
  return "ok";
}
