// Cargo do Discord exigido por uma função.
//
// A guilda já usava cargos pra controlar quem marcava o quê no Apollo. Sem isso, qualquer um clica
// em "Shai" na chamada e entra na lista como Shai — a staff só descobre na hora de montar a PT.
//
// NULL = função aberta a todo mundo (o comportamento de hoje). Preenchido = só quem tem o cargo
// consegue marcar. Nullable de propósito: exigir cargo em todas obrigaria a configurar tudo antes
// de o bot voltar a funcionar.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_funcao_role.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();
  if (!(await temCol("funcao", "role_id"))) {
    await client.query(`ALTER TABLE funcao ADD COLUMN role_id TEXT`);
    console.log("funcao.role_id criado (NULL = aberta a todos)");
  }
  const { rows } = await client.query(`SELECT id, nome, role_id FROM funcao ORDER BY ordem, id`);
  console.table(rows);
} catch (e) { console.error("ERRO:", e.message); process.exitCode = 1; }
finally { await client.end(); }
