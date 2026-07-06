import { sql } from "@/lib/db";
import { parseGarmothId } from "@/lib/garmothId";

/** Controle de membros (página /membros). */

export type Guilda = "MANI" | "RESO";
export type SaidaTipo = "Saiu" | "Kikado";

export type GarmothCache = { ap: number | null; aap: number | null; dp: number | null; acc: number | null; char_name: string | null; spec: string | null; atualizado: string | null; stale: boolean };

export type PlayerRow = {
  nome_familia: string;
  grupo: string;
  classe_bdo: string | null;
  classe_tipo: string | null;
  is_core: boolean;
  ativo: boolean;
  guilda: Guilda;
  pt_preferida: string | null;
  saida_tipo: SaidaTipo | null;
  saida_data: string | null;
  n_wars: number;
  garmoth_id: string | null;         // config (id da build do Garmoth)
  garmoth: GarmothCache | null;      // cache da API (worker); null se nunca buscado
};

type PlayerRaw = Omit<PlayerRow, "garmoth"> & { g_ap: number | null; g_aap: number | null; g_dp: number | null; g_acc: number | null; g_char_name: string | null; g_spec: string | null; g_atualizado: string | null; g_src_id: string | null };

export async function listPlayers(): Promise<PlayerRow[]> {
  const rows = (await sql`
    SELECT p.nome_familia, p.grupo, p.classe_bdo, p.classe_tipo, p.is_core, p.ativo, p.guilda, p.pt_preferida,
           p.saida_tipo, p.saida_data::text AS saida_data, p.garmoth_id,
           count(DISTINCT d.war_id)::int AS n_wars,
           gb.ap AS g_ap, gb.aap AS g_aap, gb.dp AS g_dp, gb.acc AS g_acc, gb.char_name AS g_char_name,
           gb.spec AS g_spec, gb.atualizado::text AS g_atualizado, gb.garmoth_id AS g_src_id
    FROM players p
    LEFT JOIN desempenho d ON d.nome_familia = p.nome_familia
    LEFT JOIN garmoth_build gb ON gb.nome_familia = p.nome_familia
    GROUP BY p.nome_familia, p.grupo, p.classe_bdo, p.classe_tipo, p.is_core, p.ativo, p.guilda, p.pt_preferida, p.saida_tipo, p.saida_data, p.garmoth_id,
             gb.ap, gb.aap, gb.dp, gb.acc, gb.char_name, gb.spec, gb.atualizado, gb.garmoth_id
    ORDER BY p.grupo, p.nome_familia
  `) as PlayerRaw[];
  return rows.map((r) => {
    const { g_ap, g_aap, g_dp, g_acc, g_char_name, g_spec, g_atualizado, g_src_id, ...base } = r;
    const temCache = g_atualizado != null;
    const garmoth: GarmothCache | null = temCache
      ? { ap: g_ap, aap: g_aap, dp: g_dp, acc: g_acc, char_name: g_char_name, spec: g_spec, atualizado: g_atualizado, stale: (g_src_id ?? null) !== (base.garmoth_id ?? null) }
      : null;
    return { ...base, garmoth };
  });
}

/** Só os nomes de família (leve, sem o JOIN de desempenho) — p/ casar nome no caminho quente. */
export async function listNomesFamilia(): Promise<string[]> {
  return (await sql`SELECT nome_familia FROM players` as { nome_familia: string }[]).map((r) => r.nome_familia);
}

const grupoOr = (g: string) => (g && g.trim() ? g.trim() : "Indefinido");
const guildaOr = (g: string): Guilda => ((g ?? "").trim().toUpperCase() === "RESO" ? "RESO" : "MANI");

/** Retorna false se já existia (nome_familia é PK). */
export async function addPlayer(
  nome: string, grupo: string, classe: string | null, ativo: boolean, guilda: string, tipo: string | null = null,
): Promise<boolean> {
  const rows = await sql`
    INSERT INTO players (nome_familia, grupo, is_core, classe_bdo, classe_tipo, guilda, ativo)
    VALUES (${nome.trim()}, ${grupoOr(grupo)}, FALSE, ${classe?.trim() || null}, ${tipo?.trim() || null}, ${guildaOr(guilda)}, ${ativo})
    ON CONFLICT (nome_familia) DO NOTHING
    RETURNING nome_familia
  `;
  return rows.length > 0;
}

/** Edição em lote dos campos do membro (NÃO mexe em ativo/saída — isso é arquivar/reativar). */
const PTS_PREF = new Set(["1", "2", "defesa", "ungabunga"]);
const ptOr = (p: string | null) => (p && PTS_PREF.has(p) ? p : null);

export type PlayerUpdate = {
  nome_familia: string;
  grupo: string;
  classe_bdo: string | null;
  classe_tipo: string | null;
  is_core: boolean;
  guilda: string;
  pt_preferida: string | null;
  garmoth_id?: string | null;
};

export async function updatePlayers(updates: PlayerUpdate[]): Promise<void> {
  if (!updates.length) return;
  const queries = updates.map((u) => sql`
    UPDATE players
    SET grupo = ${grupoOr(u.grupo)}, classe_bdo = ${u.classe_bdo?.trim() || null},
        classe_tipo = ${u.classe_tipo?.trim() || null}, is_core = ${u.is_core}, guilda = ${guildaOr(u.guilda)},
        pt_preferida = ${ptOr(u.pt_preferida)}, garmoth_id = ${u.garmoth_id ? parseGarmothId(u.garmoth_id) : null}
    WHERE nome_familia = ${u.nome_familia}
  `);
  await sql.transaction(queries);
}

/** Arquiva (vira ex-membro) com motivo. Preserva o histórico de war. */
export async function archivePlayer(nome: string, tipo: string): Promise<boolean> {
  const t: SaidaTipo = tipo === "Kikado" ? "Kikado" : "Saiu";
  const rows = await sql`
    UPDATE players SET ativo = FALSE, saida_tipo = ${t}, saida_data = CURRENT_DATE
    WHERE nome_familia = ${nome} RETURNING nome_familia
  `;
  return rows.length > 0;
}

/** Reativa um ex-membro. */
export async function reactivatePlayer(nome: string): Promise<boolean> {
  const rows = await sql`
    UPDATE players SET ativo = TRUE, saida_tipo = NULL, saida_data = NULL
    WHERE nome_familia = ${nome} RETURNING nome_familia
  `;
  return rows.length > 0;
}

/** Só exclui definitivamente quem não tem histórico de war. */
export async function deletePlayer(nome: string): Promise<"ok" | "tem_historico" | "nao_existe"> {
  const ref = await sql`SELECT 1 FROM desempenho WHERE nome_familia = ${nome} LIMIT 1`;
  if (ref.length) return "tem_historico";
  const del = await sql`DELETE FROM players WHERE nome_familia = ${nome} RETURNING nome_familia`;
  return del.length ? "ok" : "nao_existe";
}
