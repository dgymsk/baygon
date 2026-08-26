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
  /** Wars da janela em que a régua foi CORE de verdade (0 = foi só a média dos outros do grupo). */
  warsComCore: number;
  /** Wars da janela em que havia alguém além dele no grupo. 0 = jogou sozinho, sem comparação. */
  warsComCompanhia: number;
};

/**
 * AS ÚLTIMAS N WARS DO JOGADOR, COM A RÉGUA — o pedaço que /eu e o histórico do perfil dividem.
 *
 * Fragmento, e não duas cópias, porque é a definição de RÉGUA que está aqui dentro, e é a conta
 * mais delicada do app: se um dia o critério mudar num lugar e não no outro, a mesma pessoa
 * aparece com percentuais diferentes em duas telas e nenhuma das duas está obviamente errada.
 *
 * Devolve as CTEs `minhas`, `base` e `bench` — quem interpola continua a partir daí com o `WITH`.
 */
const reguaDoJogador = (familia: string, n: number, metricas: string[]) => sql`
  minhas AS (  -- últimas N wars que o player jogou
    SELECT w.war_id FROM wars w
    WHERE EXISTS (SELECT 1 FROM desempenho d WHERE d.war_id = w.war_id AND d.nome_familia = ${familia})
      AND COALESCE(w.tipo,'') <> ALL(${TIPOS_SEM_REGUA}::text[])   -- rosas não entra na régua
    ORDER BY w.data DESC LIMIT ${n}
  ),
  /**
   * O grupo que EU tinha NAQUELA war, e quem mais estava nele.
   *
   * O grupo sai de papel_na_war, e não do cadastro: numa siege em que a pessoa troca de função
   * ela não casava o próprio filtro, a war era descartada calada e a métrica encolhia no card.
   */
  base AS (
    SELECT d.war_id, d.metrica, d.valor, pw.is_core, m.direcao, d.nome_familia
    FROM desempenho d
    JOIN minhas mw        ON mw.war_id = d.war_id
    JOIN papel_na_war pw  ON pw.war_id = d.war_id AND pw.nome_familia = d.nome_familia
    JOIN papel_na_war meu ON meu.war_id = d.war_id AND meu.nome_familia = ${familia}
    JOIN metricas m       ON m.metrica = d.metrica
    WHERE d.metrica = ANY(${metricas}::text[]) AND pw.grupo = meu.grupo
  ),
  /**
   * RÉGUA = OS OUTROS. A pessoa medida nunca entra na própria referência.
   *
   * Antes era COALESCE(AVG FILTER (is_core), AVG(valor)) — e o segundo termo inclui quem está
   * sendo medido. Num grupo de duas pessoas sem core, o jogador é METADE da própria régua: o
   * percentual é puxado pra perto de 100 por construção. Caso real conferido: McFly, Backline,
   * war 53 — 86% com ele dentro, 76% com a régua sendo o outro jogador.
   *
   * Três degraus, todos sem o próprio: outros cores -> outros do grupo -> NULL. O NULL é honesto:
   * quem está sozinho no grupo naquela war não tem contra quem ser comparado.
   */
  bench AS (
    SELECT war_id, metrica, MAX(direcao) AS direcao,
      COALESCE(
        AVG(valor) FILTER (WHERE is_core AND nome_familia <> ${familia}),
        AVG(valor) FILTER (WHERE nome_familia <> ${familia})
      )                                                          AS regua,
      count(*) FILTER (WHERE is_core AND nome_familia <> ${familia})::int AS n_core,
      count(*) FILTER (WHERE nome_familia <> ${familia})::int     AS n_outros,
      AVG(valor)                                                 AS grupo_war,
      AVG(valor) FILTER (WHERE nome_familia = ${familia})        AS minha_war
    FROM base GROUP BY war_id, metrica
  )`;

/**
 * Para a home pessoal /eu, sobre as ÚLTIMAS N WARS QUE O PLAYER PARTICIPOU
 * (n=1 = "última war"). Os % (minhaPct/grupoPct) usam o MESMO método do /membros
 * e /painel: régua por (war, grupo, métrica) = core do grupo (fallback média do
 * grupo); pct por war com polaridade e teto LEAST(pct,200); depois média. Os
 * brutos (coreRaw/grupoRaw/minhaRaw) são as médias dos valores por war (p/ cards).
 */
export async function statsEu(familia: string, n = 5): Promise<EuMetrica[]> {
  const rows = (await sql`
    WITH ${reguaDoJogador(familia, n, STAT_METRICAS)},
    pct AS (  -- % por war (polaridade, SEM cap aqui; div/0 → NULL p/ ser EXCLUÍDO depois)
      SELECT metrica, direcao, regua, grupo_war, minha_war, n_core, n_outros,
        CASE direcao WHEN 'maior_melhor' THEN minha_war / NULLIF(regua,0) * 100
                     ELSE NULLIF(regua,0) / NULLIF(minha_war,0) * 100 END AS minha_pct,
        CASE direcao WHEN 'maior_melhor' THEN grupo_war / NULLIF(regua,0) * 100
                     ELSE NULLIF(regua,0) / NULLIF(grupo_war,0) * 100 END AS grupo_pct
      FROM bench
    )
    -- cap LEAST(pct,200) só nos NÃO-NULOS (FILTER), senão LEAST(NULL,200) viraria 200
    SELECT metrica, MAX(direcao) AS direcao,
      -- quantas wars da janela tiveram core de verdade, e o tamanho típico da companhia: é o que
      -- diz se o "esperado" é uma régua ou um retrato de duas pessoas
      count(*) FILTER (WHERE n_core > 0)::int AS wars_com_core,
      count(*) FILTER (WHERE n_outros > 0)::int AS wars_com_companhia,
      AVG(regua)::float8     AS core_raw,
      AVG(grupo_war)::float8 AS grupo_raw,
      AVG(minha_war)::float8 AS minha_raw,
      (AVG(LEAST(minha_pct, 200)) FILTER (WHERE minha_pct IS NOT NULL))::float8 AS minha_pct,
      (AVG(LEAST(grupo_pct, 200)) FILTER (WHERE grupo_pct IS NOT NULL))::float8 AS grupo_pct
    FROM pct GROUP BY metrica
  `) as { metrica: string; direcao: string; core_raw: number | null; grupo_raw: number | null; minha_raw: number | null; minha_pct: number | null; grupo_pct: number | null; wars_com_core: number; wars_com_companhia: number }[];

  const map = new Map(rows.map((r) => [r.metrica, r]));
  return STAT_METRICAS.map((m) => {
    const r = map.get(m);
    return { metrica: m, direcao: r?.direcao ?? "maior_melhor", coreRaw: r?.core_raw ?? null, grupoRaw: r?.grupo_raw ?? null, minhaRaw: r?.minha_raw ?? null, minhaPct: r?.minha_pct ?? null, grupoPct: r?.grupo_pct ?? null, warsComCore: r?.wars_com_core ?? 0, warsComCompanhia: r?.wars_com_companhia ?? 0 };
  });
}

export type PontoDano = {
  warId: number;
  data: string;
  tipo: string | null;
  resultado: string | null;
  /** O valor DELE naquela war (dano cru). */
  valor: number | null;
  /** A régua daquela war — a média dos OUTROS (cores do grupo; sem eles, os outros do grupo). */
  regua: number | null;
  /** valor/régua em %. NULL quando ele jogou sozinho no grupo: não há com quem comparar. */
  pct: number | null;
  /** Quantos outros cores e quantos outros do grupo entraram na régua daquela war. */
  nCore: number;
  nOutros: number;
  /**
   * O grupo dele NAQUELA guerra é avaliado por esta métrica (`grupos_metricas`)?
   *
   * FALSE tem DOIS significados bem diferentes, e por isso vem acompanhado do `grupo`:
   *
   *   - grupo classificado cujo papel não é medido por dano — aí a % é mesmo um julgamento errado;
   *   - grupo "Indefinido", que hoje é onde estão 109 dos 149 ativos: não é um papel, é a AUSÊNCIA
   *     de um. A régua vira "a média dos outros sem grupo", que mistura healer com frontline e diz
   *     pouco — mas o número existe e é o mesmo que o /eu mostra pra essa pessoa. Esconder seria
   *     pior: some a informação e some também o motivo dela sumir.
   *
   * O /painel e a /evolução resolvem isso com um INNER JOIN que faz a linha SUMIR. Aqui a guerra
   * continua na lista — a pessoa jogou, e isso importa — e a tela é que diz o que a % vale.
   */
  avaliada: boolean;
  /** O grupo dele NAQUELA guerra (papel_na_war), pra tela saber qual dos dois casos explicar. */
  grupo: string | null;
};

/**
 * HISTÓRICO POR WAR de uma métrica só — o bloco de dano do cartão de /membros.
 *
 * Mesma régua do /eu, pelo mesmo fragmento (`reguaDoJogador`): a pessoa medida nunca entra na
 * própria referência. É a diferença que faz o número significar alguma coisa — num grupo de dois
 * sem core, comparar-se consigo mesmo devolve ~100% por construção.
 *
 * SEM o teto de 200% que existe no /eu e na evolução. Lá ele protege uma MÉDIA de ser destruída por
 * um ponto fora da curva; aqui cada linha É uma guerra específica, e cortar o 340% de uma noite
 * excepcional seria apagar justamente o que a staff quer ver.
 *
 * `fora_da_regua` não é honrado aqui, como não é no /eu — o marcador só é lido por lib/score.ts e
 * lib/evolucao.ts. Corrigir só neste lugar faria o perfil e o /eu discordarem; fica anotado como
 * dívida dos dois.
 */
export async function historicoDoJogador(familia: string, metrica = "dano_em_player", n = 12): Promise<PontoDano[]> {
  const nome = (familia ?? "").trim();
  if (!nome) return [];
  return (await sql`
    WITH ${reguaDoJogador(nome, n, [metrica])}
    SELECT w.war_id::int AS "warId", w.data::text AS data, w.tipo, w.resultado,
           b.minha_war::float8 AS valor, b.regua::float8 AS regua,
           b.n_core AS "nCore", b.n_outros AS "nOutros",
           (SELECT pw.grupo FROM papel_na_war pw WHERE pw.war_id = b.war_id AND pw.nome_familia = ${nome}) AS grupo,
           EXISTS (SELECT 1 FROM grupos_metricas gm
                   JOIN papel_na_war pw ON pw.war_id = b.war_id AND pw.nome_familia = ${nome}
                   WHERE gm.grupo = pw.grupo AND gm.metrica = ${metrica}) AS avaliada,
           (CASE b.direcao WHEN 'maior_melhor' THEN b.minha_war / NULLIF(b.regua,0) * 100
                           ELSE NULLIF(b.regua,0) / NULLIF(b.minha_war,0) * 100 END)::float8 AS pct
    FROM bench b JOIN wars w ON w.war_id = b.war_id
    ORDER BY w.data DESC, w.war_id DESC`) as PontoDano[];
}
