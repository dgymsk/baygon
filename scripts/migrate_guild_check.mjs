// Relaxa os CHECK de guilda (players + vagas_config) que fixavam IN ('MANI','RESO'),
// pra a aliança aceitar N guildas configuradas em /guildas. Só REMOVE os CHECKs
// (não toca em dados, NOT NULL, DEFAULT nem PK). Idempotente.
// Uso: node --env-file=.env.local scripts/migrate_guild_check.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  const { rows } = await client.query(`
    SELECT conname, conrelid::regclass::text AS tbl
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN ('players'::regclass, 'vagas_config'::regclass)
      AND pg_get_constraintdef(oid) ILIKE '%guilda%'
  `);
  if (!rows.length) console.log("Nenhum CHECK de guilda encontrado (já relaxado).");
  for (const r of rows) {
    await client.query(`ALTER TABLE ${r.tbl} DROP CONSTRAINT "${r.conname}"`);
    console.log(`DROP CHECK ${r.tbl}.${r.conname}`);
  }
  console.log("OK — CHECK de guilda relaxado.");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
