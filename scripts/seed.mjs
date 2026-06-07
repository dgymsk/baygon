// Semeia: players (roster completo) + 1 war (05/06/2026) + desempenho (28x15, normalizado).
// Uso: node --env-file=.env.local scripts/seed.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) {
  console.error("DATABASE_URL ausente. Rode com: node --env-file=.env.local scripts/seed.mjs");
  process.exit(1);
}

// ---------- CSV parser (campos com aspas) ----------
function parseCSV(text) {
  const rows = [];
  let cur = "", row = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* ignora */ }
      else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ""));
}

// ---------- normalizacao: 635.1k -> 635100, 6.7M -> 6700000, 09:56 -> 596s ----------
function norm(raw) {
  const s = (raw ?? "").toString().trim();
  if (s === "") return 0;
  if (/^\d{1,2}:\d{2}$/.test(s)) { const [m, sec] = s.split(":").map(Number); return m * 60 + sec; }
  const m = s.match(/^([\d.]+)\s*([kKmM])$/);
  if (m) {
    const mult = /[kK]/.test(m[2]) ? 1e3 : 1e6;
    return Math.round(parseFloat(m[1]) * mult);
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// ---------- roster (players) — arquivo slim sem PII: nome_familia,grupo,classe ----------
const rosterRows = parseCSV(fs.readFileSync(path.join(root, "roster_grupos.csv"), "utf8"));
const players = new Map(); // nome_familia -> {grupo, classe}
const byLower = new Map(); // lower(nome) -> nome_familia canonico
for (const c of rosterRows.slice(1)) { // pula header
  const fam = (c[0] || "").trim();
  if (!fam) continue;
  const grupo = (c[1] || "").trim() || "Indefinido";
  const classe = (c[2] || "").trim() || null;
  players.set(fam, { grupo, classe });
  byLower.set(fam.toLowerCase(), fam);
}

// ---------- war 05/06 (desempenho) ----------
const warText = fs.readFileSync(path.join(root, "war_2026-06-05_completa.csv"), "utf8");
const warRows = warText.split(/\r?\n/).filter(Boolean).map((l) => l.split(","));
const header = warRows[0];
const metricKeys = header.slice(1); // 15 chaves de metrica (batem com a tabela metricas)
const warData = warRows.slice(1);

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query("BEGIN");

  // players (upsert)
  const pVals = [], pParams = [];
  let pi = 1;
  for (const [fam, { grupo, classe }] of players) {
    pVals.push(`($${pi++}, $${pi++}, FALSE, $${pi++}, TRUE)`);
    pParams.push(fam, grupo, classe);
  }
  await client.query(
    `INSERT INTO players (nome_familia, grupo, is_core, classe_bdo, ativo) VALUES ${pVals.join(",")}
     ON CONFLICT (nome_familia) DO UPDATE SET grupo=EXCLUDED.grupo, classe_bdo=EXCLUDED.classe_bdo`,
    pParams
  );

  // war
  const { rows: warIns } = await client.query(
    `INSERT INTO wars (data, territorio, resultado, tier) VALUES ($1,$2,$3,$4) RETURNING war_id`,
    ["2026-06-05", null, "DERROTA", null]
  );
  const warId = warIns[0].war_id;

  // desempenho (28 x 15)
  const dVals = [], dParams = [];
  let di = 1, nDesemp = 0, missing = [];
  for (const r of warData) {
    const rawName = (r[0] || "").trim();
    const canon = byLower.get(rawName.toLowerCase());
    if (!canon) { missing.push(rawName); continue; }
    for (let k = 0; k < metricKeys.length; k++) {
      const metrica = metricKeys[k].trim();
      const valor = norm(r[k + 1]);
      dVals.push(`($${di++}, $${di++}, $${di++}, $${di++})`);
      dParams.push(warId, canon, metrica, valor);
      nDesemp++;
    }
  }
  await client.query(
    `INSERT INTO desempenho (war_id, nome_familia, metrica, valor) VALUES ${dVals.join(",")}
     ON CONFLICT (war_id, nome_familia, metrica) DO UPDATE SET valor=EXCLUDED.valor`,
    dParams
  );

  await client.query("COMMIT");

  if (missing.length) console.log("AVISO players da war ausentes no roster:", missing.join(", "));

  // verificacao
  const q = async (s) => (await client.query(s)).rows[0].n;
  console.log("players:        ", await q("SELECT count(*)::int n FROM players"));
  console.log("wars:           ", await q("SELECT count(*)::int n FROM wars"));
  console.log("desempenho:     ", await q("SELECT count(*)::int n FROM desempenho"));
  console.log("players na war: ", await q(`SELECT count(DISTINCT nome_familia)::int n FROM desempenho WHERE war_id=${warId}`));
  const sample = await client.query(
    `SELECT nome_familia, metrica, valor FROM desempenho
     WHERE war_id=${warId} AND nome_familia='Tripaloska' AND metrica IN ('dano_do_pino','tempo_morto','kills')
     ORDER BY metrica`
  );
  console.log("amostra Tripaloska:", JSON.stringify(sample.rows));
  console.log("OK seed (war_id=" + warId + ")");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("ERRO seed:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
