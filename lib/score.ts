import { sql } from "@/lib/db";

/**
 * Discrepância (o que o painel lê) calculada NA HORA, a partir do `desempenho`
 * cru + config (`grupos_metricas`, `players.is_core`, `metricas`).
 *
 * As 3 lentes (mesma conta, população diferente da régua):
 *  - core_grupo: média só dos players `is_core` do grupo (justo por papel)
 *  - grupo:      média de todos do grupo
 *  - guilda:     média da guilda inteira — SÓ para métricas `universal=TRUE`
 *
 * Polaridade ("mais % = sempre melhor"):
 *  - maior_melhor: pct = valor / media * 100
 *  - menor_melhor: pct = media / valor * 100   (inverte; ex.: tempo_morto)
 *
 * pct = 100 → empatou com a régua; >100 → melhor; <100 → pior.
 * NULLIF protege contra divisão por zero (régua/valor 0 → pct = null).
 */

export type Populacao = "core_grupo" | "grupo" | "guilda";

export type DiscrepanciaRow = {
  nome_familia: string;
  grupo: string;
  metrica: string;
  rotulo: string;
  direcao: string;
  populacao: Populacao;
  valor: number;
  media: number;
  pct: number | null;
};

export async function discrepanciaPorWar(warId: number): Promise<DiscrepanciaRow[]> {
  const rows = await sql`
    WITH war_desemp AS (
      SELECT d.nome_familia, p.grupo, p.is_core, d.metrica, d.valor,
             m.rotulo, m.direcao, m.universal,
             -- marcado como FORA DA RÉGUA nesta war (ex.: mandaram morrer de propósito). Continua
             -- na tabela e no ranking; o que ele não faz é entrar nas médias abaixo.
             COALESCE(wp.fora_da_regua, FALSE) AS fora_da_regua
      FROM desempenho d
      JOIN players  p ON p.nome_familia = d.nome_familia
      JOIN metricas m ON m.metrica = d.metrica
      LEFT JOIN war_player wp ON wp.war_id = d.war_id AND wp.nome_familia = d.nome_familia
      WHERE d.war_id = ${warId}
    ),
    scoped AS (  -- só as métricas que avaliam o grupo de cada player
      SELECT wd.* FROM war_desemp wd
      JOIN grupos_metricas gm ON gm.grupo = wd.grupo AND gm.metrica = wd.metrica
    ),
    -- as TRÊS réguas ignoram quem está fora: o motivo (morrer a mando) distorce a média do core, a
    -- do grupo e a da guilda igual — tirar de uma só deixaria as outras duas mentindo
    bench_core   AS (SELECT grupo, metrica, AVG(valor) AS media FROM war_desemp WHERE is_core AND NOT fora_da_regua GROUP BY grupo, metrica),
    bench_grupo  AS (SELECT grupo, metrica, AVG(valor) AS media FROM war_desemp WHERE NOT fora_da_regua             GROUP BY grupo, metrica),
    bench_guilda AS (SELECT metrica, AVG(valor) AS media        FROM war_desemp WHERE universal AND NOT fora_da_regua GROUP BY metrica)
    SELECT s.nome_familia, s.grupo, s.metrica, s.rotulo, s.direcao, 'core_grupo' AS populacao,
           s.valor, b.media::float8 AS media,
           (CASE s.direcao WHEN 'maior_melhor' THEN s.valor / NULLIF(b.media,0) * 100
                           ELSE (b.media + 1) / (s.valor + 1) * 100 END)::float8 AS pct
    FROM scoped s JOIN bench_core b ON b.grupo = s.grupo AND b.metrica = s.metrica
    UNION ALL
    SELECT s.nome_familia, s.grupo, s.metrica, s.rotulo, s.direcao, 'grupo' AS populacao,
           s.valor, b.media::float8 AS media,
           (CASE s.direcao WHEN 'maior_melhor' THEN s.valor / NULLIF(b.media,0) * 100
                           ELSE (b.media + 1) / (s.valor + 1) * 100 END)::float8 AS pct
    FROM scoped s JOIN bench_grupo b ON b.grupo = s.grupo AND b.metrica = s.metrica
    UNION ALL
    SELECT s.nome_familia, s.grupo, s.metrica, s.rotulo, s.direcao, 'guilda' AS populacao,
           s.valor, b.media::float8 AS media,
           (CASE s.direcao WHEN 'maior_melhor' THEN s.valor / NULLIF(b.media,0) * 100
                           ELSE (b.media + 1) / (s.valor + 1) * 100 END)::float8 AS pct
    FROM scoped s JOIN bench_guilda b ON b.metrica = s.metrica
    ORDER BY nome_familia, metrica, populacao
  `;
  return rows as DiscrepanciaRow[];
}

export type WarInfo = {
  war_id: number;
  data: string;
  resultado: string | null;
  tier: number | null;
  territorio: string | null;
  n_players: number;
};

export async function listWars(): Promise<WarInfo[]> {
  const rows = await sql`
    SELECT w.war_id::int AS war_id, w.data::text AS data, w.resultado, w.tier, w.territorio,
           count(DISTINCT d.nome_familia)::int AS n_players
    FROM wars w
    LEFT JOIN desempenho d ON d.war_id = w.war_id
    GROUP BY w.war_id, w.data, w.resultado, w.tier, w.territorio
    ORDER BY w.data DESC, w.war_id DESC
  `;
  return rows as WarInfo[];
}
