// Canal POR PRESET + agendamento de disparo.
//
// Canal no preset (e não só por tipo): dois presets do mesmo tipo podem sair em canais
// diferentes — T1 num canal de core, T2 num canal aberto, por exemplo.
//
// A agenda é uma linha por HORÁRIO, com os dias da semana em que vale. "Todo dia às 20:20 e
// às 22:00" são duas linhas. ultimo_disparo evita disparo duplicado quando o timer bate duas
// vezes na mesma janela.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_agenda.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();

  if (!(await temCol("intencao_preset", "canal_id"))) {
    await client.query(`ALTER TABLE intencao_preset ADD COLUMN canal_id TEXT`);
    console.log("intencao_preset.canal_id criado (vazio = cai no canal do tipo)");
  }

  await client.query(`CREATE TABLE IF NOT EXISTS intencao_agenda (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    preset_id      BIGINT NOT NULL REFERENCES intencao_preset(id) ON DELETE CASCADE,
    dias           INT[] NOT NULL DEFAULT '{}',   -- 0=dom .. 6=sáb, em horário de Brasília
    hora           TEXT NOT NULL,                 -- "HH:MM"
    ativo          BOOLEAN NOT NULL DEFAULT TRUE,
    ultimo_disparo TIMESTAMPTZ,                   -- trava contra disparo duplo na mesma janela
    criado         TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_intencao_agenda_preset ON intencao_agenda (preset_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_intencao_agenda_ativo ON intencao_agenda (ativo) WHERE ativo`);

  const { rows: [r] } = await client.query(`SELECT
    (SELECT count(*)::int FROM intencao_preset) presets,
    (SELECT count(*)::int FROM intencao_preset WHERE canal_id IS NOT NULL) com_canal,
    (SELECT count(*)::int FROM intencao_agenda) agendas`);
  console.log("OK —", JSON.stringify(r));
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
