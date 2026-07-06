// Cor por PT (barra do card no embed multi-embed). Idempotente.
// Uso: node --env-file=.env.local scripts/migrate_pt_cor.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(`ALTER TABLE participacao_pt ADD COLUMN IF NOT EXISTS cor TEXT`); // hex "#rrggbb" ou NULL (usa paleta)
  const c = await client.query(`SELECT count(*)::int n FROM participacao_pt`);
  console.log("OK — participacao_pt.cor pronta;", c.rows[0].n, "PTs");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
