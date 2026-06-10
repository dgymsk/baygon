// Adiciona players.pt_preferida (PT preferida de nodewar). Idempotente, não-destrutivo.
// Uso: node --env-file=.env.local scripts/migrate_pt_preferida.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS pt_preferida TEXT`);
  const { rows } = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='players' AND column_name='pt_preferida'`);
  console.log("OK — coluna:", rows.map((r) => r.column_name).join(", ") || "(não criada?)");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
