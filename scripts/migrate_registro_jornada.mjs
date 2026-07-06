// Jornada de registro: vínculo Discord↔player (players.discord_id) + gear manual em garmoth_build
// (garmoth_id nullable + fonte) + estado temporário da jornada (registro_jornada). Idempotente.
// Uso: node --env-file=.env.local scripts/migrate_registro_jornada.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  // vínculo Discord user → player (setado no registro; identidade robusta, independe do nick)
  await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS discord_id TEXT`);
  // 1 conta Discord = 1 player (partial: só linhas com discord_id). Bloqueia sequestro/duplicata no banco.
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_players_discord ON players (discord_id) WHERE discord_id IS NOT NULL`);
  // gear manual: garmoth_build passa a aceitar linha sem garmoth_id (fonte 'manual')
  await client.query(`ALTER TABLE garmoth_build ALTER COLUMN garmoth_id DROP NOT NULL`);
  await client.query(`ALTER TABLE garmoth_build ADD COLUMN IF NOT EXISTS fonte TEXT NOT NULL DEFAULT 'garmoth'`);
  // Buzinador: envio pode carregar o botão "Registrar" (chamada de registro na DM)
  await client.query(`ALTER TABLE buzinador_envio ADD COLUMN IF NOT EXISTS botao_registro BOOLEAN NOT NULL DEFAULT FALSE`);
  // estado temporário entre os passos da jornada (1 por usuário; apagado ao finalizar)
  await client.query(`CREATE TABLE IF NOT EXISTS registro_jornada (
    user_id    TEXT PRIMARY KEY,
    familia    TEXT,
    apelido    TEXT,
    atualizado TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  console.log("OK — discord_id + garmoth_build.fonte + registro_jornada:", (await client.query(`SELECT to_regclass('registro_jornada') t`)).rows[0].t);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
