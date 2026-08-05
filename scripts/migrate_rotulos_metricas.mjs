// Alinha os rótulos de `metricas` ao vocabulário da guilda (e ao catálogo de lib/metricasResultado.ts).
//
// A chave (`metrica`) NÃO muda — é o que está gravado em `desempenho` e referenciado por
// `grupos_metricas`. Só o texto que aparece na tela muda, pra tabela de revisão e o painel falarem
// a mesma língua da tela do jogo: "Multi Abate", não "Sequência"; "Acionamento de Trap", não
// "Armadilhas"; "Dano Causado", não "Dano PvP".
//
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_rotulos_metricas.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

// mesma ordem e mesmos rótulos de lib/metricasResultado.ts — se divergir, a tela mostra dois nomes
const ROTULOS = [
  ["kills", "Kills"],
  ["mortes", "Mortes"],
  ["sequencia", "Multi Abate"],
  ["dano_em_player", "Dano Causado"],
  ["dano_recebido", "Dano Recebido"],
  ["ccs", "CCs"],
  ["cura_propria", "Cura Própria"],
  ["cura_aliados", "Cura Aliados"],
  ["dano_do_pino", "Dano ao Pino"],
  ["acerto_canhao", "Acerto Canhão"],
  ["estruturas_canhao", "Estruturas"],
  ["distancia_canhao", "Dist. Canhão"],
  ["armadilha_disparos", "Trap"],
  ["tempo_morto", "Tempo Morto"],
  ["tempo_sobrevivencia", "Tempo Vivo"],
];

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();

  let mudou = 0;
  for (const [metrica, rotulo] of ROTULOS) {
    const { rowCount } = await client.query(
      `UPDATE metricas SET rotulo = $2 WHERE metrica = $1 AND rotulo IS DISTINCT FROM $2`, [metrica, rotulo]);
    if (rowCount) { console.log(`${metrica}: rótulo → "${rotulo}"`); mudou += rowCount; }
  }
  console.log(mudou ? `${mudou} rótulo(s) atualizados` : "nada a mudar");

  // aviso, não correção: chave no catálogo do código que não existe no banco quebraria o score
  const { rows: faltando } = await client.query(
    `SELECT k FROM unnest($1::text[]) k WHERE k NOT IN (SELECT metrica FROM metricas)`, [ROTULOS.map((r) => r[0])]);
  if (faltando.length) console.warn("⚠ métricas do código ausentes no banco:", faltando.map((r) => r.k).join(", "));

  const { rows: sobrando } = await client.query(
    `SELECT metrica FROM metricas WHERE metrica <> ALL($1::text[])`, [ROTULOS.map((r) => r[0])]);
  if (sobrando.length) console.warn("⚠ métricas no banco fora do catálogo:", sobrando.map((r) => r.metrica).join(", "));

  const { rows } = await client.query(`SELECT metrica, rotulo, direcao, universal FROM metricas ORDER BY metrica`);
  console.table(rows);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
