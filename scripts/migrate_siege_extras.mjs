// Adiciona pt_meta.siege_extras (PTs nomeadas do siege, editáveis). Idempotente.
// Uso: node --env-file=.env.local scripts/migrate_siege_extras.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(`ALTER TABLE pt_meta ADD COLUMN IF NOT EXISTS siege_extras TEXT NOT NULL DEFAULT 'Flanco,Defesa'`);
  const { rows } = await client.query(`SELECT siege_extras FROM pt_meta WHERE id = 1`);
  console.log("OK — siege_extras:", JSON.stringify(rows[0]?.siege_extras));
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
