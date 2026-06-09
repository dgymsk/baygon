// Adiciona colunas: participar_meta.pos_liberacao e remocao_scan.tipo.
// Idempotente e NÃO-destrutivo. Uso: node --env-file=.env.local scripts/migrate_roubo_subir.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const ddl = `
ALTER TABLE participar_meta ADD COLUMN IF NOT EXISTS pos_liberacao BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE remocao_scan   ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'remover';
`;

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(ddl);
  const { rows } = await client.query(`SELECT column_name, table_name FROM information_schema.columns WHERE (table_name='participar_meta' AND column_name='pos_liberacao') OR (table_name='remocao_scan' AND column_name='tipo')`);
  console.log("OK — colunas:", rows.map((r) => `${r.table_name}.${r.column_name}`).join(", "));
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
