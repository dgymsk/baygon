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
  data?: { name?: string; custom_id?: string; components?: ModalComp[]; options?: { name?: string; value?: unknown }[] };
  message?: { id?: string };
  member?: { user?: DUser; nick?: string | null; roles?: string[] };
  user?: DUser;
};

const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const efemero = (content: string) => json({ type: 4, data: { flags: 64, content } }); // só quem clicou vê

/** "[M] Doug" → "Doug" (mesma regra do auth.ts). */
function familiaDoNick(nick?: string | null): string | null {
  if (!nick) return null;
  const s = nick.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  return s || null;
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
        const familia = casarNome(familiaDoNick(nick) ?? String(nick), [], players).slice(0, 100);
        const payload = await registrarClique({ warKey, userId, username: String(nick).slice(0, 100), familia, chave: chaveNome(familia), templateId, resposta });
        if (payload) await editarMensagem(token, payload);
      } catch (e) { console.error("clique participacao erro", e); }
    });
    return json({ type: 6 }); // DEFERRED_UPDATE_MESSAGE
  }

  // 5 = MODAL_SUBMIT (texto livre do botão Responder). custom_id = enqtxtm:<enqueteId>.
  if (body.type === 5) {
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
