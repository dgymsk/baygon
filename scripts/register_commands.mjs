// Registra os slash commands /participacao-nodewar e /participacao-siege NO SERVIDOR ATIVO
// (guild command = aparece na hora, sem espera global). Idempotente (PUT sobrescreve).
// O guild vem da config (discord_config), com fallback pro env.
// Uso: node --env-file=.env.local scripts/register_commands.mjs
import pg from "pg";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const APP_ID = process.env.DISCORD_APP_ID;

async function guildAtivo() {
  const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (conn) {
    const c = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
    try {
      await c.connect();
      const { rows } = await c.query("SELECT config FROM discord_config WHERE id = 1");
      const g = rows[0]?.config ? (JSON.parse(rows[0].config).guildId || "") : "";
      if (g) return String(g).replace(/[^0-9]/g, "");
    } catch { /* cai no env */ } finally { await c.end().catch(() => {}); }
  }
  return (process.env.DISCORD_GUILD_ID ?? "").split(",").map((s) => s.trim()).filter(Boolean)[0];
}
const GUILD_ID = await guildAtivo();

if (!TOKEN || !APP_ID || !GUILD_ID) {
  console.error("Faltando: DISCORD_BOT_TOKEN, DISCORD_APP_ID e/ou guild (config ou env).");
  process.exit(1);
}

const comandos = [
  { name: "participacao-nodewar", type: 1, description: "Posta a mensagem de participação da Nodewar (botões Can/Cant)." },
  { name: "participacao-siege", type: 1, description: "Posta a mensagem de participação da Siege (botões Can/Cant)." },
  // bot de INTENÇÃO (stack nova): um botão por PT, marca quantas quiser, sem limite de vaga
  { name: "intencao-nodewar", type: 1, description: "Posta a chamada de intenção da Nodewar (um botão por PT)." },
  { name: "intencao-siege", type: 1, description: "Posta a chamada de intenção da Siege (um botão por PT)." },
  { name: "responder", type: 1, description: "Envia uma resposta/observação livre (fica registrada no log).", options: [
    { name: "texto", description: "O que você quer registrar", type: 3, required: true },
  ] },
  { name: "register", type: 1, description: "Faça seu registro na guilda (família, apelido e gear)." },
];

const res = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`, {
  method: "PUT",
  headers: { Authorization: `Bot ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(comandos),
});
const txt = await res.text();
if (!res.ok) { console.error("ERRO", res.status, txt.slice(0, 500)); process.exit(1); }
const arr = JSON.parse(txt);
console.log(`OK — ${arr.length} comandos registrados no guild ${GUILD_ID}:`, arr.map((c) => "/" + c.name).join(", "));
