// Área do BOT DE PARTICIPAÇÃO próprio (Can/Cant), isolada. Idempotente.
// Uso: node --env-file=.env.local scripts/migrate_participacao.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();

  // config (singleton JSON): canais, textos, agenda por tipo (nodewar|siege)
  await client.query(`CREATE TABLE IF NOT EXISTS participacao_config (
    id     INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    config TEXT
  )`);
  await client.query(`INSERT INTO participacao_config (id) VALUES (1) ON CONFLICT DO NOTHING`);

  // cada mensagem postada com botões = uma "rodada" (war_key = message_id)
  await client.query(`CREATE TABLE IF NOT EXISTS participacao_post (
    message_id TEXT PRIMARY KEY,
    tipo       TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    titulo     TEXT,
    criado     TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_participacao_post_tipo ON participacao_post (tipo, criado DESC)`);

  // respostas: 1 por Discord user por rodada (reclicar = UPDATE)
  await client.query(`CREATE TABLE IF NOT EXISTS participacao_resp (
    war_key    TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    username   TEXT NOT NULL,
    familia    TEXT,
    chave      TEXT,
    tipo       TEXT NOT NULL,
    resposta   TEXT NOT NULL CHECK (resposta IN ('can','cant')),
    atualizado TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (war_key, user_id)
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_participacao_resp_warkey ON participacao_resp (war_key)`);

  const t = await client.query(`SELECT to_regclass('participacao_config') a, to_regclass('participacao_post') b, to_regclass('participacao_resp') c`);
  console.log("OK — tabelas:", t.rows[0]);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
