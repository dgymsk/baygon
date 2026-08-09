// Terceiro tipo de guerra: ROSAS (além de nodewar e siege).
//
// Duas coisas mudam no banco:
//
// 1. O CHECK de `wars.tipo` — criado em migrate_papel_por_tipo.mjs com apenas ('nodewar','siege').
//    Sem alargar, gravar a estatística de um evento de rosas estoura na hora do INSERT/UPDATE.
//
// 2. A view `papel_na_war` é RECRIADA sem mudança de regra, só de comentário: ROSAS HERDA O PAPEL
//    DE NODE WAR. O CASE testa 'siege' e mais nada, então qualquer tipo que não seja siege cai em
//    players.grupo / players.is_core. Foi escolha, não esquecimento: as colunas de papel são uma
//    por tipo (grupo_siege, is_core_siege), e criar grupo_rosas/is_core_rosas dobra de novo a tela
//    de /membros pra um caso que ninguém pediu ainda. Quando pedirem, é ADD COLUMN + um ramo no
//    CASE + duas colunas na tabela — e a herança continua sendo o default de quem não preencher.
//
// `evento.tipo` NÃO tem CHECK no banco (migrate_eventos.mjs criou como TEXT solto), então o valor
// novo já entra por lá sem DDL. Quem barra lixo é o TypeScript (lib/tiposGuerra.ts).
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_tipo_rosas.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();

  await client.query(`ALTER TABLE wars DROP CONSTRAINT IF EXISTS ck_wars_tipo`);
  await client.query(`
    ALTER TABLE wars ADD CONSTRAINT ck_wars_tipo
      CHECK (tipo IS NULL OR tipo IN ('nodewar','siege','rosas'))`);
  console.log("ck_wars_tipo agora aceita rosas");

  await client.query(`
    CREATE OR REPLACE VIEW papel_na_war AS
    SELECT w.war_id, w.tipo, p.nome_familia,
           COALESCE(CASE WHEN w.tipo = 'siege' THEN p.grupo_siege   END, p.grupo)   AS grupo,
           COALESCE(CASE WHEN w.tipo = 'siege' THEN p.is_core_siege END, p.is_core) AS is_core
    FROM wars w CROSS JOIN players p`);
  console.log("papel_na_war recriada (rosas herda o papel de node war)");

  console.table((await client.query(`
    SELECT tipo, count(*)::int AS eventos, count(*) FILTER (WHERE status='finalizado')::int AS finalizados
      FROM evento GROUP BY tipo ORDER BY tipo`)).rows);
  console.table((await client.query(`SELECT war_id::int AS war_id, data::text AS data, tipo FROM wars ORDER BY data`)).rows);

  const noop = await client.query(`
    SELECT count(*)::int AS divergentes
      FROM papel_na_war v JOIN players p USING (nome_familia)
     WHERE v.grupo IS DISTINCT FROM p.grupo OR v.is_core IS DISTINCT FROM p.is_core`);
  console.log("prova de no-op (0 = nenhuma tela mudou de número):", noop.rows[0].divergentes);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
