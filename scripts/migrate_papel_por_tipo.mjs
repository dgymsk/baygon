// Função e régua separadas por TIPO DE GUERRA: o mesmo jogador pode ser Flanco na node war e Shai
// na siege, e a régua (benchmark) de cada guerra tem que usar o papel daquele tipo.
//
// O PROBLEMA. `players.grupo` e `players.is_core` são valor ÚNICO, e a régua de QUALQUER war sai
// desse cadastro AO VIVO (lib/score.ts, lib/evolucao.ts e lib/stats.ts fazem `JOIN players`). Não
// existe nenhum caminho de `desempenho` até `evento.tipo`. A siege de 08/08 (war 48, 99 jogadores)
// foi medida inteira com a função de node war de todo mundo: quem troca de papel é comparado com o
// grupo errado E arrasta a média dos dois grupos junto.
//
// POR QUE COLUNA ADITIVA e não uma tabela `player_papel(nome, tipo, grupo, is_core)`: a tabela é o
// desenho mais "certo" na ontologia, mas obrigaria a reescrever /config, /membros, os consumidores
// do score e os dois carimbos no MESMO commit. Coluna nullable deixa o caminho de node war
// idêntico ao de hoje, bit a bit, e o de siege cair no mesmo valor enquanto ninguém preencher nada
// — o deploy é um no-op verificável (ver a query de prova no fim deste arquivo).
//
// NULL = "HERDA DO NODE WAR", não "sem função":
//   grupo_siege   IS NULL -> usa grupo
//   is_core_siege IS NULL -> usa is_core
// FALSE em is_core_siege é DIFERENTE de NULL: quer dizer "é core no nó, NÃO é régua na siege". Por
// isso as colunas são nullable e o backfill NÃO preenche nada. Espelhar o valor de hoje pareceria
// mais simples e criaria 220 cópias que apodrecem: mudar o grupo de NW deixaria o de siege
// desatualizado em silêncio, e os 127 `Indefinido` de hoje ficariam Indefinido na siege pra sempre
// (= invisíveis no painel, porque Indefinido não tem linha em grupos_metricas).
//
// grupos_metricas NÃO ganha dimensão de tipo. O catálogo de grupos é UM só: "Shai" é avaliado pelas
// mesmas métricas nos dois. Quem quiser métrica diferente cria um grupo novo em /config (ex.
// "Aríete") e usa só na coluna de siege — custa zero schema. Consequência boa: o `DELETE FROM
// grupos_metricas` global de lib/config.ts continua inofensivo.
//
// wars.tipo é DENORMALIZADO e NULLABLE. Não é derivado por JOIN porque (a) evento_resultado.war_id
// NÃO é único — o índice é CREATE INDEX, não UNIQUE, e lib/eventos.ts conta com isso — então um
// JOIN duplicaria linha de `desempenho` dentro do AVG e enviesaria a régua; (b) war sem evento (a
// 41 é órfã) não teria tipo nenhum. NULL = "não sei", auditável pra sempre; um DEFAULT 'nodewar'
// seria um chute que nenhuma query consegue distinguir de um fato. O CASE da view trata NULL como
// node war, que é exatamente o comportamento de hoje.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_papel_por_tipo.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;
const addCol = async (t, c, tipo) => {
  if (await temCol(t, c)) { console.log(`${t}.${c} já existe`); return; }
  await client.query(`ALTER TABLE ${t} ADD COLUMN ${c} ${tipo}`);
  console.log(`${t}.${c} criado`);
};

try {
  await client.connect();

  // --- 1) colunas novas (todas NULL: herda / não informado) ---
  await addCol("players", "grupo_siege", "TEXT");      // função na siege; NULL = usa grupo
  await addCol("players", "is_core_siege", "BOOLEAN"); // régua da siege; NULL = usa is_core
  await addCol("wars", "tipo", "TEXT");                // 'nodewar' | 'siege'; NULL = war sem evento

  // CHECK separado do ADD COLUMN: o Postgres não tem ADD CONSTRAINT IF NOT EXISTS
  await client.query(`
    DO $$ BEGIN
      ALTER TABLE wars ADD CONSTRAINT ck_wars_tipo
        CHECK (tipo IS NULL OR tipo IN ('nodewar','siege'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_wars_tipo ON wars (tipo, data)`);

  // --- 2) backfill do tipo, a partir do evento ligado ---
  // DISTINCT ON porque evento_resultado.war_id não é único; desempate explícito pelo MENOR
  // evento_id (o primeiro que reivindicou a war). O `AND w.tipo IS NULL` faz rodar de novo NÃO
  // desfazer uma correção feita à mão.
  const bf = await client.query(`
    UPDATE wars w SET tipo = t.tipo
    FROM (SELECT DISTINCT ON (r.war_id) r.war_id, e.tipo
            FROM evento_resultado r JOIN evento e ON e.id = r.evento_id
           WHERE r.war_id IS NOT NULL
           ORDER BY r.war_id, r.evento_id) t
    WHERE t.war_id = w.war_id AND w.tipo IS NULL`);
  console.log(`${bf.rowCount} war(s) receberam o tipo do evento`);

  // --- 3) a VIEW: o único lugar do sistema que sabe "siege herda do nó quando não informado".
  // Os nomes das colunas são os MESMOS de players (grupo, is_core) de propósito: quem consome só
  // troca `JOIN players p` por `JOIN papel_na_war p ON p.war_id = ... AND p.nome_familia = ...` e o
  // resto da query fica intacto. tipo NULL não casa 'siege' -> cai no papel de node war.
  // O CROSS JOIN é seguro AQUI porque todo uso filtra por war_id e o planner inlineia a view e
  // empurra o predicado; um `SELECT * FROM papel_na_war` sem filtro materializa wars × players.
  await client.query(`
    CREATE OR REPLACE VIEW papel_na_war AS
    SELECT w.war_id, w.tipo, p.nome_familia,
           COALESCE(CASE WHEN w.tipo = 'siege' THEN p.grupo_siege   END, p.grupo)   AS grupo,
           COALESCE(CASE WHEN w.tipo = 'siege' THEN p.is_core_siege END, p.is_core) AS is_core
    FROM wars w CROSS JOIN players p`);
  console.log("view papel_na_war criada/atualizada");

  // --- 4) DETECTA, não força ---
  const semTipo = await client.query(`
    SELECT w.war_id, w.data::text AS data,
           (SELECT count(DISTINCT d.nome_familia)::int FROM desempenho d WHERE d.war_id = w.war_id) AS players
      FROM wars w WHERE w.tipo IS NULL ORDER BY w.data`);
  if (semTipo.rowCount) {
    console.warn("⚠ war(s) SEM evento ligado -> tipo NULL (indeterminável), tratadas como node war");
    console.warn("  no cálculo. Se souber o que foi: UPDATE wars SET tipo='siege' WHERE war_id=N;");
    console.table(semTipo.rows);
  }

  const wars = await client.query(`SELECT war_id::int AS war_id, data::text AS data, tipo FROM wars ORDER BY data`);
  console.table(wars.rows);

  // --- 5) PROVA DE NO-OP: enquanto ninguém preencher papel de siege, a view devolve exatamente o
  // cadastro de hoje pra TODA war. Se isto não for 0, nenhuma tela pode mudar de número. ---
  const noop = await client.query(`
    SELECT count(*)::int AS divergentes
      FROM papel_na_war v JOIN players p USING (nome_familia)
     WHERE v.grupo IS DISTINCT FROM p.grupo OR v.is_core IS DISTINCT FROM p.is_core`);
  console.log("prova de no-op (tem que ser 0):", noop.rows[0].divergentes);

  const cfg = await client.query(`
    SELECT count(grupo_siege)::int AS com_grupo_siege, count(is_core_siege)::int AS com_core_siege,
           count(*) FILTER (WHERE is_core_siege IS FALSE)::int AS core_siege_explicitamente_falso
      FROM players`);
  console.log("papéis de siege configurados:", cfg.rows[0]);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
