import { after } from "next/server";
import { verificarInteracao } from "@/lib/discordVerify";
import { postarMensagem, registrarClique } from "@/lib/participacao";
import { listTemplates } from "@/lib/participacaoPt";
import { type Tipo } from "@/lib/participacaoConfig";
import { listNomesFamilia } from "@/lib/players";
import { getDiscordConfig } from "@/lib/discordConfig";
import { casarNome } from "@/lib/casarNome";
import { chaveNome } from "@/lib/nomes";
import { getEnquete, registrarVoto, montarComponents } from "@/lib/enquete";
import { dispatchVotoHook } from "@/lib/enqueteHooks";
import { registrarTexto, postarNoLog } from "@/lib/interacaoLog";
import { salvarEtapa1, finalizarGarmoth, finalizarManual, playerPorDiscord } from "@/lib/registro";
import { alternarMarca, marcarNaoVou, postarIntencao, montarPayload } from "@/lib/intencao";
import { listPresets } from "@/lib/intencaoPreset";
import { responderConvocacao } from "@/lib/convocacao";

// Endpoint público de Interações do Discord (liberado no middleware). A segurança é a
// verificação de assinatura Ed25519 — sem ela, 401. Precisa do runtime Node (crypto).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const APP_ID = process.env.DISCORD_APP_ID;

type DUser = { id?: string; username?: string; global_name?: string | null };
type ModalComp = { type?: number; custom_id?: string; value?: string; components?: ModalComp[] };
type Interaction = {
  type?: number;
  token?: string;
  guild_id?: string;
  channel_id?: string;
  data?: { name?: string; custom_id?: string; components?: ModalComp[]; options?: { name?: string; value?: unknown }[] };
  message?: { id?: string };
  member?: { user?: DUser; nick?: string | null; roles?: string[] };
  user?: DUser;
};

// ---- Modais/botões da JORNADA DE REGISTRO ----
const linha = (comp: object) => ({ type: 1, components: [comp] });
const inputTxt = (custom_id: string, label: string, o: { max?: number; ph?: string; style?: number } = {}) =>
  ({ type: 4, custom_id, style: o.style ?? 1, label, min_length: 1, max_length: o.max ?? 100, required: true, placeholder: o.ph });
const MODAL_ETAPA1 = { type: 9, data: { custom_id: "regm1", title: "Registro — Manicômio", components: [
  linha(inputTxt("familia", "Nick de família (BDO)", { max: 60, ph: "Ex.: Fafnir" })),
  linha(inputTxt("apelido", "Seu nome/apelido", { max: 32, ph: "Como te chamam" })),
] } };
const ESCOLHA = { type: 4, data: { flags: 64, content: "Boa! Agora informe seu **gear** — escolha o método:", components: [
  { type: 1, components: [
    { type: 2, style: 1, label: "📊 Via Garmoth", custom_id: "reg:garmoth" },
    { type: 2, style: 2, label: "🖊️ Manual", custom_id: "reg:manual" },
  ] },
] } };
const MODAL_GARMOTH = { type: 9, data: { custom_id: "regm_garmoth", title: "Registro — via Garmoth", components: [
  linha(inputTxt("link", "Link (1ª opção = seu boneco de guerra)", { max: 200, ph: "https://garmoth.com/character/..." })),
] } };
const MODAL_MANUAL = { type: 9, data: { custom_id: "regm_manual", title: "Registro — manual", components: [
  linha(inputTxt("ap", "AP", { max: 6, ph: "395" })),
  linha(inputTxt("aap", "AAP", { max: 6, ph: "391" })),
  linha(inputTxt("dp", "DP", { max: 6, ph: "483" })),
  linha(inputTxt("classe", "Classe", { max: 30, ph: "Domadora" })),
  linha(inputTxt("prof", "Proficiência (succ ou awk)", { max: 8, ph: "succ" })),
] } };

const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const efemero = (content: string) => json({ type: 4, data: { flags: 64, content } }); // só quem clicou vê

/** "[M] Doug" → "Doug" (mesma regra do auth.ts). */
function familiaDoNick(nick?: string | null): string | null {
  if (!nick) return null;
  const s = nick.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  return s || null;
}
/**
 * Primeiro candidato que sobra alguma letra/número depois de tirar tags e emoji.
 * Nick só de emoji (ex.: "⚔️") vinha virando nome de família e não casava com player nenhum —
 * por isso cai pro global_name e, no fim, pro username, que sempre tem caracteres utilizáveis.
 */
function primeiroNomeUtil(...cands: (string | null | undefined)[]): string {
  for (const c of cands) {
    const limpo = familiaDoNick(c) ?? "";
    if (/[\p{L}\p{N}]/u.test(limpo)) return limpo;
  }
  return String(cands.find(Boolean) ?? "");
}
function tipoDoComando(nome: string): Tipo | null {
  if (nome.endsWith("siege")) return "siege";
  if (nome.endsWith("nodewar")) return "nodewar";
  return null;
}
/** Só staff dispara o slash. Sem cargos configurados → todo mundo (paridade com auth.ts). */
async function ehStaff(roles?: string[]): Promise<boolean> {
  const { staffRoleIds } = await getDiscordConfig();
  if (!staffRoleIds.length) return true;
  return Array.isArray(roles) && roles.some((r) => staffRoleIds.includes(r));
}

/** Edita a mensagem original da interação (o token da interação autoriza; sem bot token). */
async function editarMensagem(token: string, payload: Record<string, unknown>): Promise<void> {
  if (!APP_ID || !token) return;
  const url = `https://discord.com/api/v10/webhooks/${APP_ID}/${token}/messages/@original`;
  const body = JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }); // nunca (re)pinga ao editar
  for (let t = 0; t < 3; t++) {
    try {
      const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body });
      if (res.ok) return;
      if (res.status !== 429 && res.status < 500) { console.error(`editarMensagem falhou: ${res.status}`); return; }
    } catch (e) { console.error("editarMensagem erro de rede", e); }
    await new Promise((r) => setTimeout(r, 400 * (t + 1)));
  }
  console.error("editarMensagem: esgotou as tentativas");
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verificarInteracao(raw, req.headers.get("x-signature-ed25519"), req.headers.get("x-signature-timestamp"), PUBLIC_KEY)) {
    return new Response("invalid request signature", { status: 401 });
  }

  let body: Interaction;
  try { body = JSON.parse(raw) as Interaction; } catch { return json({ error: "bad json" }, 400); }

  if (body.type === 1) return json({ type: 1 }); // PING → PONG

  // 2 = slash command.
  if (body.type === 2) {
    const nome = String(body.data?.name ?? "");

    // /register — QUALQUER membro. Só no canal configurado (se houver). Abre o modal do passo 1.
    if (nome === "register") {
      const cfg = await getDiscordConfig();
      if (cfg.registerChannel && String(body.channel_id ?? "") !== cfg.registerChannel) {
        return efemero(`Use o /register no canal <#${cfg.registerChannel}>.`);
      }
      return json(MODAL_ETAPA1);
    }

    // /responder <texto> — resposta livre de QUALQUER membro; grava e posta no canal de log.
    if (nome === "responder") {
      const u = body.member?.user ?? body.user;
      const userId = String(u?.id ?? "");
      const username = String(body.member?.nick ?? u?.global_name ?? u?.username ?? "").slice(0, 100);
      const opt = Array.isArray(body.data?.options) ? body.data.options.find((o) => o?.name === "texto") : undefined;
      const texto = String(opt?.value ?? "").trim();
      const token = String(body.token ?? "");
      if (!userId || !texto) return efemero("Não consegui registrar (texto vazio?).");
      after(async () => {
        try {
          const reg = await registrarTexto({ userId, username, conteudo: texto, contexto: "/responder" });
          if (reg) { await postarNoLog(reg.id); await editarMensagem(token, { content: `✅ Registrado #${reg.codigo}. Obrigado!` }); }
          else await editarMensagem(token, { content: "Não consegui registrar." });
        } catch (e) { console.error("/responder erro", e); }
      });
      return json({ type: 5, data: { flags: 64 } }); // DEFERRED efêmero (followup via editarMensagem)
    }

    // /intencao-* — bot NOVO (marca por PT, sem limite de vaga). Staff, igual ao antigo.
    const mIntCmd = nome.match(/^intencao-(nodewar|siege)$/);
    if (mIntCmd) {
      if (!(await ehStaff(body.member?.roles))) return efemero("⛔ Sem permissão — apenas staff pode disparar.");
      const tokenInt = String(body.token ?? "");
      const tipoInt = mIntCmd[1];
      after(async () => {
        try {
          const preset = (await listPresets()).find((p) => p.tipo === tipoInt);
          if (!preset) { await editarMensagem(tokenInt, { content: `⚠ Nenhum preset de **${tipoInt}**. Crie um em /intencao.` }); return; }
          const r = await postarIntencao(preset.id);
          await editarMensagem(tokenInt, { content: r.ok ? `✅ Intenção **${preset.nome}** postada.` : `⚠ Não deu: ${r.erro}` });
        } catch (e) { console.error("slash intencao erro", e); }
      });
      return json({ type: 5, data: { flags: 64 } }); // DEFERRED efêmero
    }

    const tipo = tipoDoComando(nome);
    if (!tipo) return efemero("Comando desconhecido.");
    if (!(await ehStaff(body.member?.roles))) return efemero("⛔ Sem permissão — apenas staff pode disparar.");
    const token = String(body.token ?? "");
    after(async () => {
      try {
        const tpl = (await listTemplates()).find((x) => x.tipo === tipo);
        if (!tpl) { await editarMensagem(token, { content: `⚠ Nenhum template de **${tipo}**. Crie um em /participacao.` }); return; }
        const r = await postarMensagem(tpl.id);
        await editarMensagem(token, { content: r.ok ? `✅ Participação **${tpl.nome}** postada.` : `⚠ Não deu: ${r.erro}` });
      } catch (e) { console.error("slash participacao erro", e); }
    });
    return json({ type: 5, data: { flags: 64 } }); // DEFERRED efêmero
  }

  // 3 = clique de botão. ACK deferido (type 6) + trabalho em after().
  if (body.type === 3) {
    // JORNADA DE REGISTRO: botões abrem modais (síncrono, type 9).
    const cidReg = String(body.data?.custom_id ?? "");
    if (cidReg === "reg:start") return json(MODAL_ETAPA1);   // botão do Buzinador (DM)
    if (cidReg === "reg:garmoth") return json(MODAL_GARMOTH);
    if (cidReg === "reg:manual") return json(MODAL_MANUAL);

    // Botão "Responder" (texto livre) → abre um MODAL (type 9, síncrono, sem DB). custom_id = enqtxt:<enqueteId>.
    const mTxt = String(body.data?.custom_id ?? "").match(/^enqtxt:(\d+)$/);
    if (mTxt) {
      return json({
        type: 9, // MODAL
        data: {
          custom_id: `enqtxtm:${mTxt[1]}`,
          title: "Sua resposta",
          components: [{ type: 1, components: [{ type: 4, custom_id: "resposta", style: 2, label: "Escreva sua resposta", min_length: 1, max_length: 1000, required: true, placeholder: "Digite aqui…" }] }],
        },
      });
    }

    // ENQUETE genérica (buzinador / confirm-por-DM). custom_id = enq:<enqueteId>:<idx>. Testar ANTES do part:.
    const mEnq = String(body.data?.custom_id ?? "").match(/^enq:(\d+):(\d+)$/);
    if (mEnq) {
      const enqueteId = Number(mEnq[1]);
      const idx = Number(mEnq[2]);
      const uEnq = body.member?.user ?? body.user;
      const userId = String(uEnq?.id ?? "");
      const username = String(body.member?.nick ?? uEnq?.global_name ?? uEnq?.username ?? "").slice(0, 100);
      const token = String(body.token ?? "");
      if (!userId) return efemero("Não consegui te identificar.");
      after(async () => {
        try {
          const e = await getEnquete(enqueteId);
          if (!e || e.status !== "aberta") { await editarMensagem(token, { content: "🔒 Votação encerrada." }); return; }
          const r = await registrarVoto({ enqueteId, userId, idx, username });
          if (!r.ok) return; // opção sumiu / enquete fechou entre o ACK e o after — nada a editar
          await dispatchVotoHook(e, { userId, username, idx }); // efeito por contexto (ex.: espelha na participação)
          await editarMensagem(token, { components: montarComponents(e, idx) }); // realça a escolha
        } catch (err) { console.error("clique enquete erro", err); }
      });
      return json({ type: 6 }); // DEFERRED_UPDATE_MESSAGE
    }

    // --- bot de INTENÇÃO (stack nova, tabelas intencao_*) — não encosta no fluxo part: abaixo ---
    // --- CONVOCAÇÃO: resposta da DM de quem foi escalado (aceita/recusa) ---
    const mEsc = String(body.data?.custom_id ?? "").match(/^int:esc:(\d+):(sim|nao)$/);
    if (mEsc) {
      const eventoIdEsc = Number(mEsc[1]);
      const aceita = mEsc[2] === "sim";
      const uEsc = body.member?.user ?? body.user; // em DM não há member
      const userIdEsc = String(uEsc?.id ?? "");
      if (!userIdEsc) return efemero("Não consegui te identificar.");
      const r = await responderConvocacao(eventoIdEsc, userIdEsc, aceita);
      if (!r.ok) return efemero("Não achei sua escalação nesse evento — fale com a staff.");
      // edita a própria DM: some com os botões e deixa a resposta registrada à vista
      return json({
        type: 7, // UPDATE_MESSAGE
        data: {
          embeds: [{
            description: aceita
              ? "✅ **Confirmado.** Te esperamos na war."
              : "❌ **Anotado, você não vai.** Sua vaga foi liberada pra staff remanejar.",
            color: aceita ? 0x2e7d32 : 0x8f8f8f,
          }],
          components: [],
        },
      });
    }

    // `pt` é o nome ANTIGO do botão de função. custom_id vive dentro da mensagem pra sempre, então
    // mensagem já postada não pode morrer só porque o código renomeou — aceita os dois.
    const mInt = String(body.data?.custom_id ?? "").match(/^int:(fn|pt|nao|sync):(\d+)(?::(\d+))?$/);
    if (mInt) {
      const acao = (mInt[1] === "pt" ? "fn" : mInt[1]) as "fn" | "nao" | "sync";
      const presetId = Number(mInt[2]);
      const funcaoId = mInt[3] ? Number(mInt[3]) : null;
      const messageId = String(body.message?.id ?? "");
      const uInt = body.member?.user ?? body.user;
      const userIdInt = String(uInt?.id ?? "");
      const nickInt = body.member?.nick ?? uInt?.global_name ?? uInt?.username ?? "";
      const tokenInt = String(body.token ?? "");
      if (!messageId || !userIdInt) return efemero("Não consegui te identificar.");
      // redesenhar é ação de administração — o botão saiu da mensagem, mas mensagens antigas
      // ainda o têm, então o gate fica aqui e não só na ausência do botão.
      if (acao === "sync" && !(await ehStaff(body.member?.roles))) return efemero("⛔ Só staff atualiza a mensagem.");
      after(async () => {
        try {
          const players = (await listNomesFamilia()).map((nf) => ({ chave: chaveNome(nf), nome: nf }));
          // registrado → identidade pelo discord_id; senão casa pelo nick, caindo pro global_name
          // e pro username quando o apelido não tem nada aproveitável (ex.: nick só de emoji).
          const bruto = primeiroNomeUtil(body.member?.nick, uInt?.global_name, uInt?.username);
          const familia = (await playerPorDiscord(userIdInt)) ?? casarNome(bruto, [], players).slice(0, 100);
          const quem = { messageId, userId: userIdInt, username: String(nickInt).slice(0, 100), familia, chave: chaveNome(familia), presetId };
          const payload = acao === "sync" ? await montarPayload(messageId, presetId)
            : acao === "fn" && funcaoId != null ? await alternarMarca({ ...quem, funcaoId })
            : await marcarNaoVou(quem);
          if (payload) await editarMensagem(tokenInt, payload);
        } catch (e) { console.error("clique intencao erro", e); }
      });
      return json({ type: 6 }); // DEFERRED_UPDATE_MESSAGE
    }

    const m = String(body.data?.custom_id ?? "").match(/^part:(can|cant):(\d+)$/);
    if (!m) return efemero("Botão inválido.");
    const resposta = m[1] as "can" | "cant";
    const templateId = Number(m[2]);
    const warKey = String(body.message?.id ?? "");
    const user = body.member?.user ?? body.user;
    const userId = String(user?.id ?? "");
    const nick = body.member?.nick ?? user?.global_name ?? user?.username ?? "";
    const token = String(body.token ?? "");
    if (!warKey || !userId) return efemero("Não consegui te identificar.");

    after(async () => {
      try {
        const players = (await listNomesFamilia()).map((nf) => ({ chave: chaveNome(nf), nome: nf }));
        // registrado → identidade pelo discord_id (robusta, independe do nick renomeado); senão casa pelo nick.
        const familia = (await playerPorDiscord(userId)) ?? casarNome(familiaDoNick(nick) ?? String(nick), [], players).slice(0, 100);
        const payload = await registrarClique({ warKey, userId, username: String(nick).slice(0, 100), familia, chave: chaveNome(familia), templateId, resposta });
        if (payload) await editarMensagem(token, payload);
      } catch (e) { console.error("clique participacao erro", e); }
    });
    return json({ type: 6 }); // DEFERRED_UPDATE_MESSAGE
  }

  // 5 = MODAL_SUBMIT.
  if (body.type === 5) {
    const cid5 = String(body.data?.custom_id ?? "");
    const comps: Record<string, string> = {};
    for (const row of body.data?.components ?? []) for (const c of row.components ?? []) if (c.custom_id) comps[c.custom_id] = String(c.value ?? "");
    const uReg = body.member?.user ?? body.user;
    const uid = String(uReg?.id ?? "");

    // REGISTRO passo 1 (nick de família + apelido) → salva e oferece manual/garmoth (síncrono).
    if (cid5 === "regm1") {
      if (!uid || !comps.familia?.trim() || !comps.apelido?.trim()) return efemero("Preencha o nick de família e o apelido.");
      try { await salvarEtapa1(uid, comps.familia, comps.apelido); }
      catch (e) { console.error("salvarEtapa1 erro", e); return efemero("Não consegui salvar agora. Tente /register de novo."); }
      return json(ESCOLHA);
    }
    // REGISTRO passo 2 (garmoth ou manual) → finaliza em after() (fetch/discord podem passar de 3s).
    if (cid5 === "regm_garmoth" || cid5 === "regm_manual") {
      if (!uid) return efemero("Não consegui te identificar.");
      const guildId = String(body.guild_id ?? "");
      const tk = String(body.token ?? "");
      after(async () => {
        try {
          const r = cid5 === "regm_garmoth"
            ? await finalizarGarmoth(uid, guildId, comps.link ?? "")
            : await finalizarManual(uid, guildId, { ap: comps.ap ?? "", aap: comps.aap ?? "", dp: comps.dp ?? "", classe: comps.classe ?? "", prof: comps.prof ?? "" });
          await editarMensagem(tk, { content: r.msg, components: [] });
        } catch (e) { console.error("registro finalizar erro", e); await editarMensagem(tk, { content: "⚠ Deu erro no registro. Tente de novo com /register." }); }
      });
      return json({ type: 5, data: { flags: 64 } }); // DEFERRED efêmero
    }

    const mm = String(body.data?.custom_id ?? "").match(/^enqtxtm:(\d+)$/);
    if (!mm) return efemero("Formulário não reconhecido.");
    const enqueteId = Number(mm[1]);
    const u = body.member?.user ?? body.user;
    const userId = String(u?.id ?? "");
    const username = String(body.member?.nick ?? u?.global_name ?? u?.username ?? "").slice(0, 100);
    const token = String(body.token ?? "");
    let texto = "";
    for (const row of body.data?.components ?? []) for (const comp of row.components ?? []) if (comp.custom_id === "resposta") texto = String(comp.value ?? "");
    texto = texto.trim();
    if (!userId || !texto) return efemero("Resposta vazia.");
    after(async () => {
      try {
        const enq = await getEnquete(enqueteId);
        // gate coerente com o voto: enquete tem que existir, estar aberta e ainda aceitar texto livre
        if (!enq || enq.status !== "aberta" || !enq.texto_livre) { await editarMensagem(token, { content: "🔒 Respostas encerradas." }); return; }
        const contexto = `Buzinador · ${enq.titulo}`.slice(0, 100);
        const reg = await registrarTexto({ userId, username, conteudo: texto, contexto, refId: String(enqueteId) });
        if (reg) { await postarNoLog(reg.id); await editarMensagem(token, { content: `✅ Resposta registrada (#${reg.codigo}). Obrigado!` }); }
        else await editarMensagem(token, { content: "Não consegui registrar." });
      } catch (e) { console.error("modal submit erro", e); }
    });
    return json({ type: 5, data: { flags: 64 } }); // DEFERRED efêmero (followup via editarMensagem)
  }

  return efemero("Interação não suportada.");
}
