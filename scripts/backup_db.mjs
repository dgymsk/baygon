import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * BACKUP COMPLETO DO BANCO, sem pg_dump: uma leitura de cada tabela pelo driver, um JSON por
 * tabela, o schema (colunas, tipos, identidades, chaves) e um manifesto com as contagens — tudo
 * numa pasta datada e empacotado em .tar.gz.
 *
 * Uso: node --env-file=.env.local scripts/backup_db.mjs [pasta-destino]
 *   padrão: backups/<AAAA-MM-DD_HHMM>/  (a pasta backups/ está no .gitignore)
 *
 * A contrapartida é scripts/restore_db.mjs, que lê esta mesma pasta de volta. Os dois foram feitos
 * juntos de propósito: backup que nunca foi restaurado é uma esperança, não um backup.
 *
 * O manifesto guarda o commit do git em que o backup foi feito: o schema de amanhã pode não ser o de
 * hoje, e restaurar JSON de ontem num banco de amanhã exige saber a distância entre os dois.
 */
const sql = neon(process.env.DATABASE_URL);
const agora = new Date();
const carimbo = agora.toISOString().slice(0, 16).replace("T", "_").replace(":", "");
const destino = process.argv[2] || path.join("backups", carimbo);
fs.mkdirSync(destino, { recursive: true });

const tabelas = (await sql`SELECT table_name FROM information_schema.tables
                           WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`).map((r) => r.table_name);

// --- schema: o suficiente pra restaurar do jeito certo (identidade e chave primária) ---
const colunas = await sql`
  SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, is_identity, ordinal_position
  FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`;
const chaves = await sql`
  SELECT tc.table_name, kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
  WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY' ORDER BY 1, kcu.ordinal_position`;
const views = await sql`SELECT table_name, view_definition FROM information_schema.views WHERE table_schema = 'public'`;
fs.writeFileSync(path.join(destino, "schema.json"), JSON.stringify({ colunas, chaves, views }, null, 1));

// --- dados: uma tabela por arquivo ---
const manifesto = { criado: agora.toISOString(), commit: null, tabelas: {} };
try { manifesto.commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch {}

let total = 0;
for (const t of tabelas) {
  // identificador entre aspas: nome de tabela nunca vem do usuário aqui, mas aspas são de graça
  const linhas = await sql.query(`SELECT * FROM "${t}"`);
  fs.writeFileSync(path.join(destino, `${t}.json`), JSON.stringify(linhas));
  manifesto.tabelas[t] = linhas.length;
  total += linhas.length;
  console.log(`${t.padEnd(28)} ${String(linhas.length).padStart(6)} linha(s)`);
}
fs.writeFileSync(path.join(destino, "manifest.json"), JSON.stringify(manifesto, null, 1));

// --- conferência: o que está no disco bate com o que o banco disse? ---
let ok = true;
for (const t of tabelas) {
  const n = JSON.parse(fs.readFileSync(path.join(destino, `${t}.json`), "utf8")).length;
  if (n !== manifesto.tabelas[t]) { ok = false; console.error(`DIVERGÊNCIA em ${t}: ${n} no disco, ${manifesto.tabelas[t]} no banco`); }
}

// --- empacota ---
const tar = `${destino.replace(/[\\/]+$/, "")}.tar.gz`;
try {
  execSync(`tar -czf "${tar}" -C "${path.dirname(destino)}" "${path.basename(destino)}"`, { stdio: "inherit" });
} catch (e) { console.warn("tar falhou (a pasta continua válida):", e.message); }

console.log(`\n${tabelas.length} tabelas, ${total} linhas, commit ${manifesto.commit ?? "?"}`);
console.log(`pasta:   ${destino}`);
if (fs.existsSync(tar)) console.log(`arquivo: ${tar} (${(fs.statSync(tar).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(ok ? "conferência: disco == banco ✓" : "conferência: HÁ DIVERGÊNCIA — não confie neste backup");
process.exit(ok ? 0 : 1);
