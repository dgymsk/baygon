// Identidade da aliança + guildas participantes (configurável). Idempotente.
// Uso: node --env-file=.env.local scripts/migrate_guild_meta.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS guild_meta (
    id     INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    config JSONB NOT NULL DEFAULT '{}'::jsonb   -- { alliance:{nome,icone,banner,cor}, guildas:[{id,tag,nome,icone,cor}] }
  )`);
  await client.query(`INSERT INTO guild_meta (id) VALUES (1) ON CONFLICT DO NOTHING`);
  console.log("OK — guild_meta:", (await client.query(`SELECT to_regclass('guild_meta') t`)).rows[0].t);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
