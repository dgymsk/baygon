// Tier da guerra (T1/T2/T3) como campo de verdade, no evento e no preset.
//
// Até aqui o tier só existia embutido no NOME do preset ("NODEWAR T2") — texto livre, impossível de
// filtrar ou comparar. Agora é coluna: o preset carrega o tier padrão da chamada e o evento carrega
// o tier daquela guerra específica, herdado do preset no disparo e trocável depois (o nó que caiu
// nem sempre é o que estava marcado).
//
// NÃO reaproveita `evento.tipo`, que já significa outra coisa (nodewar | siege) e é lido em várias
// telas. `wars.tier` já existia como INTEGER, do modelo antigo — fica como está; aqui é TEXT porque
// "T1" é como a guilda fala, e o CHECK impede qualquer outro valor.
//
// Backfill: quem tem "T1"/"T2"/"T3" no nome do preset herda esse tier. O resto fica NULL (= não
// informado), que é honesto — melhor NULL que chutar T1.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_tier.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();

  for (const tabela of ["evento", "intencao_preset"]) {
    if (!(await temCol(tabela, "tier"))) {
      await client.query(`ALTER TABLE ${tabela} ADD COLUMN tier TEXT`);
      console.log(`${tabela}.tier criado`);
    }
    // CHECK separado do ADD COLUMN pra ser idempotente: rodar de novo não duplica a constraint
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE ${tabela} ADD CONSTRAINT ck_${tabela}_tier CHECK (tier IS NULL OR tier IN ('T1','T2','T3'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  }

  // o tier que hoje está preso no nome da chamada passa a existir como dado
  const { rowCount: herdou } = await client.query(`
    UPDATE intencao_preset SET tier = m[1]
    FROM (SELECT id, regexp_match(upper(nome), '\\m(T[123])\\M') m FROM intencao_preset) s
    WHERE s.id = intencao_preset.id AND s.m IS NOT NULL AND intencao_preset.tier IS NULL`);
  if (herdou) console.log(`${herdou} preset(s) herdaram o tier do próprio nome`);

  // evento já existente pega o tier do preset que o rege — pelo preset_id próprio OU pelo post da
  // chamada, porque até agora o disparo só gravava o preset no post, nunca no evento
  const { rowCount: eventos } = await client.query(`
    UPDATE evento e SET tier = p.tier
    FROM intencao_preset p
    WHERE p.tier IS NOT NULL AND e.tier IS NULL
      AND p.id = COALESCE(e.preset_id, (SELECT ip.preset_id FROM intencao_post ip
                                        WHERE ip.evento_id = e.id ORDER BY ip.criado DESC LIMIT 1))`);
  if (eventos) console.log(`${eventos} evento(s) herdaram o tier do preset`);

  // de quebra, o evento passa a carregar o próprio preset (antes só o post sabia)
  const { rowCount: presets } = await client.query(`
    UPDATE evento e SET preset_id = ip.preset_id
    FROM intencao_post ip
    WHERE ip.evento_id = e.id AND ip.preset_id IS NOT NULL AND e.preset_id IS NULL`);
  if (presets) console.log(`${presets} evento(s) passaram a carregar o próprio preset`);

  await client.query(`CREATE INDEX IF NOT EXISTS ix_evento_tier ON evento (tier) WHERE tier IS NOT NULL`);

  const { rows: [r] } = await client.query(`SELECT
    (SELECT count(*)::int FROM intencao_preset) presets,
    (SELECT count(*)::int FROM intencao_preset WHERE tier IS NOT NULL) presets_com_tier,
    (SELECT count(*)::int FROM evento) eventos,
    (SELECT count(*)::int FROM evento WHERE tier IS NOT NULL) eventos_com_tier`);
  console.log("OK —", JSON.stringify(r));
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
