// Duas confirmações distintas, em momentos distintos:
//   1. DA ESCALAÇÃO — a staff escala, o bot manda DM, a pessoa aceita ou recusa (aqui);
//   2. IN-GAME      — apareceu de fato na tela de participação (evento_presenca, já existe).
//
// Recusar TIRA da PT (party_id = NULL) mas mantém a linha com confirmou=false: é assim que se
// distingue "recusou" de "nunca foi escalado" — sem isso a pessoa sumiria sem deixar rastro e a
// estatística de falta não teria como saber que ela avisou.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_confirma_escalacao.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();

  if (!(await temCol("evento_escalacao", "confirmou"))) {
    // NULL de propósito: "ainda não respondeu" é diferente de "recusou"
    await client.query(`ALTER TABLE evento_escalacao ADD COLUMN confirmou BOOLEAN`);
    console.log("evento_escalacao.confirmou criado (NULL = pendente)");
  }
  if (!(await temCol("evento_escalacao", "convidado_em"))) {
    await client.query(`ALTER TABLE evento_escalacao ADD COLUMN convidado_em TIMESTAMPTZ`);
    console.log("evento_escalacao.convidado_em criado (quando a DM foi enviada)");
  }
  if (!(await temCol("evento_escalacao", "respondeu_em"))) {
    await client.query(`ALTER TABLE evento_escalacao ADD COLUMN respondeu_em TIMESTAMPTZ`);
    console.log("evento_escalacao.respondeu_em criado");
  }
  // o clique vem do Discord, então a linha precisa saber de quem é
  if (!(await temCol("evento_escalacao", "user_id"))) {
    await client.query(`ALTER TABLE evento_escalacao ADD COLUMN user_id TEXT`);
    await client.query(`CREATE INDEX IF NOT EXISTS ix_evento_escalacao_user ON evento_escalacao (evento_id, user_id)`);
    console.log("evento_escalacao.user_id criado");
  }

  const { rows: [r] } = await client.query(`SELECT
    count(*)::int total,
    count(*) FILTER (WHERE confirmou IS TRUE)::int aceitaram,
    count(*) FILTER (WHERE confirmou IS FALSE)::int recusaram,
    count(*) FILTER (WHERE confirmou IS NULL)::int pendentes
    FROM evento_escalacao`);
  console.log("OK — evento_escalacao:", JSON.stringify(r));
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
