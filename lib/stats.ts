import { sql } from "@/lib/db";

/**
 * Médias de performance por player (relativas à régua), para a tela de membros.
 * Métricas observadas: Dano PvP, Dano Pino, CC, Cura Aliados, Tempo Morto.
 *
 * Régua por (war, grupo, métrica), com fallback exatamente como pedido:
 *  - core do grupo NAQUELA war (média dos is_core que jogaram); se não houver
 *    (core não jogou OU grupo sem core definido) → média do grupo NAQUELA war.
 *  (nunca cai pra guilda inteira.)
 *
 * % com polaridade (tempo_morto inverte), limitada a 200%, média das últimas N
 * participações do player.
 */

export const STAT_METRICAS = ["dano_em_player", "dano_do_pino", "ccs", "cura_aliados", "tempo_morto"];

export type MediasMap = Record<string, Record<string, number>>; // nome -> metrica -> pct médio

export async function mediasMembros(n = 5): Promise<MediasMap> {
  const rows = (await sql`
    WITH base AS (
      SELECT d.war_id, w.data, d.nome_familia, p.grupo, d.metrica, d.valor, p.is_core, m.direcao
      FROM desempenho d
      JOIN wars w     ON w.war_id = d.war_id
      JOIN players p  ON p.nome_familia = d.nome_familia
      JOIN metricas m ON m.metrica = d.metrica
      WHERE d.metrica = ANY(${STAT_METRICAS}::text[])
    ),
    bench AS (  -- régua por war/grupo/métrica: core se houver, senão grupo daquela war
      SELECT war_id, grupo, metrica,
             COALESCE(AVG(valor) FILTER (WHERE is_core), AVG(valor)) AS regua
      FROM base GROUP BY war_id, grupo, metrica
    ),
    disc AS (
      SELECT b.nome_familia, b.data, b.metrica,
        CASE b.direcao WHEN 'maior_melhor' THEN b.valor / NULLIF(bc.regua,0) * 100
                       ELSE NULLIF(bc.regua,0) / NULLIF(b.valor,0) * 100 END AS pct
      FROM base b
      JOIN bench bc ON bc.war_id = b.war_id AND bc.grupo = b.grupo AND bc.metrica = b.metrica
    ),
    ranked AS (  -- últimas N participações do player (por data)
      SELECT nome_familia, metrica, pct,
             ROW_NUMBER() OVER (PARTITION BY nome_familia, metrica ORDER BY data DESC) AS rn
      FROM disc WHERE pct IS NOT NULL
    )
    SELECT nome_familia, metrica, AVG(LEAST(pct, 200))::float8 AS media
    FROM ranked WHERE rn <= ${n}
    GROUP BY nome_familia, metrica
  `) as { nome_familia: string; metrica: string; media: number }[];

  const map: MediasMap = {};
  for (const r of rows) (map[r.nome_familia] ??= {})[r.metrica] = r.media;
  return map;
}

export type EuMetrica = {
  metrica: string;
  direcao: string;       // maior_melhor | menor_melhor
  coreRaw: number | null;  // média BRUTA do core do grupo (fallback: média do grupo)
  guildRaw: number | null; // média BRUTA da guilda inteira
  minhaRaw: number | null; // média BRUTA do player
};

/**
 * Para a home pessoal /eu: por métrica, as médias BRUTAS (não-%) do core do
 * grupo do player (régua, fallback média do grupo), da guilda inteira, e do
 * próprio player — sobre as últimas N wars (por data). O % é derivado disso.
 */
export async function statsEu(familia: string, grupo: string, n = 5): Promise<EuMetrica[]> {
  const rows = (await sql`
    WITH ult AS (SELECT war_id FROM wars ORDER BY data DESC LIMIT ${n}),
    base AS (
      SELECT d.nome_familia, d.metrica, d.valor, p.is_core, p.grupo, m.direcao
      FROM desempenho d
      JOIN ult u      ON u.war_id = d.war_id
      JOIN players p  ON p.nome_familia = d.nome_familia
      JOIN metricas m ON m.metrica = d.metrica
      WHERE d.metrica = ANY(${STAT_METRICAS}::text[])
    )
    SELECT metrica,
      MAX(direcao) AS direcao,
      COALESCE(AVG(valor) FILTER (WHERE is_core AND grupo = ${grupo}),
               AVG(valor) FILTER (WHERE grupo = ${grupo}))::float8 AS core_raw,
      AVG(valor)::float8                                            AS guild_raw,
      AVG(valor) FILTER (WHERE nome_familia = ${familia})::float8   AS minha_raw
    FROM base GROUP BY metrica
  `) as { metrica: string; direcao: string; core_raw: number | null; guild_raw: number | null; minha_raw: number | null }[];

  const map = new Map(rows.map((r) => [r.metrica, r]));
  return STAT_METRICAS.map((m) => {
    const r = map.get(m);
    return { metrica: m, direcao: r?.direcao ?? "maior_melhor", coreRaw: r?.core_raw ?? null, guildRaw: r?.guild_raw ?? null, minhaRaw: r?.minha_raw ?? null };
  });
}
