// Integração Garmoth: guarda o id da build de cada player (players.garmoth_id) + o cache da resposta
// da API do Garmoth por player (garmoth_build). O worker (sempre-ligado) dispara o refresh a cada 2h.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_garmoth.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  // config: id da build do Garmoth (o pedaço final de garmoth.com/character/<id>), setado no /membros.
  await client.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS garmoth_id TEXT`);
  // cache da resposta da API (1 linha por player). O worker preenche; o site lê p/ exibir.
  await client.query(`CREATE TABLE IF NOT EXISTS garmoth_build (
    nome_familia TEXT PRIMARY KEY REFERENCES players(nome_familia) ON DELETE CASCADE,
    garmoth_id   TEXT NOT NULL,               -- id que gerou este cache (detecta stale se players.garmoth_id mudar)
    char_name    TEXT,                          -- nome do personagem no Garmoth
    char_class   INT,                           -- classe (código numérico do Garmoth)
    spec         TEXT,                          -- succ/awak/etc
    level        INT,
    ap           INT,
    aap          INT,
    dp           INT,
    acc          INT,                           -- accuracy
    dados        JSONB,                          -- resposta crua (elemento do array) p/ uso futuro
    atualizado   TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  console.log("OK — players.garmoth_id + garmoth_build:", (await client.query(`SELECT to_regclass('garmoth_build') t`)).rows[0].t);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
