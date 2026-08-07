// Teto de vagas POR EVENTO.
//
// Hoje o teto ("máx 40") mora só no preset, e vale pra toda guerra lançada com aquela chamada. Mas
// o teto é do NÓ, não da chamada: um T1 e um T2 com o mesmo preset têm limites diferentes, e mudar
// no preset pra acertar a guerra de hoje mudaria a régua das guerras passadas — a mesma armadilha
// que as PTs por evento resolveram.
//
// NULL = segue o teto da chamada, que é o comportamento de hoje.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_evento_tamanho.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();
  if (await temCol("evento", "tamanho_max")) console.log("evento.tamanho_max já existe");
  else {
    await client.query(`ALTER TABLE evento ADD COLUMN tamanho_max INT`);
    console.log("evento.tamanho_max criado");
  }
  const r = await client.query(`SELECT count(*)::int AS eventos, count(tamanho_max)::int AS com_teto_proprio FROM evento`);
  console.log("ok:", r.rows[0]);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
