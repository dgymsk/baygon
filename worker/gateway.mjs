// Worker Gateway do BAYGON — captura MENSAGENS SOLTAS (DMs digitadas) enviadas ao bot.
// O site (Vercel) só recebe INTERAÇÕES (botão/slash/modal); mensagens normais só chegam pelo
// Gateway (WebSocket persistente + intent MESSAGE CONTENT), que o serverless não segura. Por isso
// este processo separado, sempre-ligado. Cada DM vira uma linha em interacao_log (contexto 'DM')
// com um CÓDIGO, e é postada no canal de log configurado em discord_config (mesmo da /discord).
//
// Env necessárias: DISCORD_BOT_TOKEN, DATABASE_URL (use a connection string UNPOOLED do Neon).
// Opcionais (ligam o poller do Garmoth a cada 2h): BAYGON_URL (base do site) + CRON_SECRET (mesmo da Vercel).
// Rodar: npm install && npm start   (deploy: ver README.md)

import { Client, GatewayIntentBits, Partials, ChannelType } from "discord.js";
import pg from "pg";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const DB = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!TOKEN || !DB) {
  console.error("Faltando DISCORD_BOT_TOKEN e/ou DATABASE_URL no ambiente.");
  process.exit(1);
}

const COR = 0x9b6bff; // roxo (igual ao log do site)
const gerarCodigo = (id) => id.toString(36).toUpperCase().padStart(4, "0");

const pool = new pg.Pool({ connectionString: DB, ssl: { rejectUnauthorized: false }, max: 3 });

/** Canal de log vem da MESMA config do site (discord_config.logChannel). */
async function canalDeLog() {
  try {
    const { rows } = await pool.query("SELECT config FROM discord_config WHERE id = 1");
    return rows[0]?.config ? String(JSON.parse(rows[0].config).logChannel || "") : "";
  } catch {
    return "";
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.Message], // DMs só chegam com o partial de Channel
});

client.once("ready", (c) => console.log(`[worker] online como ${c.user.tag} — escutando DMs`));
client.on("error", (e) => console.error("[worker] erro do client", e?.message));
client.on("shardDisconnect", (_e, id) => console.warn(`[worker] shard ${id} desconectou (vai reconectar)`));

client.on("messageCreate", async (msg) => {
  try {
    if (msg.author?.bot) return;                       // ignora bots (inclusive ele mesmo)
    if (msg.channel?.type !== ChannelType.DM) return;  // SÓ mensagens soltas em DM
    const conteudo = (msg.content || "").trim().slice(0, 2000);
    if (!conteudo) return;                             // DM só com anexo/sticker → ignora
    const userId = msg.author.id;
    const username = (msg.author.globalName || msg.author.username || userId).slice(0, 100);

    // grava (INSERT + codigo derivado do id)
    const ins = await pool.query(
      "INSERT INTO interacao_log (codigo, tipo, user_id, username, conteudo, contexto) VALUES ('', 'texto', $1, $2, $3, 'DM') RETURNING id",
      [userId, username, conteudo],
    );
    const id = Number(ins.rows[0].id);
    const codigo = gerarCodigo(id);
    await pool.query("UPDATE interacao_log SET codigo = $2 WHERE id = $1", [id, codigo]);

    // posta no canal de log
    const canal = await canalDeLog();
    if (canal) {
      try {
        const ch = await client.channels.fetch(canal);
        if (ch?.isTextBased()) {
          await ch.send({
            embeds: [{
              title: `📝 Resposta #${codigo}`,
              description: conteudo.slice(0, 4000),
              color: COR,
              fields: [
                { name: "Membro", value: `<@${userId}> · ${username}`.slice(0, 1024), inline: true },
                { name: "Origem", value: "DM (mensagem solta)", inline: true },
              ],
              timestamp: new Date().toISOString(),
            }],
            allowedMentions: { parse: [] },
          });
        }
      } catch (e) {
        console.error(`[worker] falha ao postar #${codigo} no log`, e?.message);
      }
    } else {
      console.warn(`[worker] DM #${codigo} salva, mas canal de log não configurado (/discord)`);
    }

    // confirma pro membro sem spammar: uma reação ✅
    try { await msg.react("✅"); } catch { /* sem permissão de reagir em DM antiga — ok */ }
  } catch (e) {
    console.error("[worker] messageCreate erro", e?.message);
  }
});

// ---- Garmoth: dispara o refresh de gear do site a cada 2h ----
// O Vercel Hobby não faz cron sub-diário; como este worker fica sempre-ligado, ele serve de timer.
// A lógica (chamar a API do Garmoth + gravar) mora no site (POST /api/garmoth/refresh), autenticada
// pelo CRON_SECRET. Precisa das envs BAYGON_URL (base do site) e CRON_SECRET (mesmo da Vercel).
const BAYGON_URL = (process.env.BAYGON_URL || "").replace(/\/+$/, "");
const CRON_SECRET = process.env.CRON_SECRET;
async function atualizarGarmoth() {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 90_000); // não deixa uma rodada travar até a próxima
  try {
    const res = await fetch(`${BAYGON_URL}/api/garmoth/refresh`, { method: "POST", headers: { authorization: `Bearer ${CRON_SECRET}` }, signal: ac.signal });
    const txt = (await res.text()).slice(0, 200);
    if (res.ok) console.log(`[garmoth] refresh ok ${res.status}: ${txt}`);
    else console.error(`[garmoth] refresh FALHOU ${res.status}: ${txt}`); // secret errado (401/403) ou erro (500/503) vira ERRO no log
  } catch (e) {
    console.error("[garmoth] falha no refresh", e?.message);
  } finally {
    clearTimeout(t);
  }
}
async function dispararAgenda() {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 30000);
  try {
    const res = await fetch(`${BAYGON_URL}/api/intencao/cron`, { method: "POST", headers: { authorization: `Bearer ${CRON_SECRET}` }, signal: ac.signal });
    const d = await res.json().catch(() => ({}));
    if (d?.devidas) console.log("[agenda]", JSON.stringify(d.feitos ?? []));
  } catch (e) { console.warn("[agenda] falhou:", e.message); }
  finally { clearTimeout(t); }
}

if (BAYGON_URL && CRON_SECRET) {
  setTimeout(atualizarGarmoth, 15000);                 // 1ª rodada ~15s após subir
  setInterval(atualizarGarmoth, 2 * 60 * 60 * 1000);   // a cada 2h
  // A PRECISÃO é daqui. A chamada precisa sair na hora marcada e o cron da Vercel, no plano Hobby,
  // roda uma vez por dia por entrada e a qualquer minuto DENTRO da hora marcada — então quem acerta
  // o horário é este worker. 5 min casa com a tolerância de 6 min da agenda.
  //
  // Desde vercel.json, o cron da Vercel bate no MESMO endpoint uma vez por hora à noite, com
  // tolerância de 2h: é a rede de segurança pra quando este processo estiver fora do ar, que é
  // justamente quando ninguém percebe que a chamada não saiu. Os dois nunca duplicam — a agenda
  // recusa disparo repetido no mesmo dia BR.
  setInterval(dispararAgenda, 5 * 60 * 1000);
  console.log("[garmoth] polling ligado (a cada 2h)");
} else {
  console.warn("[garmoth] polling DESLIGADO — defina BAYGON_URL e CRON_SECRET p/ ligar");
}

client.login(TOKEN);

// encerra limpo
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { try { await client.destroy(); await pool.end(); } catch {} process.exit(0); });
