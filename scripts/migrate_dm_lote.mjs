// Envio de DM em LOTE, com progresso visível — e PT por evento.
//
// (1) dm_lote / dm_lote_alvo: a convocação mandava as DMs num loop dentro de uma requisição só.
//     Uma escalação de 50 pessoas são ~100 chamadas ao Discord em sequência: a rota estoura o
//     tempo da Vercel no meio, com parte das DMs enviadas, nenhum relatório e nada que diga onde
//     parou. Fatiado em lotes (o desenho que o Buzinador já usa), cada requisição manda poucos e
//     devolve o placar; o estado de cada destinatário mora no banco, então recarregar a página ou
//     cair a conexão não reenvia pra quem já recebeu.
//
// (2) evento_party: as colunas da escalação vinham direto do preset, LIDAS AO VIVO. Tirar uma PT do
//     preset amanhã sumia com a coluna nas guerras já realizadas — e com quem estava escalado nela.
//     Agora o evento carrega a própria lista; sem linhas, cai no preset (que é como está hoje).
//
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_dm_lote.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();

  await client.query(`CREATE TABLE IF NOT EXISTS dm_lote (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo       TEXT NOT NULL,                                      -- 'convocacao' | 'ingame'
    evento_id  BIGINT NOT NULL REFERENCES evento(id) ON DELETE CASCADE,
    titulo     TEXT NOT NULL,                                      -- nome do evento no momento do disparo
    criado_por TEXT,
    status     TEXT NOT NULL DEFAULT 'pendente',                   -- 'pendente' | 'concluido'
    total      INT  NOT NULL DEFAULT 0,
    criado     TIMESTAMPTZ NOT NULL DEFAULT now(),
    concluido  TIMESTAMPTZ,
    log_ok     BOOLEAN,                                            -- o relatório foi pro canal de log?
    log_erro   TEXT
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_dm_lote_evento ON dm_lote (evento_id, criado DESC)`);

  await client.query(`CREATE TABLE IF NOT EXISTS dm_lote_alvo (
    id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lote_id BIGINT NOT NULL REFERENCES dm_lote(id) ON DELETE CASCADE,
    chave   TEXT NOT NULL,
    familia TEXT NOT NULL,
    user_id TEXT,
    party   TEXT,
    status  TEXT NOT NULL DEFAULT 'pendente',                      -- 'pendente' | 'ok' | 'falha'
    erro    TEXT,
    tentado TIMESTAMPTZ
  )`);
  // o FOR UPDATE SKIP LOCKED do processamento varre por (lote, status): é esse o índice que importa
  await client.query(`CREATE INDEX IF NOT EXISTS ix_dm_lote_alvo_lote ON dm_lote_alvo (lote_id, status)`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_dm_lote_alvo ON dm_lote_alvo (lote_id, chave)`);

  await client.query(`CREATE TABLE IF NOT EXISTS evento_party (
    evento_id BIGINT NOT NULL REFERENCES evento(id) ON DELETE CASCADE,
    party_id  BIGINT NOT NULL REFERENCES party(id) ON DELETE CASCADE,
    ordem     INT NOT NULL DEFAULT 0,
    PRIMARY KEY (evento_id, party_id)
  )`);

  const r = await client.query(`SELECT
    (SELECT count(*)::int FROM dm_lote) lotes,
    (SELECT count(*)::int FROM dm_lote_alvo) alvos,
    (SELECT count(*)::int FROM evento_party) partys_de_evento,
    (SELECT count(*)::int FROM evento) eventos`);
  console.log("ok:", r.rows[0]);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
