import { sql } from "@/lib/db";

/**
 * Config do score (lida/gravada pela página /config):
 *  - quais métricas avaliam cada grupo (grupos_metricas)
 *  - quem é core de cada grupo (players.is_core)
 */

export type Metrica = { metrica: string; rotulo: string; direcao: string; universal: boolean };
export type PlayerCfg = { nome_familia: string; is_core: boolean; classe_bdo: string | null; ativo: boolean; guilda: string };
export type GrupoCfg = { grupo: string; metricas: string[]; players: PlayerCfg[] };
/** Quem está esperando classificação — o bloco "Indefinido" vira lista de tarefa, não parede. */
export type SemGrupo = { guilda: string; n: number; comDano: number };
export type Config = { metricas: Metrica[]; grupos: GrupoCfg[]; semGrupo: SemGrupo[] };

export async function getConfig(): Promise<Config> {
  const metricas = (await sql`
    SELECT metrica, rotulo, direcao, universal FROM metricas ORDER BY metrica
  `) as Metrica[];
  /**
   * SÓ QUEM AINDA ESTÁ NA ALIANÇA.
   *
   * Ex-membro não pode ser régua de nada: ele não joga mais, e o número dele é de um gear e de um
   * meta que ficaram pra trás. A tela antiga listava todo mundo (o ex só ficava com opacidade 0.5),
   * e o resultado foi que 10 dos 16 cores eram gente que já tinha saído — quatro grupos tinham como
   * régua APENAS ex-membros.
   *
   * Não filtra por guilda de propósito: a régua é da ALIANÇA, não do Manicômio. Quem é da OSSD
   * entra na mesma lista, e a tela mostra a guilda ao lado do nome pra staff saber quem é quem.
   */
  const players = (await sql`
    SELECT nome_familia, grupo, is_core, classe_bdo, ativo, guilda FROM players
    WHERE ativo ORDER BY grupo, nome_familia
  `) as (PlayerCfg & { grupo: string })[];
  const gm = (await sql`SELECT grupo, metrica FROM grupos_metricas`) as { grupo: string; metrica: string }[];

  const byGrupo = new Map<string, GrupoCfg>();
  for (const p of players) {
    if (!byGrupo.has(p.grupo)) byGrupo.set(p.grupo, { grupo: p.grupo, metricas: [], players: [] });
    byGrupo.get(p.grupo)!.players.push({
      nome_familia: p.nome_familia, is_core: p.is_core, classe_bdo: p.classe_bdo, ativo: p.ativo, guilda: p.guilda,
    });
  }
  for (const r of gm) {
    if (!byGrupo.has(r.grupo)) byGrupo.set(r.grupo, { grupo: r.grupo, metricas: [], players: [] });
    byGrupo.get(r.grupo)!.metricas.push(r.metrica);
  }

  // Indefinido por último; demais em ordem alfabética
  const grupos = [...byGrupo.values()].sort((a, b) =>
    a.grupo === "Indefinido" ? 1 : b.grupo === "Indefinido" ? -1 : a.grupo.localeCompare(b.grupo)
  );
  /**
   * Quem está ATIVO e sem grupo, por guilda — e quantos desses já têm dano gravado.
   *
   * Sem grupo a pessoa não pode ser régua nem aparece no painel: `scoped` em lib/score.ts é INNER
   * JOIN com grupos_metricas, e "Indefinido" não tem métrica nenhuma. O número com dano é o que
   * mede o custo real de deixar assim — é gente que jogou e cujo desempenho está invisível.
   */
  const semGrupo = (await sql`
    SELECT guilda,
           count(*)::int AS n,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM desempenho d WHERE d.nome_familia = p.nome_familia))::int AS "comDano"
    FROM players p WHERE ativo AND grupo = 'Indefinido'
    GROUP BY guilda ORDER BY guilda`) as SemGrupo[];

  return { metricas, grupos, semGrupo };
}

/**
 * Grava a config de forma transacional:
 *  - is_core = TRUE só para os players em `cores` (todos os outros viram FALSE)
 *  - grupos_metricas é substituído por completo pelo conteúdo de `gruposMetricas`
 * Valores são filtrados contra métricas/players válidos para evitar erro de FK.
 */
export async function saveConfig(cores: string[], gruposMetricas: Record<string, string[]>) {
  const metricasValidas = new Set(((await sql`SELECT metrica FROM metricas`) as { metrica: string }[]).map((r) => r.metrica));
  // grupos válidos = quem tem player OU já tem config de métricas (grupos criados sem player)
  const gruposValidos = new Set([
    ...((await sql`SELECT DISTINCT grupo FROM players`) as { grupo: string }[]).map((r) => r.grupo),
    ...((await sql`SELECT DISTINCT grupo FROM grupos_metricas`) as { grupo: string }[]).map((r) => r.grupo),
  ]);

  const grupos: string[] = [];
  const mets: string[] = [];
  for (const [grupo, lista] of Object.entries(gruposMetricas)) {
    if (!gruposValidos.has(grupo)) continue;
    for (const metrica of new Set(lista)) {
      if (metricasValidas.has(metrica)) { grupos.push(grupo); mets.push(metrica); }
    }
  }

  const queries = [
    sql`UPDATE players SET is_core = (nome_familia = ANY(${cores}::text[]))`,
    sql`DELETE FROM grupos_metricas`,
  ];
  if (grupos.length) {
    queries.push(sql`
      INSERT INTO grupos_metricas (grupo, metrica)
      SELECT * FROM unnest(${grupos}::text[], ${mets}::text[])
    `);
  }
  await sql.transaction(queries);
}
