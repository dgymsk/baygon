// "relíquia" vira "Pokémon Lendário" — a coluna acompanha o vocabulário, senão o código fala
// uma língua e a tela fala outra. Continua sendo atributo fixo da pessoa que NUNCA vai pro bot.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_lendario.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name=$1`, [c])).rowCount > 0;

try {
  await client.connect();
  const tinha = await temCol("reliquia");
  const jaTem = await temCol("lendario");

  if (tinha && !jaTem) {
    await client.query(`ALTER TABLE players RENAME COLUMN reliquia TO lendario`);
    console.log("coluna renomeada: reliquia → lendario");
  } else if (!jaTem) {
    await client.query(`ALTER TABLE players ADD COLUMN lendario BOOLEAN NOT NULL DEFAULT FALSE`);
    console.log("coluna lendario criada");
  } else {
    console.log("lendario já existe — nada a fazer");
    if (tinha) { await client.query(`ALTER TABLE players DROP COLUMN reliquia`); console.log("coluna reliquia antiga removida"); }
  }

  const { rows: [r] } = await client.query(`SELECT count(*)::int total, count(*) FILTER (WHERE lendario)::int lendarios FROM players`);
  console.log("OK —", JSON.stringify(r));
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
