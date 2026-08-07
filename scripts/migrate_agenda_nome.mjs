// Nome do evento: escolhido no disparo manual, e um padrão por agenda.
//
// Hoje o evento nasce com o NOME DO PRESET ("NODEWAR T2"), então três wars da mesma semana ficam
// com o mesmo título e só se distinguem pela data numa outra coluna. A staff quer nomear —
// tipicamente com a data da guerra ("2026-08-07").
//
// No agendamento isso não pode ser digitado toda vez, então vira modelo: `nome_padrao` aceita o
// token {data}, resolvido no disparo. E {data} é o DIA SEGUINTE — a chamada sai na véspera (é o
// desenho desde o Apollo: o bot posta às 20:20 a war de amanhã), então a data que interessa nunca
// é a de hoje.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_agenda_nome.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();
  if (!(await temCol("intencao_agenda", "nome_padrao"))) {
    await client.query(`ALTER TABLE intencao_agenda ADD COLUMN nome_padrao TEXT`);
    console.log("intencao_agenda.nome_padrao criado (NULL = usa o nome do preset)");
  }
  const { rows } = await client.query(`
    SELECT a.hora, p.nome AS preset, COALESCE(a.nome_padrao, '(nome do preset)') AS nome_padrao
    FROM intencao_agenda a JOIN intencao_preset p ON p.id = a.preset_id ORDER BY a.hora`);
  if (rows.length) console.table(rows); else console.log("nenhuma agenda cadastrada ainda");
} catch (e) { console.error("ERRO:", e.message); process.exitCode = 1; }
finally { await client.end(); }
