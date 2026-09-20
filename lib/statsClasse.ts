import { sql } from "@/lib/db";
import { STAT_METRICAS, JANELAS, janelaOk } from "@/lib/statsConst";
import { TIPOS_SEM_REGUA } from "@/lib/tiposGuerra";

// reexportadas pra quem já importava daqui; a definição mora em lib/statsConst (sem banco)
export { JANELAS, janelaOk };

/**
 * COMPARATIVO POR CLASSE — "essa Ranger está indo bem PRA UMA RANGER?"
 *
 * Duas réguas lado a lado, sobre as mesmas noites:
 *   vs core   — a régua que o app inteiro já usa: os OUTROS cores do grupo dele naquela war (sem
 *               core, os outros do grupo; sozinho, NULL). Grupo lido de papel_na_war, a view viva,
 *               como stats.ts, score.ts e evolucao.ts fazem;
 *   vs classe — os OUTROS com a MESMA classe+tipo naquela war. A classe vem do CARIMBO de
 *               war_player, gravado na hora da war, e nunca do cadastro: 19 jogadores trocaram de
 *               classe no histórico (168 wars), e ler o cadastro de hoje jogaria 22 wars de cura de
 *               uma ex-Shai dentro do balde de Maegu.
 *
 * As duas são leave-one-out: cada linha vê a média dos outros, calculada por window function numa
 * passada só por (war, métrica, partição). Provado idêntico à régua de reguaDoJogador (lib/stats.ts)
 * em 3170 linhas do banco real, zero divergências — é a mesma conta, só que pra todo mundo de uma vez.
 *
 * O que NÃO se inventa aqui: polaridade (stats.ts), teto de 200% na média (stats.ts), fora_da_regua
 * honrado nas duas (score.ts). Consistência entre telas vale mais que qualquer correção isolada.
 *
 * Métricas = STAT_METRICAS, e não grupos_metricas: classe cruza grupos (Ranger/Sucessão está na
 * Backline e no Indefinido), então aqui as cinco valem pra todo mundo.
 */

/**
 * Pares mínimos pra % vs classe valer. 1 é a convenção do app (n_outros=1 aceito e marcado "~");
 * subir pra 2 é uma linha, e jogaria fora um quarto das células hoje.
 */
export const MIN_PARES_CLASSE = 1;

export type LinhaClasse = {
  nome_familia: string;
  metrica: string;
  wars: number;
  warsComPar: number;
  warsComCore: number;
  paresMedio: number | null;
  valorMedio: number | null;
  pctCore: number | null;
  pctClasse: number | null;
  foiCore: boolean;
  grupoRecente: string | null;
};

/** As últimas N wars DA GUILDA com régua — a lista compara pessoas entre si, todas nas mesmas noites. */
const janelaWars = (n: number) => sql`
  SELECT w.war_id, w.data FROM wars w
  WHERE COALESCE(w.tipo,'') <> ALL(${TIPOS_SEM_REGUA}::text[])
    AND EXISTS (SELECT 1 FROM desempenho d WHERE d.war_id = w.war_id)
  ORDER BY w.data DESC, w.war_id DESC LIMIT ${Math.max(1, Math.min(999, n))}`;

export async function comparativoClasse(classe: string, tipo: string, n = 10): Promise<LinhaClasse[]> {
  return (await sql`
    WITH janela AS (${janelaWars(n)}),
    base AS (  -- TODO MUNDO da janela: a regua de core precisa do grupo inteiro, nao so da classe pedida
      SELECT d.war_id, j.data, d.nome_familia, d.metrica, d.valor, m.direcao,
             pw.grupo, COALESCE(pw.is_core, false) AS is_core,
             wp.classe_bdo, wp.classe_tipo,
             COALESCE(wp.fora_da_regua, false) AS fora
      FROM desempenho d
      JOIN janela j        ON j.war_id = d.war_id
      JOIN metricas m      ON m.metrica = d.metrica
      JOIN papel_na_war pw ON pw.war_id = d.war_id AND pw.nome_familia = d.nome_familia
      LEFT JOIN war_player wp ON wp.war_id = d.war_id AND wp.nome_familia = d.nome_familia
      WHERE d.metrica = ANY(${STAT_METRICAS}::text[])
    ),
    reguas AS (  -- leave-one-out: cada linha ve a media dos OUTROS da sua particao
      SELECT b.*,
        COALESCE(
          (SUM(valor) FILTER (WHERE is_core AND NOT fora) OVER g - CASE WHEN is_core AND NOT fora THEN valor ELSE 0 END)
            / NULLIF(COUNT(*) FILTER (WHERE is_core AND NOT fora) OVER g - (is_core AND NOT fora)::int, 0),
          (SUM(valor) FILTER (WHERE NOT fora) OVER g - CASE WHEN NOT fora THEN valor ELSE 0 END)
            / NULLIF(COUNT(*) FILTER (WHERE NOT fora) OVER g - (NOT fora)::int, 0)
        )                                                                               AS regua_core,
        COUNT(*) FILTER (WHERE is_core AND NOT fora) OVER g - (is_core AND NOT fora)::int AS n_core,
        (SUM(valor) FILTER (WHERE NOT fora) OVER c - CASE WHEN NOT fora THEN valor ELSE 0 END)
          / NULLIF(COUNT(*) FILTER (WHERE NOT fora) OVER c - (NOT fora)::int, 0)          AS regua_classe,
        COUNT(*) FILTER (WHERE NOT fora) OVER c - (NOT fora)::int                       AS n_classe
      FROM base b
      WINDOW g AS (PARTITION BY war_id, metrica, grupo),
             c AS (PARTITION BY war_id, metrica, classe_bdo, classe_tipo)
    ),
    pct AS (  -- o filtro de classe entra DEPOIS das janelas; carimbo NULL nunca casa e nunca sai daqui
      SELECT war_id, data, nome_familia, metrica, valor, grupo, is_core, n_core, n_classe,
        CASE direcao WHEN 'maior_melhor' THEN valor / NULLIF(regua_core,0) * 100
                     ELSE NULLIF(regua_core,0) / NULLIF(valor,0) * 100 END AS pct_core,
        CASE WHEN n_classe < ${MIN_PARES_CLASSE} THEN NULL
             WHEN direcao = 'maior_melhor' THEN valor / NULLIF(regua_classe,0) * 100
             ELSE NULLIF(regua_classe,0) / NULLIF(valor,0) * 100 END AS pct_classe
      FROM reguas WHERE classe_bdo = ${classe} AND classe_tipo = ${tipo}
    )
    SELECT nome_familia, metrica,
      count(*)::int                                                              AS wars,
      count(*) FILTER (WHERE pct_classe IS NOT NULL)::int                        AS "warsComPar",
      count(*) FILTER (WHERE n_core > 0)::int                                    AS "warsComCore",
      AVG(n_classe)::float8                                                      AS "paresMedio",
      AVG(valor)::float8                                                         AS "valorMedio",
      (AVG(LEAST(pct_core,200))   FILTER (WHERE pct_core   IS NOT NULL))::float8 AS "pctCore",
      (AVG(LEAST(pct_classe,200)) FILTER (WHERE pct_classe IS NOT NULL))::float8 AS "pctClasse",
      bool_or(is_core)                                                           AS "foiCore",
      (array_agg(grupo ORDER BY data DESC, war_id DESC))[1]                      AS "grupoRecente"
    FROM pct GROUP BY nome_familia, metrica`) as LinhaClasse[];
}

export type ComboClasse = { classe: string; tipo: string; jogadores: number; wars: number; warsComPar: number };

/** As combinações classe+tipo presentes na janela, pra montar o seletor com números de verdade. */
export async function combosClasse(n = 10): Promise<ComboClasse[]> {
  return (await sql`
    WITH janela AS (${janelaWars(n)}),
    cel AS (
      SELECT wp.war_id, wp.classe_bdo, wp.classe_tipo, count(*) AS n
      FROM war_player wp JOIN janela j ON j.war_id = wp.war_id
      WHERE wp.classe_bdo IS NOT NULL AND wp.classe_tipo IS NOT NULL
      GROUP BY 1, 2, 3)
    SELECT wp.classe_bdo AS classe, wp.classe_tipo AS tipo,
           count(DISTINCT wp.nome_familia)::int AS jogadores,
           count(DISTINCT wp.war_id)::int AS wars,
           (SELECT count(*) FROM cel c WHERE c.classe_bdo = wp.classe_bdo AND c.classe_tipo = wp.classe_tipo AND c.n >= 2)::int AS "warsComPar"
    FROM war_player wp JOIN janela j ON j.war_id = wp.war_id
    WHERE wp.classe_bdo IS NOT NULL AND wp.classe_tipo IS NOT NULL
    GROUP BY wp.classe_bdo, wp.classe_tipo
    ORDER BY 3 DESC, 1, 2`) as ComboClasse[];
}

/** Quem jogou na janela SEM classe ou tipo no carimbo — fica fora de qualquer balde, e a tela diz quem. */
export async function semCarimboClasse(n = 10): Promise<{ nome_familia: string; wars: number }[]> {
  return (await sql`
    WITH janela AS (${janelaWars(n)})
    SELECT wp.nome_familia, count(*)::int AS wars
    FROM war_player wp JOIN janela j ON j.war_id = wp.war_id
    WHERE wp.classe_bdo IS NULL OR wp.classe_tipo IS NULL
    GROUP BY 1 ORDER BY 2 DESC, 1`) as { nome_familia: string; wars: number }[];
}

export type CadastroClasse = { classe: string | null; tipo: string | null; ativo: boolean };

/** O cadastro de HOJE (classe, tipo, ativo) — pra tela marcar quem trocou de classe desde a janela. */
export async function cadastroClasses(): Promise<Record<string, CadastroClasse>> {
  const rows = (await sql`SELECT nome_familia, classe_bdo, classe_tipo, ativo FROM players`) as
    { nome_familia: string; classe_bdo: string | null; classe_tipo: string | null; ativo: boolean }[];
  return Object.fromEntries(rows.map((r) => [r.nome_familia, { classe: r.classe_bdo, tipo: r.classe_tipo, ativo: r.ativo }]));
}
