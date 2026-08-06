// Trava de registro: só quem fez a jornada do bot pode marcar na chamada.
//
// Sem isso, qualquer um do servidor clica e entra na lista — inclusive quem a guilda não conhece,
// sem família vinculada, sem gear e sem classe. Aí o nome só é resolvido por apelido do Discord, e
// a escalação começa com gente que o sistema não sabe quem é.
//
// Fica no PRESET (o padrão de cada chamada) e no EVENTO (o que de fato vale, herdado no disparo),
// mesmo desenho do tier: configura uma vez, e ainda dá pra abrir/fechar uma war específica sem
// mexer na configuração.
//
// Default FALSE: ligar pra todo mundo de uma vez travaria a chamada de hoje pra quem ainda não se
// registrou, e isso tem que ser decisão consciente da staff.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_exige_registro.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();
  for (const t of ["intencao_preset", "evento"]) {
    if (!(await temCol(t, "exige_registro"))) {
      await client.query(`ALTER TABLE ${t} ADD COLUMN exige_registro BOOLEAN NOT NULL DEFAULT FALSE`);
      console.log(`${t}.exige_registro criado (default FALSE = aberto)`);
    }
  }
  const { rows: [r] } = await client.query(`SELECT
    (SELECT count(*)::int FROM players WHERE registro) registrados,
    (SELECT count(*)::int FROM players WHERE ativo AND NOT registro) ativos_sem_registro,
    (SELECT count(*)::int FROM intencao_preset WHERE exige_registro) presets_travados,
    (SELECT count(*)::int FROM evento WHERE exige_registro) eventos_travados`);
  console.log("OK —", JSON.stringify(r));
  if (r.ativos_sem_registro) console.warn(`⚠ ${r.ativos_sem_registro} membro(s) ativos ainda NÃO se registraram — ligar a trava barra todos eles.`);
} catch (e) { console.error("ERRO:", e.message); process.exitCode = 1; }
finally { await client.end(); }
