// Grupos do bot de participação (staff pré-atribui). Idempotente.
// Uso: node --env-file=.env.local scripts/migrate_participacao_grupos.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();

  // catálogo de grupos por tipo (config reusável entre rodadas)
  await client.query(`CREATE TABLE IF NOT EXISTS participacao_grupo (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo       TEXT NOT NULL,                 -- 'nodewar' | 'siege'
    nome       TEXT NOT NULL,
    emoji      TEXT,                          -- unicode ou '<:nome:id>' (padrão ptConfig)
    limite_max INT,                           -- NULL = sem limite (capacidade planejada)
    ordem      INT NOT NULL DEFAULT 0,
    ativo      BOOLEAN NOT NULL DEFAULT TRUE,
    criado     TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_participacao_grupo_tipo ON participacao_grupo (tipo, ordem)`);

  // atribuição fixa jogador→grupo, 1 por tipo (staff distribui no painel)
  await client.query(`CREATE TABLE IF NOT EXISTS participacao_membro (
    tipo     TEXT NOT NULL,
    chave    TEXT NOT NULL,                   -- chaveNome(familia)
    familia  TEXT NOT NULL,                   -- exibição
    grupo_id BIGINT NOT NULL REFERENCES participacao_grupo(id) ON DELETE CASCADE,
    PRIMARY KEY (tipo, chave)
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_participacao_membro_grupo ON participacao_membro (grupo_id)`);

  const t = await client.query(`SELECT to_regclass('participacao_grupo') a, to_regclass('participacao_membro') b`);
  console.log("OK — tabelas:", t.rows[0]);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
