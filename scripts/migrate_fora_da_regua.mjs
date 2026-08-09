// "Fora da régua": o jogador CONTA na guerra, mas não entra nas MÉDIAS daquela war.
//
// Nasce de uma ordem tática: às vezes a staff manda alguém morrer de propósito (segurar, puxar,
// resetar). Os números dele viram lixo estatístico — tempo morto altíssimo, dano baixo — e a média
// do core arrasta junto, punindo todo o grupo por uma decisão que foi da chamada, não do jogador.
//
// A flag mora em `war_player` porque é uma propriedade DAQUELA war: o mesmo jogador pode ser régua
// numa guerra e exceção na seguinte. E `war_player` já cobre 100% de quem tem dano gravado, então
// não abre buraco.
//
// O dado NÃO é apagado: a linha continua na tabela, no ranking e no histórico. O que muda é só a
// participação dele no cálculo da média — e a tela diz quem está de fora, pra ninguém achar que o
// número sumiu sozinho.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_fora_da_regua.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();
  if (await temCol("war_player", "fora_da_regua")) console.log("war_player.fora_da_regua já existe");
  else {
    await client.query(`ALTER TABLE war_player ADD COLUMN fora_da_regua BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE war_player ADD COLUMN fora_motivo TEXT`);
    console.log("war_player.fora_da_regua + fora_motivo criados");
  }
  const r = await client.query(`SELECT count(*)::int AS linhas, count(*) FILTER (WHERE fora_da_regua)::int AS fora FROM war_player`);
  console.log("ok:", r.rows[0]);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
