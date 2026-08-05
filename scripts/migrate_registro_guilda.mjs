// Guilda escolhida na jornada de registro.
//
// Até aqui a jornada gravava todo mundo em 'MANI' (Manicômio), fixo no código — herança de quando a
// aliança era uma guilda só. Com a aliança tendo várias, quem se registra tem que dizer de qual é,
// senão a staff corrige uma a uma em /membros depois.
//
// Coluna no estado temporário da jornada (registro_jornada), que é apagado ao finalizar: o valor
// definitivo vai pra players.guilda junto com o resto, na mesma transação.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_registro_guilda.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();
  if (!(await temCol("registro_jornada", "guilda"))) {
    await client.query(`ALTER TABLE registro_jornada ADD COLUMN guilda TEXT`);
    console.log("registro_jornada.guilda criado");
  }
  const { rows: [r] } = await client.query(`SELECT
    (SELECT count(*)::int FROM registro_jornada) jornadas_abertas,
    (SELECT count(*)::int FROM players WHERE registro) registrados,
    (SELECT string_agg(DISTINCT guilda, ', ') FROM players) guildas_em_uso`);
  console.log("OK —", JSON.stringify(r));
} catch (e) { console.error("ERRO:", e.message); process.exitCode = 1; }
finally { await client.end(); }
