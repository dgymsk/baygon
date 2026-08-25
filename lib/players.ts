import { sql } from "@/lib/db";
import { parseGarmothId } from "@/lib/garmothId";
import { chaveNome } from "@/lib/nomes";

export type PerfilGearRow = { guilda: string; classe: string | null; gs: number | null };
/** Mapa chaveNome(família) → {guilda, classe, GS} p/ enriquecer o embed/roster do bot. GS = (ap+aap)/2+dp. */
export async function perfilGear(): Promise<Map<string, PerfilGearRow>> {
  const rows = (await sql`SELECT p.nome_familia, p.guilda, p.classe_bdo, gb.ap, gb.aap, gb.dp
    FROM players p LEFT JOIN garmoth_build gb ON gb.nome_familia = p.nome_familia`) as { nome_familia: string; guilda: string; classe_bdo: string | null; ap: number | null; aap: number | null; dp: number | null }[];
  const gs = (ap: number | null, aap: number | null, dp: number | null) => (ap != null && aap != null && dp != null ? Math.round((ap + aap) / 2 + dp) : null);
  return new Map(rows.map((r) => [chaveNome(r.nome_familia), { guilda: r.guilda, classe: r.classe_bdo, gs: gs(r.ap, r.aap, r.dp) }]));
}

/** Controle de membros (página /membros). */

export type Guilda = string; // id da guilda configurada (ex. MANI/RESO); antes era "MANI"|"RESO"
export type SaidaTipo = "Saiu" | "Kikado";

export type GarmothCache = { ap: number | null; aap: number | null; dp: number | null; acc: number | null; gs: number | null; char_name: string | null; spec: string | null; atualizado: string | null; stale: boolean };

export type PlayerRow = {
  nome_familia: string;
  grupo: string;
  /**
   * Papel na SIEGE. `null` = herda o de node war — não é "sem função".
   * `is_core_siege === false` é diferente de `null`: quer dizer "é core no nó, NÃO é régua na
   * siege". Quem resolve isso é a view `papel_na_war` (ver scripts/migrate_papel_por_tipo.mjs).
   */
  grupo_siege: string | null;
  is_core_siege: boolean | null;
  classe_bdo: string | null;
  classe_tipo: string | null;
  is_core: boolean;
  ativo: boolean;
  guilda: Guilda;
  pt_preferida: string | null;
  saida_tipo: SaidaTipo | null;
  saida_data: string | null;
  registro: boolean;                 // concluiu a jornada de registro (manual/estatística = false)
  lendario: boolean;                 // destaque na escalação; NUNCA aparece no bot
  /** Dias em que costuma poder jogar (0=domingo … 6=sábado, como lib/agenda.ts). null = não informado. */
  dias_semana: number[] | null;
  n_wars: number;
  garmoth_id: string | null;         // config (id da build do Garmoth)
  garmoth: GarmothCache | null;      // cache da API (worker); null se nunca buscado
};

type PlayerRaw = Omit<PlayerRow, "garmoth"> & { g_ap: number | null; g_aap: number | null; g_dp: number | null; g_acc: number | null; g_char_name: string | null; g_spec: string | null; g_atualizado: string | null; g_src_id: string | null };

export async function listPlayers(): Promise<PlayerRow[]> {
  const rows = (await sql`
    SELECT p.nome_familia, p.grupo, p.grupo_siege, p.is_core_siege, p.classe_bdo, p.classe_tipo, p.is_core, p.ativo, p.guilda, p.pt_preferida,
           p.saida_tipo, p.saida_data::text AS saida_data, p.registro, p.lendario, p.garmoth_id, p.dias_semana,
           count(DISTINCT d.war_id)::int AS n_wars,
           gb.ap AS g_ap, gb.aap AS g_aap, gb.dp AS g_dp, gb.acc AS g_acc, gb.char_name AS g_char_name,
           gb.spec AS g_spec, gb.atualizado::text AS g_atualizado, gb.garmoth_id AS g_src_id
    FROM players p
    LEFT JOIN desempenho d ON d.nome_familia = p.nome_familia
    LEFT JOIN garmoth_build gb ON gb.nome_familia = p.nome_familia
    -- lista MANUAL por causa do count(DISTINCT d.war_id): coluna nova no SELECT e não aqui = erro
    -- de SQL em runtime, e a /membros inteira quebra
    GROUP BY p.nome_familia, p.grupo, p.grupo_siege, p.is_core_siege, p.classe_bdo, p.classe_tipo, p.is_core, p.ativo, p.guilda, p.pt_preferida, p.saida_tipo, p.saida_data, p.registro, p.garmoth_id,
             gb.ap, gb.aap, gb.dp, gb.acc, gb.char_name, gb.spec, gb.atualizado, gb.garmoth_id
    ORDER BY p.grupo, p.nome_familia
  `) as PlayerRaw[];
  return rows.map((r) => {
    const { g_ap, g_aap, g_dp, g_acc, g_char_name, g_spec, g_atualizado, g_src_id, ...base } = r;
    const temCache = g_atualizado != null;
    const gs = g_ap != null && g_aap != null && g_dp != null ? Math.round((g_ap + g_aap) / 2 + g_dp) : null; // GS = (AP+AAP)/2 + DP
    const garmoth: GarmothCache | null = temCache
      ? { ap: g_ap, aap: g_aap, dp: g_dp, acc: g_acc, gs, char_name: g_char_name, spec: g_spec, atualizado: g_atualizado, stale: (g_src_id ?? null) !== (base.garmoth_id ?? null) }
      : null;
    return { ...base, garmoth };
  });
}

/** Só os nomes de família (leve, sem o JOIN de desempenho) — p/ casar nome no caminho quente. */
export async function listNomesFamilia(): Promise<string[]> {
  return (await sql`SELECT nome_familia FROM players` as { nome_familia: string }[]).map((r) => r.nome_familia);
}

const grupoOr = (g: string) => (g && g.trim() ? g.trim() : "Indefinido");
const guildaOr = (g: string): Guilda => ((g ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "MANI");

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
  registro?: boolean;
  /** ausente (`undefined`) = não mexe; `null` = herda do node war. Ver o CASE no UPDATE abaixo. */
  grupo_siege?: string | null;
  is_core_siege?: boolean | null;
  /** ausente = não mexe; array = grava; null = volta a "não informado". Dias 0..6 (domingo..sábado). */
  dias_semana?: number[] | null;
};

/** Normaliza dias da semana: só 0..6, sem repetido, em ordem. Mesma função de intenção em lib/agenda.ts. */
export function diasOk(v: unknown): number[] | null {
  if (v == null) return null;
  if (!Array.isArray(v)) return null;
  // `Number(null)` e `Number("")` são 0 — ou seja, lixo viraria DOMINGO. Só número de verdade, ou
  // string que é só dígito, viram dia.
  const num = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" && /^\d+$/.test(x.trim()) ? Number(x) : NaN);
  const d = [...new Set(v.map((x) => Math.trunc(num(x))).filter((x) => Number.isFinite(x) && x >= 0 && x <= 6))].sort((a, b) => a - b);
  return d.length ? d : null;   // vazio e "não informado" são a mesma coisa: ninguém ganha destaque
}

export async function updatePlayers(updates: PlayerUpdate[]): Promise<void> {
  if (!updates.length) return;
  // classe_bdo/classe_tipo são do GARMOTH p/ quem tem garmoth_id (o CASE usa o valor ATUAL da linha, pré-update):
  // um save à mão numa aba antiga não reverte a classe que o worker atualizou. Sem id → edição manual normal.
  const queries = updates.map((u) => sql`
    UPDATE players
    SET grupo = ${grupoOr(u.grupo)},
        -- o CASE olha o garmoth_id QUE ESTÁ SENDO GRAVADO, não o da linha antiga: lendo o antigo,
        -- limpar o link e corrigir a classe no mesmo save era impossível — o CASE via o id velho e
        -- descartava o que a staff digitou, sem dizer nada
        classe_bdo  = CASE WHEN ${u.garmoth_id ? parseGarmothId(u.garmoth_id) : null}::text IS NOT NULL THEN classe_bdo  ELSE ${u.classe_bdo?.trim() || null} END,
        classe_tipo = CASE WHEN ${u.garmoth_id ? parseGarmothId(u.garmoth_id) : null}::text IS NOT NULL THEN classe_tipo ELSE ${u.classe_tipo?.trim() || null} END,
        is_core = ${u.is_core}, guilda = ${guildaOr(u.guilda)}, registro = ${!!u.registro},
        pt_preferida = ${ptOr(u.pt_preferida)}, garmoth_id = ${u.garmoth_id ? parseGarmothId(u.garmoth_id) : null},
        -- papel de siege: AUSENTE ≠ VAZIO. Sem este CASE, uma aba de /membros aberta desde antes
        -- do deploy (ou qualquer cliente que não conheça o campo) apagaria o papel de siege de cada
        -- linha que tocasse — em silêncio, com HTTP 200. NULL continua sendo gravável de
        -- propósito: é como se volta a herdar o papel de node war.
        grupo_siege   = CASE WHEN ${u.grupo_siege   === undefined}::boolean THEN grupo_siege   ELSE ${u.grupo_siege ?? null} END,
        is_core_siege = CASE WHEN ${u.is_core_siege === undefined}::boolean THEN is_core_siege ELSE ${u.is_core_siege ?? null} END,
        -- mesmo cuidado do papel de siege. A /membros salva a linha inteira e ELA MANDA este campo
        -- (ele está em PlayerRow), mas a rota o descarta — ver o comentário em api/players/route.
        -- O CASE é a segunda trava: qualquer chamador que não conheça o campo não apaga os dias.
        dias_semana = CASE WHEN ${u.dias_semana === undefined}::boolean THEN dias_semana ELSE ${(u.dias_semana ?? null) as unknown as number[] | null} END
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
