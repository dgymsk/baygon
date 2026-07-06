// Faceta RESULTADO do evento: liga o evento ao registro de guerra (wars) + o resultado manual.
// Hub-and-spoke: satélite que aponta evento_id (o hub nao muda). Idempotente.
// Uso: node --env-file=.env.local scripts/migrate_evento_resultado.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS evento_resultado (
    evento_id BIGINT PRIMARY KEY REFERENCES evento(id) ON DELETE CASCADE,
    resultado TEXT,                                                  -- 'derrota' | 'participacao' | 'vitoria' (manual)
    war_id    BIGINT REFERENCES wars(war_id) ON DELETE SET NULL,     -- stats extraidos do print (opcional)
    gravado   TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_evento_resultado_war ON evento_resultado (war_id)`);
  console.log("OK — evento_resultado:", (await client.query(`SELECT to_regclass('evento_resultado') t`)).rows[0].t);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
