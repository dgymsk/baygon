// Preset direto no evento — pra existir evento sem chamada do bot.
//
// Até aqui o preset de um evento só existia em intencao_post.preset_id, então evento criado à mão
// (ou pelo bot antigo) não tinha como saber quais PTs formam as colunas da escalação — a tela de
// escalação abria sem coluna nenhuma. Com a coluna aqui, o evento carrega o próprio preset e o post
// vira só mais uma origem possível.
//
// Backfill: eventos que JÁ têm post herdam o preset dele, então nada muda pra quem existe hoje.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_evento_preset.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();

  if (!(await temCol("evento", "preset_id"))) {
    // ON DELETE SET NULL: apagar um preset não pode levar o evento junto — o histórico da war fica.
    await client.query(`ALTER TABLE evento ADD COLUMN preset_id BIGINT REFERENCES intencao_preset(id) ON DELETE SET NULL`);
    console.log("evento.preset_id criado");
  }

  const { rowCount: herdaram } = await client.query(`
    UPDATE evento e SET preset_id = p.preset_id
    FROM intencao_post p
    WHERE p.evento_id = e.id AND p.preset_id IS NOT NULL AND e.preset_id IS NULL`);
  if (herdaram) console.log(`${herdaram} evento(s) herdaram o preset do próprio post`);

  await client.query(`CREATE INDEX IF NOT EXISTS ix_evento_preset ON evento (preset_id)`);

  const { rows: [r] } = await client.query(`SELECT
    (SELECT count(*)::int FROM evento) eventos,
    (SELECT count(*)::int FROM evento WHERE preset_id IS NOT NULL) com_preset,
    (SELECT count(*)::int FROM evento e WHERE NOT EXISTS (SELECT 1 FROM intencao_post p WHERE p.evento_id = e.id)) sem_post_de_intencao`);
  console.log("OK —", JSON.stringify(r));
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
