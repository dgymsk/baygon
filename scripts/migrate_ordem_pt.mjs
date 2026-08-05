// Ordem dos jogadores DENTRO da PT.
//
// Até aqui a escalação sabia em qual party a pessoa está, mas não em que posição — a tela listava
// pela ordem que o banco devolvia. Só que dentro da PT a posição significa coisa: o primeiro é o
// LÍDER, e a sequência é a que a staff quer ver na hora de montar.
//
// Coluna nova em vez de reaproveitar `atualizado`: reordenar não pode depender de "quem foi mexido
// por último", senão qualquer edição embaralha a lista.
//
// Backfill: quem já está escalado recebe a posição pela ordem alfabética atual, que é como a tela
// vinha mostrando (getEscalacao ordena por familia). Assim nada se move sozinho na primeira carga.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_ordem_pt.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();

  if (!(await temCol("evento_escalacao", "ordem_pt"))) {
    await client.query(`ALTER TABLE evento_escalacao ADD COLUMN ordem_pt INT`);
    console.log("evento_escalacao.ordem_pt criado");
  }

  const { rowCount: pos } = await client.query(`
    UPDATE evento_escalacao e SET ordem_pt = s.n
    FROM (SELECT evento_id, chave,
                 (row_number() OVER (PARTITION BY evento_id, party_id ORDER BY familia) - 1)::int AS n
          FROM evento_escalacao WHERE party_id IS NOT NULL) s
    WHERE s.evento_id = e.evento_id AND s.chave = e.chave AND e.ordem_pt IS NULL`);
  if (pos) console.log(`${pos} escalado(s) receberam posição pela ordem alfabética atual`);

  await client.query(`CREATE INDEX IF NOT EXISTS ix_escalacao_ordem ON evento_escalacao (evento_id, party_id, ordem_pt)`);

  const { rows } = await client.query(`
    SELECT evento_id::int AS evento, party_id::int AS party, count(*)::int AS n,
           string_agg(familia, ' → ' ORDER BY ordem_pt) AS ordem
    FROM evento_escalacao WHERE party_id IS NOT NULL GROUP BY 1,2 ORDER BY 1,2`);
  if (rows.length) console.table(rows); else console.log("nenhuma PT montada ainda");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
