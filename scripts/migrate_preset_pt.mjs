// Corrige o desenho do preset. Estava invertido:
//
//   ERRADO (antes)                          CERTO (agora)
//   preset = conjunto de FUNÇÕES            preset = conjunto de PTs + máximo de gente na guerra
//   função escolhida por preset             função = ATRIBUTO DO JOGADOR, vale em todo preset
//   parties = lista global solta            parties = o que o preset associa
//
// O jogador pode ter VÁRIAS funções (o que ele sabe fazer); no bot ele marca UMA (o que vai
// fazer hoje). Os botões do bot passam a ser o catálogo INTEIRO de funções — o preset não os
// filtra mais.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_preset_pt.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;
const temTab = async (t) => (await client.query(`SELECT to_regclass($1) x`, [t])).rows[0].x != null;

try {
  await client.connect();

  // 1) preset ganha o teto de gente na guerra
  if (!(await temCol("intencao_preset", "tamanho_max"))) {
    await client.query(`ALTER TABLE intencao_preset ADD COLUMN tamanho_max INT`);
    console.log("intencao_preset.tamanho_max criado");
  }

  // 2) o vínculo do preset passa a ser com PARTY. As linhas antigas apontavam pra função e não
  //    têm tradução (party é outra entidade) — descarta, são 5 e a tela remonta em 1 minuto.
  if (await temCol("intencao_preset_pt", "funcao_id")) {
    const { rowCount } = await client.query(`DELETE FROM intencao_preset_pt`);
    console.log(`vínculos preset→função descartados: ${rowCount} (apontavam pra entidade errada)`);
    await client.query(`ALTER TABLE intencao_preset_pt DROP CONSTRAINT IF EXISTS intencao_preset_pt_funcao_id_fkey`);
    await client.query(`ALTER TABLE intencao_preset_pt RENAME COLUMN funcao_id TO party_id`);
    await client.query(`ALTER TABLE intencao_preset_pt ADD CONSTRAINT intencao_preset_pt_party_id_fkey
      FOREIGN KEY (party_id) REFERENCES party(id) ON DELETE CASCADE`);
    console.log("intencao_preset_pt agora aponta pra party");
  }

  // 3) função do jogador: global (sem tipo), várias por pessoa, independente de preset
  if (!(await temTab("player_funcao"))) {
    await client.query(`CREATE TABLE player_funcao (
      chave     TEXT NOT NULL,
      familia   TEXT NOT NULL,
      funcao_id BIGINT NOT NULL REFERENCES funcao(id) ON DELETE CASCADE,
      PRIMARY KEY (chave, funcao_id)
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS ix_player_funcao_funcao ON player_funcao (funcao_id)`);
    // traz o que existia no intencao_membro (era por tipo; aqui vira global, sem repetir)
    if (await temTab("intencao_membro")) {
      const { rowCount } = await client.query(`INSERT INTO player_funcao (chave, familia, funcao_id)
        SELECT DISTINCT ON (chave, funcao_id) chave, familia, funcao_id FROM intencao_membro
        ON CONFLICT DO NOTHING`);
      console.log(`player_funcao criada; ${rowCount} atribuição(ões) migradas do intencao_membro`);
    } else console.log("player_funcao criada");
  }
  await client.query(`DROP TABLE IF EXISTS intencao_membro`);

  const { rows: [r] } = await client.query(`SELECT
    (SELECT count(*)::int FROM funcao) funcoes,
    (SELECT count(*)::int FROM party) parties,
    (SELECT count(*)::int FROM intencao_preset) presets,
    (SELECT count(*)::int FROM intencao_preset_pt) vinculos_preset_party,
    (SELECT count(*)::int FROM player_funcao) funcoes_de_jogador,
    (SELECT count(*)::int FROM intencao_marca) marcas`);
  console.log("OK —", JSON.stringify(r));
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
