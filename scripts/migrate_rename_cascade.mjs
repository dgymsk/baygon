// ON UPDATE CASCADE nas 5 FKs que apontam pra players.nome_familia.
//
// POR QUE É OBRIGATÓRIO. `nome_familia` é a PK, e com ON UPDATE NO ACTION dos dois lados renomear é
// impossível: mexer no pai estoura 23503 (o filho ainda referencia o nome velho) e mexer no filho
// primeiro estoura 23503 também (o nome novo ainda não existe no pai). SET CONSTRAINTS ALL DEFERRED
// não salva — nenhuma das 5 é DEFERRABLE.
//
// E o erro engana: o Postgres nomeia UMA constraint só, escolhida pela ordem textual do nome do
// trigger interno (RI_ConstraintTrigger_a_<oid>, comparado como string). Na prática ele reclama da
// garmoth_build, que tem 1 linha, e não da desempenho, que tem milhares. Quem consertar "a que
// apareceu" bate na próxima, quatro vezes seguidas.
//
// DROP+ADD é obrigatório, não preferência: ALTER TABLE ... ALTER CONSTRAINT ... ON UPDATE CASCADE
// não existe no PostgreSQL (só dá pra alterar deferrability por lá).
//
// O ON DELETE É REPETIDO NO ADD de propósito. O DROP leva a regra de delete junto, e omiti-la aqui
// rebaixaria três FKs pra NO ACTION em silêncio — quebrando a exclusão de jogador, que depende do
// CASCADE. É o erro mais fácil de cometer neste arquivo.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_rename_cascade.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

const FKS = [
  ["desempenho",        "desempenho_nome_familia_fkey",        ""],
  ["discrepancia",      "discrepancia_nome_familia_fkey",      ""],
  ["garmoth_build",     "garmoth_build_nome_familia_fkey",     " ON DELETE CASCADE"],
  ["garmoth_gear_hist", "garmoth_gear_hist_nome_familia_fkey", " ON DELETE CASCADE"],
  ["war_player",        "war_player_nome_familia_fkey",        " ON DELETE CASCADE"],
];

try {
  await client.connect();

  console.log("antes:");
  console.table((await client.query(`
    SELECT c.conname, t.relname AS tabela,
           CASE c.confupdtype WHEN 'c' THEN 'CASCADE' ELSE 'NO ACTION' END AS on_update,
           CASE c.confdeltype WHEN 'c' THEN 'CASCADE' ELSE 'NO ACTION' END AS on_delete
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_class f ON f.oid = c.confrelid
    WHERE c.contype='f' AND f.relname='players' ORDER BY t.relname`)).rows);

  // o DROP pega ACCESS EXCLUSIVE em players (derruba os triggers dos DOIS lados), e um lock desses
  // pendente enfileira até leitura. Falhar rápido é melhor que travar o app inteiro esperando.
  await client.query("SET lock_timeout = '5s'");
  await client.query("BEGIN");   // tudo ou nada: nunca 3 convertidas e 2 não
  let n = 0;
  for (const [tab, con, del] of FKS) {
    const { rowCount } = await client.query(
      `SELECT 1 FROM pg_constraint WHERE conname=$1 AND contype='f' AND confupdtype='c'`, [con]);
    if (rowCount) { console.log(`${con} já tem ON UPDATE CASCADE`); continue; }
    await client.query(`ALTER TABLE ${tab} DROP CONSTRAINT ${con}`);
    await client.query(`ALTER TABLE ${tab} ADD CONSTRAINT ${con}
      FOREIGN KEY (nome_familia) REFERENCES players(nome_familia)${del} ON UPDATE CASCADE`);
    console.log(`${con} convertida${del ? " (ON DELETE CASCADE preservado)" : ""}`);
    n++;
  }
  await client.query("COMMIT");

  console.log(`\ndepois (convertidas agora: ${n}):`);
  console.table((await client.query(`
    SELECT c.conname, t.relname AS tabela,
           CASE c.confupdtype WHEN 'c' THEN 'CASCADE' ELSE 'NO ACTION' END AS on_update,
           CASE c.confdeltype WHEN 'c' THEN 'CASCADE' ELSE 'NO ACTION' END AS on_delete
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_class f ON f.oid = c.confrelid
    WHERE c.contype='f' AND f.relname='players' ORDER BY t.relname`)).rows);

  const { rows: [r] } = await client.query(`
    SELECT count(*) FILTER (WHERE c.confupdtype='c')::int AS com_update,
           count(*) FILTER (WHERE c.confdeltype='c')::int AS com_delete, count(*)::int AS total
    FROM pg_constraint c JOIN pg_class f ON f.oid = c.confrelid
    WHERE c.contype='f' AND f.relname='players'`);
  console.log(`ON UPDATE CASCADE: ${r.com_update}/${r.total} · ON DELETE CASCADE preservado em ${r.com_delete} (tem que ser 3)`);
  if (r.com_update !== 5 || r.com_delete !== 3) { console.error("⚠ estado inesperado"); process.exitCode = 1; }
} catch (e) {
  console.error("ERRO:", e.message);
  try { await client.query("ROLLBACK"); } catch {}
  process.exitCode = 1;
} finally { await client.end(); }
