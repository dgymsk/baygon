// Alianças presentes na war.
//
// Quem estava em campo muda tudo na leitura do resultado: perder pra duas alianças grandes não é a
// mesma coisa que perder pra uma. Sem isso, a estatística de uma war fica sem o contexto que a
// explica, e comparar duas wars vira comparar números soltos.
//
// TEXT[] e não tabela própria: é rótulo digitado pela staff no fechamento do evento, sem cadastro,
// sem id e sem nada pendurado. Se um dia virar entidade (com histórico, tag, ícone), aí muda.
//
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_aliancas_war.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();

  if (!(await temCol("wars", "aliancas"))) {
    // NOT NULL DEFAULT '{}' pra "não informado" e "nenhuma" serem a mesma coisa (array vazio),
    // evitando ter que testar NULL em toda leitura
    await client.query(`ALTER TABLE wars ADD COLUMN aliancas TEXT[] NOT NULL DEFAULT '{}'`);
    console.log("wars.aliancas criado");
  }

  // índice GIN: "em quais wars a aliança X apareceu?" é a pergunta que essa coluna existe pra responder
  await client.query(`CREATE INDEX IF NOT EXISTS ix_wars_aliancas ON wars USING GIN (aliancas)`);

  const { rows: [r] } = await client.query(`SELECT
    (SELECT count(*)::int FROM wars) wars,
    (SELECT count(*)::int FROM wars WHERE cardinality(aliancas) > 0) com_aliancas`);
  console.log("OK —", JSON.stringify(r));
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
