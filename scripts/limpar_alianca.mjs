import { neon } from "@neondatabase/serverless";

/**
 * LIMPA OS DADOS DA ALIANÇA — mantém a configuração do app.
 *
 * Uso:
 *   node --env-file=.env.local scripts/limpar_alianca.mjs             (ensaio: mostra e para)
 *   node --env-file=.env.local scripts/limpar_alianca.mjs --confirmo  (apaga de verdade)
 *
 * SÓ RODE DEPOIS DE UM BACKUP CONFERIDO (scripts/backup_db.mjs). Não há volta fora dele.
 *
 * A linha entre "dado" e "configuração" é: configuração é o que a staff montou UMA vez e vale pra
 * qualquer aliança (métricas, presets, funções, parties, canais, servidores, agenda, cron);
 * dado é o que as pessoas e as guerras produziram (cadastros, wars, estatísticas, eventos,
 * chamadas, DMs, logs). Uma exceção deliberada: `guild_meta` (a lista de guildas) FICA, porque
 * tem forma de config e páginas quebram sem ela — a lista nova se edita em /guildas.
 *
 * TRUNCATE ... CASCADE apagaria também qualquer tabela que aponte (FK) pra uma das apagadas. Por
 * isso o script CONFERE antes: se alguma tabela da lista de "fica" apontar pra uma da lista de
 * "sai", ele aborta em vez de levar a config junto em silêncio.
 */
const sql = neon(process.env.DATABASE_URL);
const confirmo = process.argv.includes("--confirmo");

const SAI = [
  // pessoas
  "players", "player_funcao", "garmoth_build", "garmoth_gear_hist",
  // guerras e estatística
  "wars", "desempenho", "war_player", "war_guilda", "benchmarks", "discrepancia",
  // eventos e escalação
  "evento", "evento_escalacao", "evento_party", "evento_presenca", "evento_provisorio", "evento_resultado",
  // chamadas do bot
  "intencao_post", "intencao_marca", "intencao_resp",
  // DMs, buzinador, logs
  "dm_lote", "dm_lote_alvo", "buzinador_envio", "buzinador_alvo", "interacao_log", "cron_exec",
  // enquetes
  "enquete", "enquete_opcao", "enquete_voto",
  // stack antiga (Apollo)
  "participacao_post", "participacao_resp", "participacao_membro", "participar_scan", "pt_scan", "remocao_scan",
];

const todas = (await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`).map((r) => r.table_name);
const desconhecidas = SAI.filter((t) => !todas.includes(t));
if (desconhecidas.length) { console.error("tabelas da lista que não existem:", desconhecidas.join(", ")); process.exit(2); }
const FICA = todas.filter((t) => !SAI.includes(t));

// --- guarda: nenhuma tabela que FICA pode apontar pra uma que SAI ---
const fks = await sql`
  SELECT tc.table_name AS de, ccu.table_name AS para
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
  WHERE tc.table_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY'`;
const perigosas = fks.filter((f) => FICA.includes(f.de) && SAI.includes(f.para));
if (perigosas.length) {
  console.error("ABORTADO: tabela que FICA aponta pra tabela que SAI (o CASCADE a levaria junto):");
  for (const f of perigosas) console.error(`  ${f.de} -> ${f.para}`);
  process.exit(2);
}

const contar = async (lista) => {
  const out = {};
  for (const t of lista) out[t] = (await sql.query(`SELECT count(*)::int AS n FROM "${t}"`))[0].n;
  return out;
};
const antesSai = await contar(SAI), antesFica = await contar(FICA);
console.log("SAI (apagadas):");
for (const t of SAI) console.log(`  ${t.padEnd(26)} ${String(antesSai[t]).padStart(6)}`);
console.log(`  total: ${Object.values(antesSai).reduce((a, b) => a + b, 0)} linhas em ${SAI.length} tabelas`);
console.log("\nFICA (configuração, intocada):");
for (const t of FICA) console.log(`  ${t.padEnd(26)} ${String(antesFica[t]).padStart(6)}`);

if (!confirmo) { console.log("\nENSAIO — nada foi apagado. Repita com --confirmo pra apagar de verdade."); process.exit(0); }

// --- de verdade ---
const lista = SAI.map((t) => `"${t}"`).join(", ");
console.log(`\nTRUNCATE ${SAI.length} tabelas RESTART IDENTITY CASCADE …`);
await sql.query(`TRUNCATE ${lista} RESTART IDENTITY CASCADE`);

const depoisSai = await contar(SAI), depoisFica = await contar(FICA);
let ok = true;
for (const t of SAI) if (depoisSai[t] !== 0) { ok = false; console.error(`  ${t} ainda tem ${depoisSai[t]} linha(s)`); }
for (const t of FICA) if (depoisFica[t] !== antesFica[t]) { ok = false; console.error(`  ${t} MUDOU: ${antesFica[t]} -> ${depoisFica[t]} (o CASCADE alcançou a config!)`); }
console.log(ok ? "\nlimpo: as tabelas que saem estão em 0 e as que ficam estão idênticas ✓" : "\nATENÇÃO: conferência falhou — veja acima e use o backup");
process.exit(ok ? 0 : 1);
