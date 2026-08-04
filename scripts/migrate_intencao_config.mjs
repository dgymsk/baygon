// Duas salas distintas por tipo de war:
//   CHAMADA — onde sai o convite pra marcar a função (o bot de intenção);
//   LISTA   — onde sai a escalação pronta, pra galera ver quem está em qual PT.
//
// Separar importa porque são públicos diferentes: a chamada é pra todo mundo responder, a lista
// é o resultado. Misturar as duas no mesmo canal enterra uma na outra.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_intencao_config.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();

  await client.query(`CREATE TABLE IF NOT EXISTS intencao_config (
    id     INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    config TEXT  -- JSON: { nodewar: {canalChamada, canalLista}, siege: {...} }
  )`);
  await client.query(`INSERT INTO intencao_config (id, config) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING`);

  // a lista é UMA mensagem por evento, editada — guarda onde ela mora pra poder reeditar
  for (const c of ["lista_message_id", "lista_channel_id"]) {
    if (!(await temCol("intencao_post", c))) {
      await client.query(`ALTER TABLE intencao_post ADD COLUMN ${c} TEXT`);
      console.log(`intencao_post.${c} criado`);
    }
  }

  // semente: herda o canal da chamada do que já está configurado em /participacao, pra não
  // começar vazio e o disparo quebrar
  const { rows: [p] } = await client.query(`SELECT config FROM participacao_config WHERE id = 1`);
  const { rows: [i] } = await client.query(`SELECT config FROM intencao_config WHERE id = 1`);
  if (!i?.config && p?.config) {
    const velha = JSON.parse(p.config);
    const nova = {
      nodewar: { canalChamada: velha?.nodewar?.channelId ?? "", canalLista: "" },
      siege: { canalChamada: velha?.siege?.channelId ?? "", canalLista: "" },
    };
    await client.query(`UPDATE intencao_config SET config = $1 WHERE id = 1`, [JSON.stringify(nova)]);
    console.log("config semeada a partir de /participacao:", JSON.stringify(nova));
  }

  const { rows: [r] } = await client.query(`SELECT config FROM intencao_config WHERE id = 1`);
  console.log("OK — intencao_config:", r?.config ?? "(vazia)");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
