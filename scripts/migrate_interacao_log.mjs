// Log de interações livres (texto): cada resposta escrita de um membro (modal ou /responder)
// vira uma linha com um CÓDIGO de identificação, salva aqui e (sempre) postada no canal de log.
// Também liga o flag texto_livre na enquete (botão "Responder" que abre o modal).
// Uso: node --env-file=.env.local scripts/migrate_interacao_log.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();

  await client.query(`CREATE TABLE IF NOT EXISTS interacao_log (
    id             BIGSERIAL PRIMARY KEY,
    codigo         TEXT NOT NULL DEFAULT '',             -- id de identificação curto (derivado do id)
    tipo           TEXT NOT NULL DEFAULT 'texto',        -- 'texto' (resposta escrita livre)
    user_id        TEXT NOT NULL,
    username       TEXT,
    conteudo       TEXT NOT NULL,
    contexto       TEXT,                                 -- origem legível (ex.: '/responder' | 'Buzinador · <título>')
    ref_id         TEXT,                                 -- ponteiro livre (ex.: enquete_id)
    log_message_id TEXT,                                 -- id da mensagem postada no canal de log
    criado         TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS interacao_log_user ON interacao_log (user_id, criado DESC)`);

  // Enquete: permite (além dos botões de voto) um botão "Responder" que abre um modal de texto livre.
  await client.query(`ALTER TABLE enquete ADD COLUMN IF NOT EXISTS texto_livre BOOLEAN NOT NULL DEFAULT FALSE`);

  const t = await client.query(`SELECT to_regclass('interacao_log') l`);
  console.log("OK — interacao_log:", t.rows[0].l, "; enquete.texto_livre pronta");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
