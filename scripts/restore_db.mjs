import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
import path from "node:path";

/**
 * RESTAURA um backup feito por scripts/backup_db.mjs — a pasta com um JSON por tabela.
 *
 * Uso:
 *   node --env-file=.env.local scripts/restore_db.mjs backups/2026-09-10_1530            (ensaio)
 *   node --env-file=.env.local scripts/restore_db.mjs backups/2026-09-10_1530 --confirmo (de verdade)
 *   ... [--so tabela1,tabela2]   restaura só essas
 *
 * O ensaio é o padrão: lê a pasta, confere com o manifesto, mostra o que faria e para. Só com
 * --confirmo ele TRUNCA as tabelas escolhidas (CASCADE, porque há chaves estrangeiras entre elas) e
 * reinsere as linhas. Isso apaga o que estiver no banco naquelas tabelas — é a função dele.
 *
 * Colunas de identidade (GENERATED ALWAYS) entram com OVERRIDING SYSTEM VALUE, senão o banco
 * recusaria o id vindo do backup; depois o contador de cada uma é reposicionado no maior id, senão
 * a próxima inserção de verdade colidiria com uma linha restaurada.
 *
 * Lotes de 500 linhas: uma linha por INSERT seria lento demais pra 33 mil de desempenho, e tudo de
 * uma vez estoura o tamanho da requisição do driver HTTP.
 */
const sql = neon(process.env.DATABASE_URL);
const args = process.argv.slice(2);
const pasta = args.find((a) => !a.startsWith("--"));
const confirmo = args.includes("--confirmo");
const soIdx = args.indexOf("--so");
const so = soIdx >= 0 ? (args[soIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : null;
if (!pasta || !fs.existsSync(path.join(pasta, "manifest.json"))) {
  console.error("uso: restore_db.mjs <pasta-do-backup> [--confirmo] [--so t1,t2]"); process.exit(2);
}

const manifesto = JSON.parse(fs.readFileSync(path.join(pasta, "manifest.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(pasta, "schema.json"), "utf8"));
const tabelas = Object.keys(manifesto.tabelas).filter((t) => !so || so.includes(t));
if (so) for (const t of so) if (!manifesto.tabelas[t] && manifesto.tabelas[t] !== 0) { console.error(`tabela "${t}" não está no backup`); process.exit(2); }

// colunas por tabela, na ordem, e quais são identidade
const cols = {};
for (const c of schema.colunas) (cols[c.table_name] ??= []).push(c);
const identidade = (t) => (cols[t] ?? []).filter((c) => c.is_identity === "YES").map((c) => c.column_name);

console.log(`backup de ${manifesto.criado} (commit ${manifesto.commit ?? "?"}) — ${tabelas.length} tabela(s)${so ? " (filtradas)" : ""}`);
let total = 0;
const dados = {};
for (const t of tabelas) {
  const linhas = JSON.parse(fs.readFileSync(path.join(pasta, `${t}.json`), "utf8"));
  if (linhas.length !== manifesto.tabelas[t]) { console.error(`${t}: ${linhas.length} no arquivo, ${manifesto.tabelas[t]} no manifesto — backup corrompido`); process.exit(1); }
  dados[t] = linhas; total += linhas.length;
  const ident = identidade(t);
  console.log(`  ${t.padEnd(28)} ${String(linhas.length).padStart(6)} linha(s)${ident.length ? `  identidade: ${ident.join(",")}` : ""}`);
}
console.log(`total: ${total} linhas`);

if (!confirmo) { console.log("\nENSAIO — nada foi tocado. Repita com --confirmo pra restaurar de verdade."); process.exit(0); }

// --- de verdade ---
const lista = tabelas.map((t) => `"${t}"`).join(", ");
console.log(`\nTRUNCATE ${lista} CASCADE`);
await sql.query(`TRUNCATE ${lista} CASCADE`);

for (const t of tabelas) {
  const linhas = dados[t];
  if (!linhas.length) continue;
  const nomes = (cols[t] ?? []).map((c) => c.column_name).filter((c) => c in linhas[0]);
  const over = identidade(t).length ? " OVERRIDING SYSTEM VALUE" : "";
  const LOTE = 500;
  for (let i = 0; i < linhas.length; i += LOTE) {
    const fatia = linhas.slice(i, i + LOTE);
    const params = [];
    const tuplas = fatia.map((l) => "(" + nomes.map((c) => {
      const v = l[c];
      // objeto/array (jsonb, int[]) vai como texto e o Postgres converte pelo tipo da coluna
      params.push(v != null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v);
      return `$${params.length}`;
    }).join(",") + ")");
    await sql.query(`INSERT INTO "${t}" (${nomes.map((c) => `"${c}"`).join(",")})${over} VALUES ${tuplas.join(",")}`, params);
  }
  for (const c of identidade(t)) {
    await sql.query(`SELECT setval(pg_get_serial_sequence('"${t}"', '${c}'), COALESCE((SELECT max("${c}") FROM "${t}"), 0) + 1, false)`);
  }
  const n = (await sql.query(`SELECT count(*)::int AS n FROM "${t}"`))[0].n;
  console.log(`  ${t.padEnd(28)} ${String(n).padStart(6)} restaurada(s)${n !== linhas.length ? "  <-- DIVERGE do backup!" : ""}`);
}
console.log("\nrestauração concluída");
