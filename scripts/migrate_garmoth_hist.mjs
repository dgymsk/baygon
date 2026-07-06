// Histórico de gear do Garmoth (p/ gráfico de evolução): 1 linha por captura QUANDO ap/aap/dp mudam.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_garmoth_hist.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS garmoth_gear_hist (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome_familia TEXT NOT NULL REFERENCES players(nome_familia) ON DELETE CASCADE,
    garmoth_id   TEXT,
    ap           INT,
    aap          INT,
    dp           INT,
    capturado    TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_garmoth_hist ON garmoth_gear_hist (nome_familia, capturado)`);
  console.log("OK — garmoth_gear_hist:", (await client.query(`SELECT to_regclass('garmoth_gear_hist') t`)).rows[0].t);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
