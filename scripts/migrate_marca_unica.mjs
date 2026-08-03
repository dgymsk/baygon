// Uma pessoa marca UMA função por rodada. Marcar outra TROCA, não acumula.
//
// A "função de casa" (intencao_membro) continua MÚLTIPLA de propósito: lá é a capacidade — quais
// papéis a pessoa sabe fazer. Aqui é a intenção daquela war, e nela você joga numa posição só.
//
// Deduplica o que já existe (mantém a marca mais RECENTE) e cria a UNIQUE que torna a regra
// estrutural, não só disciplina de código. Idempotente.
// Uso: node --env-file=.env.local scripts/migrate_marca_unica.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();

  const { rows: dupes } = await client.query(`
    SELECT message_id, user_id, count(*)::int n, min(familia) familia
    FROM intencao_marca GROUP BY message_id, user_id HAVING count(*) > 1`);
  if (dupes.length) {
    console.log("marcas múltiplas encontradas (fica a mais recente):");
    for (const d of dupes) console.log(`   ${d.familia}: ${d.n} marcas`);
  }

  // mantém só a última marca de cada pessoa em cada rodada
  const { rowCount } = await client.query(`
    DELETE FROM intencao_marca m
    USING intencao_marca mais_nova
    WHERE m.message_id = mais_nova.message_id
      AND m.user_id = mais_nova.user_id
      AND (mais_nova.marcado, mais_nova.funcao_id) > (m.marcado, m.funcao_id)`);
  console.log(`removidas ${rowCount} marca(s) antiga(s).`);

  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_intencao_marca_uma_por_rodada
    ON intencao_marca (message_id, user_id)`);

  const { rows: [r] } = await client.query(`SELECT
    (SELECT count(*)::int FROM intencao_marca) marcas,
    (SELECT count(*)::int FROM (SELECT 1 FROM intencao_marca GROUP BY message_id, user_id HAVING count(*) > 1) x) ainda_duplicadas,
    (SELECT count(*)::int FROM intencao_membro) funcoes_de_casa`);
  console.log("OK —", JSON.stringify(r), r.ainda_duplicadas === 0 ? "✔ uma marca por pessoa" : "✘ ainda tem duplicata");
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
