// Config geral do Discord (servidor ativo + cargos de staff + canais). Idempotente.
// Uso: node --env-file=.env.local scripts/migrate_discord_config.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS discord_config (
    id     INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    config TEXT  -- JSON: { guildId, staffRoleIds[], confirmNodewar, confirmSiege }
  )`);
  await client.query(`INSERT INTO discord_config (id) VALUES (1) ON CONFLICT DO NOTHING`);
  console.log("OK — discord_config:", await client.query("SELECT to_regclass('discord_config') t").then((r) => r.rows[0].t));
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
