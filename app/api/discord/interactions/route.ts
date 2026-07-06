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

// Endpoint público de Interações do Discord (liberado no middleware). A segurança é a
// verificação de assinatura Ed25519 — sem ela, 401. Precisa do runtime Node (crypto).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const APP_ID = process.env.DISCORD_APP_ID;

type DUser = { id?: string; username?: string; global_name?: string | null };
type Interaction = {
  type?: number;
  token?: string;
  data?: { name?: string; custom_id?: string };
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

  // 2 = slash /participacao-nodewar|siege → posta o 1º template do tipo (teste rápido). Só staff.
  if (body.type === 2) {
    const tipo = tipoDoComando(String(body.data?.name ?? ""));
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

  return efemero("Interação não suportada.");
}
