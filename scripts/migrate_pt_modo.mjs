// Adiciona pt_meta.modo (nodewar|siege) e pt_meta.siege_pts (1-5). Idempotente.
// Uso: node --env-file=.env.local scripts/migrate_pt_modo.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const ddl = `
ALTER TABLE pt_meta ADD COLUMN IF NOT EXISTS modo      TEXT NOT NULL DEFAULT 'nodewar';
ALTER TABLE pt_meta ADD COLUMN IF NOT EXISTS siege_pts INT  NOT NULL DEFAULT 3;
`;

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(ddl);
  const { rows } = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='pt_meta' AND column_name IN ('modo','siege_pts') ORDER BY column_name`);
  console.log("OK — colunas:", rows.map((r) => r.column_name).join(", "));
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
