// Mapa de emojis (classe→emoji, guilda→emoji) usado no embed do bot. Idempotente.
// Uso: node --env-file=.env.local scripts/migrate_emoji_config.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS emoji_config (
    id     INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    config JSONB NOT NULL DEFAULT '{}'::jsonb   -- { classes: {Shai:'<:x:1>'}, guildas: {MANI:'<:y:2>'} }
  )`);
  await client.query(`INSERT INTO emoji_config (id) VALUES (1) ON CONFLICT DO NOTHING`);
  console.log("OK — emoji_config:", (await client.query(`SELECT to_regclass('emoji_config') t`)).rows[0].t);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
