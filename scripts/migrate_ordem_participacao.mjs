// Ordem de chegada da participação + thread da chamada.
//
// `atualizado` não serve pra ordenar: ele é reescrito toda vez que a pessoa troca de função, então
// quem marcou às 20h01 e ajustou a função às 20h40 aparecia atrás de quem chegou às 20h30. Precisa
// de um carimbo do PRIMEIRO "vai", que sobrevive à troca — é o mesmo desenho do `can_em` do bot
// antigo (participacao_resp), que já resolvia isso pra fila de espera.
//
// Desmarcar apaga a linha, e com ela o carimbo: quem sai e volta perde a vez. É a semântica honesta
// — a alternativa (guardar o carimbo de quem desistiu) daria prioridade a quem não estava lá.
//
// `thread_id` no post e `thread_msg_id` na resposta: a thread recebe uma mensagem por pessoa, na
// ordem de chegada, e o id guardado é o que impede a segunda mensagem quando a pessoa só troca de
// função.
//
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_ordem_participacao.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;
const addCol = async (t, c, tipo) => {
  if (await temCol(t, c)) return false;
  await client.query(`ALTER TABLE ${t} ADD COLUMN ${c} ${tipo}`);
  console.log(`${t}.${c} criado`);
  return true;
};

try {
  await client.connect();

  await addCol("intencao_resp", "vai_em", "TIMESTAMPTZ");        // 1º "vai" — a ordem da fila
  await addCol("intencao_resp", "thread_msg_id", "TEXT");        // mensagem dessa pessoa na thread
  await addCol("intencao_post", "thread_id", "TEXT");            // thread da chamada (criada no 1º clique)

  // quem já respondeu "vai" antes desta migração herda o `atualizado` como carimbo: é a melhor
  // aproximação existente, e deixar NULL jogaria essa gente pro fim de qualquer ordenação
  const { rowCount: herdou } = await client.query(`
    UPDATE intencao_resp SET vai_em = atualizado WHERE resposta = 'vai' AND vai_em IS NULL`);
  if (herdou) console.log(`${herdou} resposta(s) herdaram o carimbo de 'atualizado'`);

  // ordenar a fila de uma chamada é a única leitura que essa coluna serve
  await client.query(`CREATE INDEX IF NOT EXISTS ix_intencao_resp_ordem ON intencao_resp (message_id, vai_em)`);

  const { rows: [r] } = await client.query(`SELECT
    (SELECT count(*)::int FROM intencao_resp) respostas,
    (SELECT count(*)::int FROM intencao_resp WHERE resposta = 'vai') vai,
    (SELECT count(*)::int FROM intencao_resp WHERE vai_em IS NOT NULL) com_carimbo,
    (SELECT count(*)::int FROM intencao_post WHERE thread_id IS NOT NULL) posts_com_thread`);
  console.log("OK —", JSON.stringify(r));
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
