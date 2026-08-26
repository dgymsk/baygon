# BAYGON — Worker de DMs (Gateway)

Captura **mensagens soltas** (DMs digitadas) que os membros mandam pro bot e registra em
`interacao_log` (com um código) + posta no **canal de log** (o mesmo de `/discord`).

Por que é um serviço à parte: o site roda no Vercel (serverless) e só recebe **interações**
(botão / slash / modal). Mensagem "normal" só chega pelo **Gateway** do Discord (WebSocket
sempre aberto + intent *MESSAGE CONTENT*) — que funções serverless não seguram. Este worker
fica sempre-ligado e faz esse trabalho.

> Escopo: captura só **DM** (mensagem privada pro bot). Não loga mensagens de canais (seria ruído).

## 1) Ligar o intent (uma vez)
Discord Developer Portal → sua aplicação → **Bot** → **Privileged Gateway Intents** →
ligue **MESSAGE CONTENT INTENT** → Save. (O bot está em poucos servidores, então não precisa
verificação.)

## Quem faz o quê (worker x cron da Vercel)

| tarefa | quem faz | por quê |
|---|---|---|
| capturar DM digitada | **só o worker** | precisa de WebSocket sempre aberto; função serverless não segura |
| disparar a chamada agendada | **worker** (a cada 5 min) | precisão: a chamada sai na hora marcada |
| ídem, se o worker cair | **cron da Vercel** (de hora em hora à noite) | rede de segurança, com tolerância de 2h |
| atualizar o Garmoth | **só o worker** (a cada 2h) | — |

O cron está em `vercel.json`, apontando pro mesmo `/api/intencao/cron`. No plano **Hobby** cada
entrada roda **uma vez por dia** e a Vercel escolhe o minuto dentro da hora (uma expressão
sub-diária **falha o deploy**) — por isso são seis entradas, uma por hora da noite, em UTC. Num
plano **Pro** dá pra trocar as seis por uma de cinco em cinco minutos, e aí o polling daqui vira
redundância.

Os dois caminhos nunca duplicam a chamada: `intencao_agenda.ultimo_disparo` recusa um segundo
disparo no mesmo dia (horário de Brasília).

## 2) Variáveis de ambiente
- `DISCORD_BOT_TOKEN` — o mesmo token do bot.
- `DATABASE_URL` — a connection string **UNPOOLED** do Neon (a `DATABASE_URL_UNPOOLED` do `.env.local`).

## 3a) Deploy no Railway
1. https://railway.app → **New Project** → **Deploy from GitHub repo** → escolha `dgymsk/baygon`.
2. Em **Settings → Root Directory**, coloque `baygon/worker` (a pasta deste worker no repo).
   - Start command: `npm start` (já está no `package.json`). Build: `npm install` (automático).
3. Em **Variables**, adicione `DISCORD_BOT_TOKEN` e `DATABASE_URL` (valores acima).
4. Deploy. Nos **Logs** deve aparecer `[worker] online como <bot> — escutando DMs`.

## 3b) Deploy no Render
1. https://render.com → **New** → **Background Worker** → conecte o repo `dgymsk/baygon`.
2. **Root Directory**: `baygon/worker`. **Build**: `npm install`. **Start**: `npm start`.
3. **Environment** → adicione `DISCORD_BOT_TOKEN` e `DATABASE_URL`.
4. Create. Confira os logs (`online como ...`).

## Testar
Manda uma DM qualquer pro bot ("oi, vou faltar hoje"). Deve:
- aparecer no **canal de log** um embed `📝 Resposta #XXXX` com o texto;
- o bot reage com ✅ na sua mensagem (confirmação);
- e a linha entra em `interacao_log` (contexto `DM`).

## Rodar local (teste)
```bash
cd baygon/worker
npm install
DISCORD_BOT_TOKEN=... DATABASE_URL=... npm start
```
(No PowerShell: `$env:DISCORD_BOT_TOKEN="..."; $env:DATABASE_URL="..."; npm start`.)
