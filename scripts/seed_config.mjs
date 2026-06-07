// Config BASELINE do score (provisoria — sera editavel na pagina /config):
//  - grupos_metricas: cada grupo real avaliado por 3 metricas universais
//  - is_core: top-2 de cada grupo por dano_em_player acumulado
// Uso: node --env-file=.env.local scripts/seed_config.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const METRICAS_BASE = ["dano_em_player", "dano_do_pino", "tempo_morto"];

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query("BEGIN");

  // grupos reais (com players), exceto Indefinido
  const { rows: grupos } = await client.query(
    `SELECT DISTINCT grupo FROM players WHERE grupo <> 'Indefinido' ORDER BY grupo`
  );

  // grupos_metricas baseline (3 metricas por grupo) — limpa antes p/ ficar exato
  await client.query(`DELETE FROM grupos_metricas`);
  for (const { grupo } of grupos) {
    for (const metrica of METRICAS_BASE) {
      await client.query(
        `INSERT INTO grupos_metricas (grupo, metrica, peso) VALUES ($1,$2,1)
         ON CONFLICT (grupo, metrica) DO NOTHING`,
        [grupo, metrica]
      );
    }
  }

  // is_core: zera e marca top-2 de cada grupo por dano_em_player acumulado
  await client.query(`UPDATE players SET is_core = FALSE`);
  await client.query(`
    WITH ranked AS (
      SELECT p.nome_familia,
             ROW_NUMBER() OVER (PARTITION BY p.grupo ORDER BY COALESCE(SUM(d.valor),0) DESC) AS rn
      FROM players p
      LEFT JOIN desempenho d ON d.nome_familia = p.nome_familia AND d.metrica = 'dano_em_player'
      WHERE p.grupo <> 'Indefinido'
      GROUP BY p.nome_familia, p.grupo
    )
    UPDATE players SET is_core = TRUE
    WHERE nome_familia IN (SELECT nome_familia FROM ranked WHERE rn <= 2)
  `);

  await client.query("COMMIT");

  const { rows: gm } = await client.query(
    `SELECT grupo, count(*)::int n FROM grupos_metricas GROUP BY grupo ORDER BY grupo`
  );
  const { rows: cores } = await client.query(
    `SELECT p.grupo, string_agg(p.nome_familia, ', ' ORDER BY p.nome_familia) cores
     FROM players p WHERE p.is_core GROUP BY p.grupo ORDER BY p.grupo`
  );
  console.log("grupos_metricas:");
  for (const r of gm) console.log("  " + r.grupo.padEnd(12) + r.n + " metricas");
  console.log("cores por grupo:");
  for (const r of cores) console.log("  " + r.grupo.padEnd(12) + r.cores);
  console.log("OK seed_config");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("ERRO seed_config:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
