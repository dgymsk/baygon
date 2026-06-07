import { sql } from "@/lib/db";

/**
 * Série temporal de performance (% vs régua do CORE, lente core_grupo),
 * agregada por war, para um escopo:
 *  - geral:  média de todos os players × métricas
 *  - grupo:  média dos players × métricas do grupo
 *  - player: média das métricas do player
 *
 * Calculada na hora: para cada war no range, computa a régua do core do grupo
 * (por métrica), aplica polaridade e tira a média do escopo. Cada % é limitada
 * a 200% (teto, como no radar) antes da média, p/ não distorcer com outliers
 * (régua de core minúscula numa métrica explodiria a %).
 */

export type Escopo = "geral" | "grupo" | "player";
export type PontoEvolucao = {
  war_id: number;
  data: string;
  resultado: string | null;
  pct: number;
  n: number;
};

export async function evolucao(
  escopo: Escopo,
  valor: string | null,
  from: string,
  to: string,
): Promise<PontoEvolucao[]> {
  const rows = await sql`
    WITH wd AS (
      SELECT d.war_id, w.data, w.resultado, d.nome_familia, p.grupo,
             d.metrica, d.valor, p.is_core, m.direcao
      FROM desempenho d
      JOIN wars w     ON w.war_id = d.war_id
      JOIN players p  ON p.nome_familia = d.nome_familia
      JOIN metricas m ON m.metrica = d.metrica
      WHERE w.data BETWEEN ${from}::date AND ${to}::date
    ),
    scoped AS (
      SELECT wd.* FROM wd
      JOIN grupos_metricas gm ON gm.grupo = wd.grupo AND gm.metrica = wd.metrica
    ),
    bench AS (  -- régua do core por (war, grupo, métrica)
      SELECT war_id, grupo, metrica, AVG(valor) AS media
      FROM wd WHERE is_core GROUP BY war_id, grupo, metrica
    ),
    disc AS (
      SELECT s.war_id, s.data, s.resultado, s.nome_familia, s.grupo,
        CASE s.direcao WHEN 'maior_melhor' THEN s.valor / NULLIF(b.media,0) * 100
                       ELSE NULLIF(b.media,0) / NULLIF(s.valor,0) * 100 END AS pct
      FROM scoped s
      JOIN bench b ON b.war_id = s.war_id AND b.grupo = s.grupo AND b.metrica = s.metrica
    )
    SELECT war_id::int AS war_id, data::text AS data, resultado,
           AVG(LEAST(pct, 200))::float8 AS pct, count(*)::int AS n
    FROM disc
    WHERE pct IS NOT NULL
      AND ( ${escopo} = 'geral'
         OR (${escopo} = 'grupo'  AND grupo = ${valor})
         OR (${escopo} = 'player' AND nome_familia = ${valor}) )
    GROUP BY war_id, data, resultado
    ORDER BY data
  `;
  return rows as PontoEvolucao[];
}
