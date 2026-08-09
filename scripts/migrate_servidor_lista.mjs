// Servidor da guerra vira ESCOLHA numa lista, não texto livre — e passa a ser mais de um.
//
// Três mudanças sobre migrate_servidor_guerra.mjs:
//
// 1. CATÁLOGO `servidor_bdo`. O seletor precisa de uma lista, e a lista muda (a Pearl Abyss abre e
//    fecha servidor). Tabela editável em /hub/config, não constante no código: o dia em que mudar,
//    quem conserta é a staff, não um deploy. `ordem` guarda a ordem da tela do jogo, que é como a
//    staff lê — alfabética embaralharia Arsha e Odyllita no meio do resto.
//
// 2. TEXT -> TEXT[] em `servidor_guerra` e `evento`. Node war acontece em DOIS servidores; siege e
//    rosas em um. Guardar "Ulukita1 / Calpheon1" numa string funcionava pra imprimir e não pra
//    escolher: um <select> precisa comparar valor por valor, e dividir por " / " na leitura é um
//    parser esperando um nome com barra pra quebrar. O array já é a forma certa.
//
// 3. Backfill dos padrões semeados: a string vira array quebrando no "/", e cada pedaço é casado
//    (sem espaços, sem caixa) contra o catálogo — "Ulukita 1" vira "Ulukita1". Nome que não casar
//    é DESCARTADO com aviso no console em vez de virar item fantasma no seletor.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_servidor_lista.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const tipoCol = async (t, c) => (await client.query(
  `SELECT data_type FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rows[0]?.data_type ?? null;

// a lista da tela do jogo, na ordem em que aparece nela
const CATALOGO = [
  "Odyllita1", "Calpheon1", "Calpheon2", "Mediah1", "Mediah2", "Balenos1", "Balenos2",
  "Serendia1", "Serendia2", "Arsha: Anonymous", "Arsha", "Ulukita1", "Valencia1", "Edania1",
];

try {
  await client.connect();

  // --- 1) catálogo ---
  await client.query(`
    CREATE TABLE IF NOT EXISTS servidor_bdo (
      nome  TEXT PRIMARY KEY,
      ordem INTEGER NOT NULL DEFAULT 0
    )`);
  for (let i = 0; i < CATALOGO.length; i++) {
    await client.query(
      `INSERT INTO servidor_bdo (nome, ordem) VALUES ($1,$2) ON CONFLICT (nome) DO NOTHING`,
      [CATALOGO[i], i]);
  }
  const cat = (await client.query(`SELECT nome, ordem FROM servidor_bdo ORDER BY ordem, nome`)).rows;
  console.log(`catálogo com ${cat.length} servidores:`, cat.map((r) => r.nome).join(", "));

  // casa "Ulukita 1" / "ulukita1" com o nome canônico do catálogo
  const chave = (s) => s.toLowerCase().replace(/\s+/g, "");
  const porChave = new Map(cat.map((r) => [chave(r.nome), r.nome]));
  const paraArray = (txt, ondeErro) => {
    if (!txt) return [];
    const out = [];
    for (const p of String(txt).split("/").map((x) => x.trim()).filter(Boolean)) {
      const c = porChave.get(chave(p));
      if (c) out.push(c);
      else console.warn(`  ⚠ "${p}" (${ondeErro}) não está no catálogo — descartado`);
    }
    return [...new Set(out)];
  };

  // --- 2) servidor_guerra.servidor TEXT -> servidores TEXT[] ---
  if (await tipoCol("servidor_guerra", "servidores")) console.log("servidor_guerra.servidores já existe");
  else {
    await client.query(`ALTER TABLE servidor_guerra ADD COLUMN servidores TEXT[] NOT NULL DEFAULT '{}'`);
    const antigos = (await client.query(`SELECT tipo, tier, servidor FROM servidor_guerra`)).rows;
    for (const a of antigos) {
      const arr = paraArray(a.servidor, `padrão ${a.tipo} ${a.tier || "sem tier"}`);
      await client.query(`UPDATE servidor_guerra SET servidores = $1 WHERE tipo = $2 AND tier = $3`, [arr, a.tipo, a.tier]);
      console.log(`padrão ${a.tipo}${a.tier ? " " + a.tier : ""}: "${a.servidor}" -> {${arr.join(", ")}}`);
    }
    // a coluna velha some: manter as duas garante que uma delas fica desatualizada em silêncio
    await client.query(`ALTER TABLE servidor_guerra DROP COLUMN servidor`);
    console.log("servidor_guerra.servidor (TEXT) removida");
  }

  // --- 3) evento.servidor TEXT -> servidores TEXT[] ---
  if (await tipoCol("evento", "servidores")) console.log("evento.servidores já existe");
  else {
    await client.query(`ALTER TABLE evento ADD COLUMN servidores TEXT[] NOT NULL DEFAULT '{}'`);
    const evs = (await client.query(`SELECT id, titulo, tipo, servidor FROM evento WHERE servidor IS NOT NULL`)).rows;
    for (const e of evs) {
      const arr = paraArray(e.servidor, `evento ${e.id}`);
      await client.query(`UPDATE evento SET servidores = $1 WHERE id = $2`, [arr, e.id]);
      console.log(`evento ${e.id} (${e.titulo ?? e.tipo}): "${e.servidor}" -> {${arr.join(", ")}}`);
    }
    await client.query(`ALTER TABLE evento DROP COLUMN servidor`);
    console.log("evento.servidor (TEXT) removida");
  }

  console.table((await client.query(
    `SELECT tipo, COALESCE(NULLIF(tier,''),'(qualquer)') AS tier, servidores FROM servidor_guerra ORDER BY tipo, tier`)).rows);
  console.table((await client.query(`
    SELECT e.id, COALESCE(e.titulo,e.tipo) AS evento, e.tipo, COALESCE(e.tier,'') AS tier,
           e.servidores AS override,
           COALESCE(NULLIF(e.servidores,'{}'),
             (SELECT s.servidores FROM servidor_guerra s WHERE s.tipo = e.tipo AND s.tier = COALESCE(e.tier,'')),
             (SELECT s.servidores FROM servidor_guerra s WHERE s.tipo = e.tipo AND s.tier = ''),
             '{}') AS efetivo
      FROM evento e ORDER BY e.data, e.id`)).rows);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
