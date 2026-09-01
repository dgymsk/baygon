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
| disparar a chamada agendada | **cron da Vercel** (a cada 5 min, plano Pro) | precisão de minuto, sem depender de processo próprio |
| ídem | **worker** (a cada 5 min) | redundância: hoje é o cron quem garante |
| atualizar o Garmoth | **cron da Vercel** (a cada 2h) | era só do worker, e congelou quando ele caiu |

O cron está em `vercel.json`, apontando pro mesmo `/api/intencao/cron`. **Desde a conta virar Pro**,
ele bate **de 5 em 5 minutos** — a mesma cadência deste worker e com precisão de minuto —, então o
polling daqui virou redundância: pode ser desligado sem a chamada deixar de sair. O que **não** dá
pra tirar daqui é o Gateway: mensagem solta no privado só chega por WebSocket, e função serverless
não segura conexão aberta.

O refresh do Garmoth também passou pro cron (`0 */2 * * *`, de 2 em 2 horas). Os dois caminhos
convivem sem estrago — o upsert do Garmoth é idempotente e a agenda recusa disparo repetido no mesmo
dia —, mas manter os dois significa bater na API do Garmoth duas vezes por rodada.

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
