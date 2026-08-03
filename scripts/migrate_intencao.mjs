// Stack de INTENÇÃO — bot em que a pessoa marca em QUAIS PTs pretende jogar (várias),
// sem limite de vaga, mais a escalação da staff e a presença por evento.
//
// Roda LADO A LADO com a stack participacao_* antiga: nada aqui altera tabela existente.
// O único ponto de contato é o catálogo participacao_pt, que é lido (nome/emoji da PT).
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_intencao.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();

  // --- preset: quais PTs viram botão, em que ordem ---
  await client.query(`CREATE TABLE IF NOT EXISTS intencao_preset (
    id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome   TEXT NOT NULL,
    tipo   TEXT NOT NULL,                    -- 'nodewar' | 'siege'
    criado TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS intencao_preset_pt (
    preset_id BIGINT NOT NULL REFERENCES intencao_preset(id) ON DELETE CASCADE,
    pt_id     BIGINT NOT NULL REFERENCES participacao_pt(id) ON DELETE CASCADE,
    ordem     INT NOT NULL DEFAULT 0,
    PRIMARY KEY (preset_id, pt_id)
  )`);

  // --- atribuição "PT de casa": MÚLTIPLA por pessoa (pt_id entra na PK) ---
  await client.query(`CREATE TABLE IF NOT EXISTS intencao_membro (
    tipo    TEXT NOT NULL,                   -- 'nodewar' | 'siege'
    chave   TEXT NOT NULL,                   -- chaveNome(familia)
    familia TEXT NOT NULL,
    pt_id   BIGINT NOT NULL REFERENCES participacao_pt(id) ON DELETE CASCADE,
    PRIMARY KEY (tipo, chave, pt_id)
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_intencao_membro_pt ON intencao_membro (pt_id)`);

  // --- cada mensagem postada = uma rodada ---
  await client.query(`CREATE TABLE IF NOT EXISTS intencao_post (
    message_id TEXT PRIMARY KEY,
    tipo       TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    titulo     TEXT,
    preset_id  BIGINT REFERENCES intencao_preset(id) ON DELETE SET NULL,
    evento_id  BIGINT REFERENCES evento(id) ON DELETE SET NULL,
    criado     TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_intencao_post_evento ON intencao_post (evento_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_intencao_post_tipo   ON intencao_post (tipo, criado DESC)`);

  // --- o que a pessoa marcou (N PTs por pessoa por rodada) ---
  await client.query(`CREATE TABLE IF NOT EXISTS intencao_marca (
    message_id TEXT NOT NULL REFERENCES intencao_post(message_id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL,                -- Discord user.id
    pt_id      BIGINT NOT NULL REFERENCES participacao_pt(id) ON DELETE CASCADE,
    chave      TEXT,                         -- chaveNome(familia) p/ casar com players
    familia    TEXT,
    marcado    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id, pt_id)
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_intencao_marca_chave ON intencao_marca (chave)`);

  // --- vai / não vai. Sem linha aqui = NÃO RESPONDEU (distinto de recusou) ---
  await client.query(`CREATE TABLE IF NOT EXISTS intencao_resp (
    message_id TEXT NOT NULL REFERENCES intencao_post(message_id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL,
    username   TEXT,
    familia    TEXT,
    chave      TEXT,
    resposta   TEXT NOT NULL CHECK (resposta IN ('vai','nao')),
    atualizado TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id)
  )`);

  // --- confirmação in-game POR EVENTO ("vai jogar"); o participar_scan de hoje é global e some ---
  await client.query(`CREATE TABLE IF NOT EXISTS evento_presenca (
    evento_id  BIGINT NOT NULL REFERENCES evento(id) ON DELETE CASCADE,
    chave      TEXT NOT NULL,
    familia    TEXT NOT NULL,
    participar BOOLEAN NOT NULL,
    origem     TEXT NOT NULL DEFAULT 'print' CHECK (origem IN ('print','manual')),
    atualizado TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (evento_id, chave)
  )`);

  // --- escalação final da staff: UMA PT por pessoa (a intenção múltipla vira decisão aqui) ---
  await client.query(`CREATE TABLE IF NOT EXISTS evento_escalacao (
    evento_id BIGINT NOT NULL REFERENCES evento(id) ON DELETE CASCADE,
    chave     TEXT NOT NULL,
    familia   TEXT NOT NULL,
    pt_id     BIGINT REFERENCES participacao_pt(id) ON DELETE SET NULL,
    atualizado TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (evento_id, chave)
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_evento_escalacao_pt ON evento_escalacao (evento_id, pt_id)`);

  const t = await client.query(`SELECT
    to_regclass('intencao_preset')    AS preset,
    to_regclass('intencao_preset_pt') AS preset_pt,
    to_regclass('intencao_membro')    AS membro,
    to_regclass('intencao_post')      AS post,
    to_regclass('intencao_marca')     AS marca,
    to_regclass('intencao_resp')      AS resp,
    to_regclass('evento_presenca')    AS presenca,
    to_regclass('evento_escalacao')   AS escalacao`);
  console.log("OK — tabelas novas:", t.rows[0]);

  // guarda-chuva: a stack antiga TEM que continuar intacta (o combinado é não mexer nela)
  const velhas = await client.query(`SELECT
    (SELECT count(*) FROM participacao_pt)       AS pts,
    (SELECT count(*) FROM participacao_membro)   AS membros_antigos,
    (SELECT count(*) FROM participacao_template) AS templates,
    (SELECT count(*) FROM participacao_resp)     AS respostas_antigas`);
  console.log("stack antiga (deve estar igual):", velhas.rows[0]);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
