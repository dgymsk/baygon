import { sql } from "@/lib/db";
import { TIPOS_SEM_REGUA } from "@/lib/tiposGuerra";

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
      -- papel POR WAR (ver lib/score.ts): cada war usa a régua do tipo dela
      JOIN papel_na_war p ON p.war_id = d.war_id AND p.nome_familia = d.nome_familia
      JOIN metricas m ON m.metrica = d.metrica
      -- rosas fora da régua (ver TIPOS_SEM_REGUA): lá o jogo só dá abates e mortes
      WHERE d.metrica = ANY(${STAT_METRICAS}::text[])
        AND COALESCE(w.tipo,'') <> ALL(${TIPOS_SEM_REGUA}::text[])
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
  direcao: string;        // maior_melhor | menor_melhor
  coreRaw: number | null;   // média BRUTA da régua (core do grupo, fallback média do grupo)
  grupoRaw: number | null;  // média BRUTA do grupo inteiro
  minhaRaw: number | null;  // média BRUTA do player
  minhaPct: number | null;  // % POR-WAR (igual /membros): pct/war c/ polaridade, LEAST 200, média
  grupoPct: number | null;  // idem para o grupo (vs régua)
};

/**
 * Para a home pessoal /eu, sobre as ÚLTIMAS N WARS QUE O PLAYER PARTICIPOU
 * (n=1 = "última war"). Os % (minhaPct/grupoPct) usam o MESMO método do /membros
 * e /painel: régua por (war, grupo, métrica) = core do grupo (fallback média do
 * grupo); pct por war com polaridade e teto LEAST(pct,200); depois média. Os
 * brutos (coreRaw/grupoRaw/minhaRaw) são as médias dos valores por war (p/ cards).
 */
export async function statsEu(familia: string, n = 5): Promise<EuMetrica[]> {
  const rows = (await sql`
    WITH minhas AS (  -- últimas N wars que o player jogou
      SELECT w.war_id FROM wars w
      WHERE EXISTS (SELECT 1 FROM desempenho d WHERE d.war_id = w.war_id AND d.nome_familia = ${familia})
        AND COALESCE(w.tipo,'') <> ALL(${TIPOS_SEM_REGUA}::text[])   -- rosas não entra na régua
      ORDER BY w.data DESC LIMIT ${n}
    ),
    /**
     * O grupo que EU tinha NAQUELA war, e quem mais estava nele.
     *
     * Antes o grupo vinha por parâmetro, do cadastro (AND p.grupo = <grupo do cadastro>). Numa
     * siege em que a pessoa troca de função ela não casava o próprio filtro: minha_war saía NULL, a
     * war era descartada pelo FILTER lá embaixo, e a métrica encolhia ou sumia do card — calada.
     */
    base AS (
      SELECT d.war_id, d.metrica, d.valor, pw.is_core, m.direcao, d.nome_familia
      FROM desempenho d
      JOIN minhas mw        ON mw.war_id = d.war_id
      JOIN papel_na_war pw  ON pw.war_id = d.war_id AND pw.nome_familia = d.nome_familia
      JOIN papel_na_war meu ON meu.war_id = d.war_id AND meu.nome_familia = ${familia}
      JOIN metricas m       ON m.metrica = d.metrica
      WHERE d.metrica = ANY(${STAT_METRICAS}::text[]) AND pw.grupo = meu.grupo
    ),
    bench AS (  -- por war: régua (core, fallback grupo), média do grupo, valor do player
      SELECT war_id, metrica, MAX(direcao) AS direcao,
        COALESCE(AVG(valor) FILTER (WHERE is_core), AVG(valor))    AS regua,
        AVG(valor)                                                 AS grupo_war,
        AVG(valor) FILTER (WHERE nome_familia = ${familia})        AS minha_war
      FROM base GROUP BY war_id, metrica
    ),
    pct AS (  -- % por war (polaridade, SEM cap aqui; div/0 → NULL p/ ser EXCLUÍDO depois)
      SELECT metrica, direcao, regua, grupo_war, minha_war,
        CASE direcao WHEN 'maior_melhor' THEN minha_war / NULLIF(regua,0) * 100
                     ELSE NULLIF(regua,0) / NULLIF(minha_war,0) * 100 END AS minha_pct,
        CASE direcao WHEN 'maior_melhor' THEN grupo_war / NULLIF(regua,0) * 100
                     ELSE NULLIF(regua,0) / NULLIF(grupo_war,0) * 100 END AS grupo_pct
      FROM bench
    )
    -- cap LEAST(pct,200) só nos NÃO-NULOS (FILTER), senão LEAST(NULL,200) viraria 200
    SELECT metrica, MAX(direcao) AS direcao,
      AVG(regua)::float8     AS core_raw,
      AVG(grupo_war)::float8 AS grupo_raw,
      AVG(minha_war)::float8 AS minha_raw,
      (AVG(LEAST(minha_pct, 200)) FILTER (WHERE minha_pct IS NOT NULL))::float8 AS minha_pct,
      (AVG(LEAST(grupo_pct, 200)) FILTER (WHERE grupo_pct IS NOT NULL))::float8 AS grupo_pct
    FROM pct GROUP BY metrica
  `) as { metrica: string; direcao: string; core_raw: number | null; grupo_raw: number | null; minha_raw: number | null; minha_pct: number | null; grupo_pct: number | null }[];

  const map = new Map(rows.map((r) => [r.metrica, r]));
  return STAT_METRICAS.map((m) => {
    const r = map.get(m);
    return { metrica: m, direcao: r?.direcao ?? "maior_melhor", coreRaw: r?.core_raw ?? null, grupoRaw: r?.grupo_raw ?? null, minhaRaw: r?.minha_raw ?? null, minhaPct: r?.minha_pct ?? null, grupoPct: r?.grupo_pct ?? null };
  });
}
