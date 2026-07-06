// Reestrutura participação: PTs globais + templates + atribuição por tipo + espera.
// Reseta os grupos/atribuições antigos (dados de teste). Idempotente.
// Uso: node --env-file=.env.local scripts/migrate_participacao_templates.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();

  // remove o modelo antigo (grupos por tipo) — dados de teste
  await client.query(`DROP TABLE IF EXISTS participacao_membro`);
  await client.query(`DROP TABLE IF EXISTS participacao_grupo`);

  // catálogo GLOBAL de PTs (nome + emoji)
  await client.query(`CREATE TABLE IF NOT EXISTS participacao_pt (
    id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome   TEXT NOT NULL,
    emoji  TEXT,
    criado TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  // atribuição jogador→PT, SEPARADA por tipo (nodewar/siege)
  await client.query(`CREATE TABLE IF NOT EXISTS participacao_membro (
    tipo    TEXT NOT NULL,
    chave   TEXT NOT NULL,                 -- chaveNome(familia)
    familia TEXT NOT NULL,
    pt_id   BIGINT NOT NULL REFERENCES participacao_pt(id) ON DELETE CASCADE,
    PRIMARY KEY (tipo, chave)
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_participacao_membro_pt ON participacao_membro (pt_id)`);

  // templates: nome + tipo + tamanho máximo da guerra
  await client.query(`CREATE TABLE IF NOT EXISTS participacao_template (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome        TEXT NOT NULL,
    tipo        TEXT NOT NULL,             -- 'nodewar' | 'siege'
    tamanho_max INT,                       -- trava total da guerra (NULL = sem trava)
    criado      TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  // quais PTs compõem o template (+ ordem)
  await client.query(`CREATE TABLE IF NOT EXISTS participacao_template_pt (
    template_id BIGINT NOT NULL REFERENCES participacao_template(id) ON DELETE CASCADE,
    pt_id       BIGINT NOT NULL REFERENCES participacao_pt(id) ON DELETE CASCADE,
    ordem       INT NOT NULL DEFAULT 0,
    PRIMARY KEY (template_id, pt_id)
  )`);

  // post: qual template foi usado; resp: quando confirmou (ordem da espera)
  await client.query(`ALTER TABLE participacao_post ADD COLUMN IF NOT EXISTS template_id BIGINT`);
  await client.query(`ALTER TABLE participacao_resp ADD COLUMN IF NOT EXISTS can_em TIMESTAMPTZ`);

  const t = await client.query(`SELECT to_regclass('participacao_pt') a, to_regclass('participacao_template') b, to_regclass('participacao_template_pt') c, to_regclass('participacao_membro') d`);
  console.log("OK — tabelas:", t.rows[0]);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
