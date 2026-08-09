// Em QUAL SERVIDOR a guerra acontece. Ex.: Nodewar T2 -> Ulukita 1 / Calpheon 1.
//
// Vira duas coisas, porque são duas perguntas diferentes:
//
// 1. `servidor_guerra (tipo, tier) -> servidor` — o PADRÃO, que quase nunca muda. É configuração da
//    aliança: T2 é sempre num par de servidores, rosas é sempre em outro. Fica numa tabela e não
//    numa coluna do preset porque a chave é (tipo, tier), e o mesmo par vale pra qualquer chamada
//    daquele porte — inclusive as criadas à mão, que não têm preset.
//
// 2. `evento.servidor` — o OVERRIDE daquela guerra. NULL = usa o padrão. Mesmo contrato de
//    players.grupo_siege: quem não preenche nada nunca precisa manter nada, e corrigir o padrão
//    conserta todo evento que não tinha opinião própria.
//
// A resolução é (nesta ordem): evento.servidor -> padrão de (tipo, tier exato) -> padrão de (tipo,
// sem tier). O terceiro degrau existe pra rosas e siege, que não têm tier: eles gravam com tier ''
// e valem pra qualquer coisa daquele tipo. '' e não NULL porque a coluna é parte da PK, e NULL em
// PK não é comparável — dois padrões "sem tier" do mesmo tipo poderiam coexistir sem o banco reclamar.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_servidor_guerra.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();

  if (await temCol("evento", "servidor")) console.log("evento.servidor já existe");
  else {
    await client.query(`ALTER TABLE evento ADD COLUMN servidor TEXT`);
    console.log("evento.servidor criado");
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS servidor_guerra (
      tipo       TEXT NOT NULL,
      tier       TEXT NOT NULL DEFAULT '',   -- '' = vale pra qualquer tier daquele tipo
      servidor   TEXT NOT NULL,
      atualizado TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tipo, tier)
    )`);
  console.log("tabela servidor_guerra pronta");

  // Semente com o que a staff já usa. DO NOTHING: rodar de novo não desfaz edição feita na tela.
  const seed = [
    ["nodewar", "T2", "Ulukita 1 / Calpheon 1"],
    ["nodewar", "T3", "Valencia 1 / Edania 1"],
    ["rosas", "", "Odyllita 1"],
  ];
  for (const [tipo, tier, servidor] of seed) {
    const r = await client.query(
      `INSERT INTO servidor_guerra (tipo, tier, servidor) VALUES ($1,$2,$3)
       ON CONFLICT (tipo, tier) DO NOTHING`, [tipo, tier, servidor]);
    if (r.rowCount) console.log(`padrão ${tipo}${tier ? " " + tier : ""} -> ${servidor}`);
  }

  console.table((await client.query(
    `SELECT tipo, COALESCE(NULLIF(tier,''),'(qualquer)') AS tier, servidor FROM servidor_guerra ORDER BY tipo, tier`)).rows);

  // como fica cada evento hoje, já com a resolução em três degraus
  console.table((await client.query(`
    SELECT e.id, COALESCE(e.titulo, e.tipo) AS evento, e.tipo, COALESCE(e.tier,'') AS tier,
           e.servidor AS override,
           COALESCE(e.servidor,
             (SELECT s.servidor FROM servidor_guerra s WHERE s.tipo = e.tipo AND s.tier = COALESCE(e.tier,'')),
             (SELECT s.servidor FROM servidor_guerra s WHERE s.tipo = e.tipo AND s.tier = '')
           ) AS servidor_efetivo
      FROM evento e ORDER BY e.data, e.id`)).rows);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
