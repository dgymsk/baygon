// Atributo "Registro": marca quem concluiu a jornada de registro (a criar). Manual/estatística nascem FALSE.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_registro.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS registro BOOLEAN NOT NULL DEFAULT FALSE`);
  console.log("OK — players.registro:", (await client.query(`SELECT count(*) FILTER (WHERE registro)::int AS reg, count(*)::int AS total FROM players`)).rows[0]);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
