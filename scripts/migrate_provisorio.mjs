// PRÉ-SELEÇÃO ("provisório") de jogadores para uma guerra ainda aberta.
//
// É o passo que existia só na cabeça da staff: olhando quem tem aparecido, marcar quem se PRETENDE
// levar — antes de montar PT, antes de convocar. Hoje isso ou virava escalação direto (o que já
// dispara DM e ocupa vaga) ou ficava fora do app.
//
// TABELA PRÓPRIA, e não uma coluna em evento_escalacao. Duas razões:
//   1. `evento_escalacao` ganhou significado: linha lá quer dizer "foi convocado / respondeu /
//      esteve numa PT", e o DELETE dela é condicionado a não haver história. Marcar provisório
//      criaria linha sem nenhuma dessas coisas e sujaria as contagens de escalado/recusou.
//   2. Provisório é rascunho: apagar em massa e refazer tem que ser barato e não pode arrastar
//      confirmação de DM junto.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_provisorio.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS evento_provisorio (
      evento_id BIGINT NOT NULL REFERENCES evento(id) ON DELETE CASCADE,
      chave     TEXT   NOT NULL,
      familia   TEXT   NOT NULL,
      criado    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (evento_id, chave)
    )`);
  // mesma chave composta do resto do funil (evento_id, chave), então a identidade casa sem tradução
  await client.query(`CREATE INDEX IF NOT EXISTS ix_evento_provisorio_chave ON evento_provisorio (chave)`);
  console.log("tabela evento_provisorio pronta");
  console.table((await client.query(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name='evento_provisorio' ORDER BY ordinal_position`)).rows);
  console.log("linhas:", (await client.query(`SELECT count(*)::int n FROM evento_provisorio`)).rows[0].n);
} catch (e) {
  console.error("ERRO:", e.message); process.exitCode = 1;
} finally { await client.end(); }
