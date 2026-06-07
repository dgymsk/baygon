import { sql } from "@/lib/db";

/**
 * Config do score (lida/gravada pela página /config):
 *  - quais métricas avaliam cada grupo (grupos_metricas)
 *  - quem é core de cada grupo (players.is_core)
 */

export type Metrica = { metrica: string; rotulo: string; direcao: string; universal: boolean };
export type PlayerCfg = { nome_familia: string; is_core: boolean; classe_bdo: string | null; ativo: boolean };
export type GrupoCfg = { grupo: string; metricas: string[]; players: PlayerCfg[] };
export type Config = { metricas: Metrica[]; grupos: GrupoCfg[] };

export async function getConfig(): Promise<Config> {
  const metricas = (await sql`
    SELECT metrica, rotulo, direcao, universal FROM metricas ORDER BY metrica
  `) as Metrica[];
  const players = (await sql`
    SELECT nome_familia, grupo, is_core, classe_bdo, ativo FROM players ORDER BY grupo, nome_familia
  `) as (PlayerCfg & { grupo: string })[];
  const gm = (await sql`SELECT grupo, metrica FROM grupos_metricas`) as { grupo: string; metrica: string }[];

  const byGrupo = new Map<string, GrupoCfg>();
  for (const p of players) {
    if (!byGrupo.has(p.grupo)) byGrupo.set(p.grupo, { grupo: p.grupo, metricas: [], players: [] });
    byGrupo.get(p.grupo)!.players.push({
      nome_familia: p.nome_familia, is_core: p.is_core, classe_bdo: p.classe_bdo, ativo: p.ativo,
    });
  }
  for (const r of gm) byGrupo.get(r.grupo)?.metricas.push(r.metrica);

  // Indefinido por último; demais em ordem alfabética
  const grupos = [...byGrupo.values()].sort((a, b) =>
    a.grupo === "Indefinido" ? 1 : b.grupo === "Indefinido" ? -1 : a.grupo.localeCompare(b.grupo)
  );
  return { metricas, grupos };
}

/**
 * Grava a config de forma transacional:
 *  - is_core = TRUE só para os players em `cores` (todos os outros viram FALSE)
 *  - grupos_metricas é substituído por completo pelo conteúdo de `gruposMetricas`
 * Valores são filtrados contra métricas/players válidos para evitar erro de FK.
 */
export async function saveConfig(cores: string[], gruposMetricas: Record<string, string[]>) {
  const metricasValidas = new Set(((await sql`SELECT metrica FROM metricas`) as { metrica: string }[]).map((r) => r.metrica));
  const gruposValidos = new Set(((await sql`SELECT DISTINCT grupo FROM players`) as { grupo: string }[]).map((r) => r.grupo));

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
