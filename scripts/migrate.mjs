// Aplica o schema (modelo_dados.sql) no Neon.
// Uso: node --env-file=.env.local scripts/migrate.mjs
// Re-executavel: dropa as tabelas antes de recriar (clean slate).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) {
  console.error("DATABASE_URL_UNPOOLED/DATABASE_URL ausente. Rode com: node --env-file=.env.local scripts/migrate.mjs");
  process.exit(1);
}

const sql = fs.readFileSync(path.join(root, "modelo_dados.sql"), "utf8");

// ordem reversa de dependencia para o DROP
const tables = [
  "discrepancia", "war_guilda", "benchmarks", "desempenho",
  "wars", "grupos_metricas", "metricas", "players",
];
const drops = tables.map((t) => `DROP TABLE IF EXISTS ${t} CASCADE;`).join("\n");

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log("conectado. limpando tabelas antigas...");
  await client.query(drops);
  console.log("aplicando modelo_dados.sql...");
  await client.query(sql);

  const { rows: tbls } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
  );
  const { rows: nm } = await client.query(`SELECT count(*)::int AS n FROM metricas`);
  const { rows: ng } = await client.query(`SELECT count(*)::int AS n FROM grupos_metricas`);
  console.log("tabelas:", tbls.map((r) => r.tablename).join(", "));
  console.log(`seed config -> metricas: ${nm[0].n}, grupos_metricas: ${ng[0].n}`);
  console.log("OK migrate");
} catch (e) {
  console.error("ERRO migrate:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
