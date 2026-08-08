// QUANDO a pessoa passou a ser cobrável pelo bot.
//
// O histórico do card quer distinguir "não respondeu a intenção" (silêncio de quem estava lá) de
// "sem dado" (não estava lá pra responder). Sem uma data de registro, quem entrar amanhã apareceria
// com uma fileira de faltas de silêncio em guerras que aconteceram antes de ele existir no sistema —
// acusação retroativa, e a pior espécie: a que parece dado.
//
// NULL = já estava antes deste controle. É o valor certo pros 109 já cadastrados: eles de fato
// estavam presentes nas guerras que o banco tem hoje. Quem se registrar daqui pra frente ganha o
// carimbo, e as guerras anteriores a ele viram "sem dado".
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_registrado_em.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();
  if (await temCol("players", "registrado_em")) console.log("players.registrado_em já existe");
  else {
    await client.query(`ALTER TABLE players ADD COLUMN registrado_em TIMESTAMPTZ`);
    console.log("players.registrado_em criado (NULL = já estava antes do controle)");
  }
  const r = await client.query(`SELECT count(*)::int AS players, count(registrado_em)::int AS com_carimbo,
    count(*) FILTER (WHERE registro)::int AS registrados FROM players`);
  console.log("ok:", r.rows[0]);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
