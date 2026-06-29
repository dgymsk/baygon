// Adiciona pt_meta.pt_config (JSON) e monta a partir de modo/siege_pts/siege_extras.
// Idempotente (só preenche se estiver NULL). Uso: node --env-file=.env.local scripts/migrate_pt_config.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const chaveNome = (s) => [...(s ?? "").normalize("NFD")].filter((ch) => { const c = ch.codePointAt(0) ?? 0; return c < 0x300 || c > 0x36f; }).join("").replace(/\s+/g, " ").trim().toLowerCase();
const slug = (nome) => ("x" + chaveNome(nome).replace(/[^a-z0-9]/g, "").slice(0, 30)) || "x";
const iconePadrao = (nome) => { const k = chaveNome(nome); if (/flanco/.test(k)) return "⚔️"; if (/defesa/.test(k)) return "🔥"; if (/unga/.test(k)) return "🦍"; return ""; };

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(`ALTER TABLE pt_meta ADD COLUMN IF NOT EXISTS pt_config TEXT`);
  const { rows } = await client.query(`SELECT modo, siege_pts, siege_extras, pt_config FROM pt_meta WHERE id = 1`);
  const row = rows[0] ?? {};
  if (row.pt_config) { console.log("pt_config já existe — nada a fazer."); }
  else {
    const usados = new Set();
    const siegeExtras = String(row.siege_extras ?? "Flanco,Defesa").split(/[\n,;]+/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean).map((nome) => {
      let id = slug(nome); while (id === "x" || usados.has(id)) id += "2"; usados.add(id);
      return { id, nome: nome.slice(0, 24), icone: iconePadrao(nome) };
    }).slice(0, 8);
    const cfg = {
      modo: row.modo === "siege" ? "siege" : "nodewar",
      nodewar: { num: 2, extras: [{ id: "defesa", nome: "Defesa", icone: "🔥" }, { id: "ungabunga", nome: "UngaBunga", icone: "🦍" }] },
      siege: { num: Math.max(0, Math.min(5, Number(row.siege_pts) || 3)), extras: siegeExtras },
    };
    await client.query(`UPDATE pt_meta SET pt_config = $1 WHERE id = 1`, [JSON.stringify(cfg)]);
    console.log("OK — pt_config:", JSON.stringify(cfg));
  }
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
