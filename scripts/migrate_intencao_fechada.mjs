// Fechar a INTENÇÃO ≠ travar o EVENTO.
//
// O encerramento foi implementado como `evento.status = 'travado'`, e isso trava a operação inteira:
// a tela usa `status === 'aberto'` pra liberar escalação, convocação e presença. Mas fechar a
// intenção é só parar o BOT de aceitar marcação nova — a staff continua montando PT, mandando DM e
// conferindo presença depois. São dois interruptores diferentes e viraram um só por engano.
//
// `intencao_post.fechada` separa os dois: é uma propriedade da MENSAGEM (o que fecha é a lista de
// intenção), não do evento.
//
// Migração dos dados: evento 'travado' que tem post de INTENÇÃO foi fechado por esse botão — marca
// o post como fechado (preserva a intenção da staff) e devolve o evento pra 'aberto' (devolve a
// operação). Evento travado da stack ANTIGA (participacao_post) não é tocado: lá 'travado' sempre
// significou o que diz.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_intencao_fechada.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();
  if (await temCol("intencao_post", "fechada")) console.log("intencao_post.fechada já existe");
  else {
    await client.query(`ALTER TABLE intencao_post ADD COLUMN fechada BOOLEAN NOT NULL DEFAULT FALSE`);
    console.log("intencao_post.fechada criado");
  }

  const marcados = await client.query(`
    UPDATE intencao_post p SET fechada = TRUE
    FROM evento e
    WHERE e.id = p.evento_id AND e.status = 'travado' AND p.fechada = FALSE
    RETURNING p.message_id, p.evento_id`);
  console.log(`posts marcados como fechados: ${marcados.rowCount}`, marcados.rows.map((r) => r.evento_id));

  const reabertos = await client.query(`
    UPDATE evento e SET status = 'aberto', travado_em = NULL
    WHERE e.status = 'travado'
      AND EXISTS (SELECT 1 FROM intencao_post p WHERE p.evento_id = e.id)
      AND NOT EXISTS (SELECT 1 FROM participacao_post p WHERE p.evento_id = e.id)
    RETURNING id, titulo`);
  console.log(`eventos devolvidos pra 'aberto': ${reabertos.rowCount}`, reabertos.rows.map((r) => `${r.id} ${r.titulo}`));

  const r = await client.query(`SELECT
    (SELECT count(*)::int FROM evento WHERE status='aberto') abertos,
    (SELECT count(*)::int FROM evento WHERE status='travado') travados,
    (SELECT count(*)::int FROM intencao_post WHERE fechada) intencoes_fechadas`);
  console.log("ok:", r.rows[0]);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
