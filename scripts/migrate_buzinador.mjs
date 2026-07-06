// Buzinador: disparo de DM (PM) em massa + relatório de entrega. Idempotente.
// Um "envio" tem N "alvos" (destinatários); cada alvo vira ok/falha ao ser processado.
// Uso: node --env-file=.env.local scripts/migrate_buzinador.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS buzinador_envio (
    id                BIGSERIAL PRIMARY KEY,
    mensagem          TEXT NOT NULL,
    imagem_url        TEXT,
    canal_report_id   TEXT NOT NULL,
    criado_por        TEXT,
    status            TEXT NOT NULL DEFAULT 'pendente',  -- pendente | enviando | concluido
    total             INT  NOT NULL DEFAULT 0,
    report_message_id TEXT,
    criado            TIMESTAMPTZ NOT NULL DEFAULT now(),
    concluido         TIMESTAMPTZ
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS buzinador_alvo (
    id        BIGSERIAL PRIMARY KEY,
    envio_id  BIGINT NOT NULL REFERENCES buzinador_envio(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL,
    nome      TEXT,
    status    TEXT NOT NULL DEFAULT 'pendente',  -- pendente | ok | falha
    erro      TEXT,
    tentado   TIMESTAMPTZ,
    UNIQUE (envio_id, user_id)
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS buzinador_alvo_pend ON buzinador_alvo (envio_id, status)`);
  const t = await client.query(`SELECT to_regclass('buzinador_envio') e, to_regclass('buzinador_alvo') a`);
  console.log("OK — tabelas:", t.rows[0]);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
