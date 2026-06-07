// Semeia o historico de NODE WAR a partir de base_kda_N.csv (30 wars).
// Uso: node --env-file=.env.local scripts/seed_history.mjs
// Idempotente: apaga as wars dessas datas antes de reinserir.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

// ordem das 15 metricas (igual ao header da war CSV e a tabela metricas)
const METRIC_KEYS = [
  "kills", "mortes", "sequencia", "dano_em_player", "dano_recebido", "ccs",
  "cura_propria", "cura_aliados", "dano_do_pino", "acerto_canhao", "estruturas_canhao",
  "distancia_canhao", "armadilha_disparos", "tempo_morto", "tempo_sobrevivencia",
];

function parseCSV(text) {
  const rows = []; let cur = "", row = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c === "\r") { /* skip */ }
    else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ""));
}

// normalizacao robusta: "152,700"->152700 | "4,300,000"->4300000 | "6.7M"->6700000
// "635.1k"->635100 | "09:56"->596 | "01:43:29"->6209 | "" -> 0
function norm(raw) {
  let s = (raw ?? "").toString().trim();
  if (s === "" || s === "-") return 0;
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) { const [h, m, sec] = s.split(":").map(Number); return h * 3600 + m * 60 + sec; }
  if (/^\d{1,2}:\d{2}$/.test(s)) { const [m, sec] = s.split(":").map(Number); return m * 60 + sec; }
  const suf = s.match(/^([\d.,]+)\s*([kKmM])$/);
  if (suf) { const num = parseFloat(suf[1].replace(/,/g, "")); return Math.round(num * (/[kK]/.test(suf[2]) ? 1e3 : 1e6)); }
  s = s.replace(/,/g, ""); // virgula = separador de milhar
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const toISO = (br) => { const [d, m, y] = br.split("/"); return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`; };
const parseTier = (t) => { const m = (t || "").match(/(\d+)/); return m ? Number(m[1]) : null; };

// ---------- roster (grupo + canonical name) ----------
const byLower = new Map(); // lower -> canonical
const grupoOf = new Map(); // canonical -> grupo
for (const c of parseCSV(fs.readFileSync(path.join(root, "roster_grupos.csv"), "utf8")).slice(1)) {
  const fam = (c[0] || "").trim(); if (!fam) continue;
  byLower.set(fam.toLowerCase(), fam);
  grupoOf.set(fam, (c[1] || "").trim() || "Indefinido");
}
const canon = (name) => {
  const lc = name.toLowerCase();
  if (byLower.has(lc)) return byLower.get(lc);
  byLower.set(lc, name); grupoOf.set(name, grupoOf.get(name) || "Indefinido");
  return name;
};

// ---------- base_kda_N ----------
const rows = parseCSV(fs.readFileSync(path.join(root, "base_kda_N.csv"), "utf8"));
const data = rows.slice(1); // pula header
let tier = "", reg = "", res = "", dt = "";
const wars = new Map(); // key data -> {iso, tier, reg, res, players:[{fam, vals[]}]}
for (const r of data) {
  if (r[0]) tier = r[0];
  if (r[1]) reg = r[1];
  if (r[2]) res = r[2];
  if (r[3]) dt = r[3];
  const nome = (r[5] || "").trim();
  if (!nome || !dt) continue;
  const key = dt;
  if (!wars.has(key)) wars.set(key, { iso: toISO(dt), tier, reg, res, players: [] });
  const w = wars.get(key);
  const vals = METRIC_KEYS.map((_, k) => norm(r[6 + k]));
  w.players.push({ fam: canon(nome), vals });
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query("BEGIN");

  // idempotencia: remove wars dessas datas (e seu desempenho)
  const isoDates = [...wars.values()].map((w) => w.iso);
  await client.query(`DELETE FROM desempenho WHERE war_id IN (SELECT war_id FROM wars WHERE data = ANY($1::date[]))`, [isoDates]);
  await client.query(`DELETE FROM wars WHERE data = ANY($1::date[])`, [isoDates]);

  // garante players (inclui quem saiu da guild -> Indefinido)
  const allFams = [...new Set([...wars.values()].flatMap((w) => w.players.map((p) => p.fam)))];
  const pVals = [], pParams = []; let pi = 1;
  for (const fam of allFams) { pVals.push(`($${pi++}, $${pi++}, FALSE, TRUE)`); pParams.push(fam, grupoOf.get(fam) || "Indefinido"); }
  await client.query(
    `INSERT INTO players (nome_familia, grupo, is_core, ativo) VALUES ${pVals.join(",")} ON CONFLICT (nome_familia) DO NOTHING`,
    pParams
  );

  let nWars = 0, nDesemp = 0, novosPlayers = 0;
  const existentes = new Set((await client.query(`SELECT nome_familia FROM players`)).rows.map((r) => r.nome_familia));
  for (const fam of allFams) if (!grupoOf.has(fam) || !existentes.has(fam)) {} // no-op (ja inserido)

  for (const w of wars.values()) {
    const { rows: ins } = await client.query(
      `INSERT INTO wars (data, territorio, resultado, tier) VALUES ($1,$2,$3,$4) RETURNING war_id`,
      [w.iso, w.reg || null, w.res || null, parseTier(w.tier)]
    );
    const warId = ins[0].war_id;
    const dVals = [], dParams = []; let di = 1;
    for (const p of w.players) {
      for (let k = 0; k < METRIC_KEYS.length; k++) {
        dVals.push(`($${di++},$${di++},$${di++},$${di++})`);
        dParams.push(warId, p.fam, METRIC_KEYS[k], p.vals[k]);
        nDesemp++;
      }
    }
    await client.query(
      `INSERT INTO desempenho (war_id, nome_familia, metrica, valor) VALUES ${dVals.join(",")}
       ON CONFLICT (war_id, nome_familia, metrica) DO UPDATE SET valor=EXCLUDED.valor`,
      dParams
    );
    nWars++;
  }
  await client.query("COMMIT");

  const q = async (s) => (await client.query(s)).rows[0].n;
  console.log("wars inseridas (base_kda_N):", nWars);
  console.log("desempenho inserido:        ", nDesemp);
  console.log("players (total na tabela):  ", await q("SELECT count(*)::int n FROM players"));
  console.log("wars (total na tabela):     ", await q("SELECT count(*)::int n FROM wars"));
  console.log("desempenho (total):         ", await q("SELECT count(*)::int n FROM desempenho"));
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("ERRO seed_history:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
