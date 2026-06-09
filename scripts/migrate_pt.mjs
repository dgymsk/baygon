// Cria SÓ as tabelas de PT (montar squads). Idempotente e NÃO-destrutivo.
// Uso: node --env-file=.env.local scripts/migrate_pt.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const ddl = `
CREATE TABLE IF NOT EXISTS pt_scan (
  chave      TEXT PRIMARY KEY,
  familia    TEXT NOT NULL,
  pt         TEXT,
  lider      BOOLEAN NOT NULL DEFAULT FALSE,
  atualizado TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pt_meta (
  id      INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  war_key TEXT
);
INSERT INTO pt_meta (id, war_key) VALUES (1, NULL) ON CONFLICT DO NOTHING;
`;

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(ddl);
  const { rows } = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'pt_%' ORDER BY tablename`);
  console.log("OK — tabelas:", rows.map((r) => r.tablename).join(", "));
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
