import { sql } from "@/lib/db";

/** Controle de membros (página /membros). */

export type Guilda = "MANI" | "RESO";

export type PlayerRow = {
  nome_familia: string;
  grupo: string;
  classe_bdo: string | null;
  is_core: boolean;
  ativo: boolean;
  guilda: Guilda;
  n_wars: number;
};

export async function listPlayers(): Promise<PlayerRow[]> {
  return (await sql`
    SELECT p.nome_familia, p.grupo, p.classe_bdo, p.is_core, p.ativo, p.guilda,
           count(DISTINCT d.war_id)::int AS n_wars
    FROM players p
    LEFT JOIN desempenho d ON d.nome_familia = p.nome_familia
    GROUP BY p.nome_familia, p.grupo, p.classe_bdo, p.is_core, p.ativo, p.guilda
    ORDER BY p.ativo DESC, p.grupo, p.nome_familia
  `) as PlayerRow[];
}

const grupoOr = (g: string) => (g && g.trim() ? g.trim() : "Indefinido");
const guildaOr = (g: string): Guilda => ((g ?? "").trim().toUpperCase() === "RESO" ? "RESO" : "MANI");

/** Retorna false se já existia (nome_familia é PK). */
export async function addPlayer(
  nome: string, grupo: string, classe: string | null, ativo: boolean, guilda: string,
): Promise<boolean> {
  const rows = await sql`
    INSERT INTO players (nome_familia, grupo, is_core, classe_bdo, guilda, ativo)
    VALUES (${nome.trim()}, ${grupoOr(grupo)}, FALSE, ${classe?.trim() || null}, ${guildaOr(guilda)}, ${ativo})
    ON CONFLICT (nome_familia) DO NOTHING
    RETURNING nome_familia
  `;
  return rows.length > 0;
}

export type PlayerUpdate = {
  nome_familia: string;
  grupo: string;
  classe_bdo: string | null;
  is_core: boolean;
  ativo: boolean;
  guilda: string;
};

export async function updatePlayers(updates: PlayerUpdate[]): Promise<void> {
  if (!updates.length) return;
  const queries = updates.map((u) => sql`
    UPDATE players
    SET grupo = ${grupoOr(u.grupo)}, classe_bdo = ${u.classe_bdo?.trim() || null},
        is_core = ${u.is_core}, ativo = ${u.ativo}, guilda = ${guildaOr(u.guilda)}
    WHERE nome_familia = ${u.nome_familia}
  `);
  await sql.transaction(queries);
}

/** Só exclui definitivamente quem não tem histórico de war. */
export async function deletePlayer(nome: string): Promise<"ok" | "tem_historico" | "nao_existe"> {
  const ref = await sql`SELECT 1 FROM desempenho WHERE nome_familia = ${nome} LIMIT 1`;
  if (ref.length) return "tem_historico";
  const del = await sql`DELETE FROM players WHERE nome_familia = ${nome} RETURNING nome_familia`;
  return del.length ? "ok" : "nao_existe";
}
