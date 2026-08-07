// Público-alvo do lote de DM.
//
// Até aqui o disparo tinha só um interruptor ("só quem não respondeu" ou "todos"), e a régua era
// RESPOSTA. Só que quem recebeu a DM e ficou calado não é o mesmo caso de quem nunca recebeu:
// reenviar pro primeiro é spam, e é justamente o que a staff quer evitar quando o Discord limita o
// bot e o lote sai pela metade.
//
// Guardar o público na linha do lote serve a duas coisas: a retomada só reaproveita um lote do
// MESMO público (senão a escolha da tela seria ignorada em silêncio), e o log de chamadas passa a
// dizer pra quem cada disparo foi.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_dm_publico.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();
  if (await temCol("dm_lote", "publico")) console.log("dm_lote.publico já existe");
  else {
    await client.query(`ALTER TABLE dm_lote ADD COLUMN publico TEXT`);
    // lotes antigos foram todos disparados no padrão de então
    await client.query(`UPDATE dm_lote SET publico = CASE WHEN tipo = 'convocacao' THEN 'sem_resposta' ELSE 'faltam_ingame' END WHERE publico IS NULL`);
    console.log("dm_lote.publico criado e preenchido nos lotes antigos");
  }
  const r = await client.query(`SELECT publico, count(*)::int AS n FROM dm_lote GROUP BY publico ORDER BY publico`);
  console.log("ok:", r.rows);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
