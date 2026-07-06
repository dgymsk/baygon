import { after } from "next/server";
import { verificarInteracao } from "@/lib/discordVerify";
import { upsertResposta, postarMensagem, getRespostas, getParticipacaoConfig } from "@/lib/participacao";
import { listGrupos, listMembros } from "@/lib/participacaoGrupos";
import { montarEmbedGrupos } from "@/lib/participacaoEmbed";
import { type Tipo } from "@/lib/participacaoConfig";
import { listNomesFamilia } from "@/lib/players";
import { casarNome } from "@/lib/casarNome";
import { chaveNome } from "@/lib/nomes";

// Endpoint público de Interações do Discord (liberado no middleware). A segurança é a
// verificação de assinatura Ed25519 — sem ela, 401. Precisa do runtime Node (crypto).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const APP_ID = process.env.DISCORD_APP_ID;
const STAFF_ROLES = (process.env.DISCORD_STAFF_ROLE_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

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
function ehStaff(roles?: string[]): boolean {
  if (!STAFF_ROLES.length) return true;
  return Array.isArray(roles) && roles.some((r) => STAFF_ROLES.includes(r));
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
      if (res.status !== 429 && res.status < 500) { console.error(`editarMensagem falhou: ${res.status}`); return; } // erro do cliente: não retenta
    } catch (e) { console.error("editarMensagem erro de rede", e); }
    await new Promise((r) => setTimeout(r, 400 * (t + 1))); // backoff antes de retentar
  }
  console.error("editarMensagem: esgotou as tentativas");
}

/** Reconstrói o embed agrupado do tipo e edita a mensagem (live-update). */
async function atualizarMensagemGrupos(token: string, tipo: Tipo, warKey: string): Promise<void> {
  const cfg = (await getParticipacaoConfig())[tipo];
  const [grupos, membros, respostas] = await Promise.all([listGrupos(tipo), listMembros(tipo), getRespostas(warKey)]);
  await editarMensagem(token, montarEmbedGrupos(cfg, tipo, grupos, membros, respostas) as unknown as Record<string, unknown>);
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verificarInteracao(raw, req.headers.get("x-signature-ed25519"), req.headers.get("x-signature-timestamp"), PUBLIC_KEY)) {
    return new Response("invalid request signature", { status: 401 });
  }

  let body: Interaction;
  try { body = JSON.parse(raw) as Interaction; } catch { return json({ error: "bad json" }, 400); }

  // 1 = PING (handshake de verificação do endpoint)
  if (body.type === 1) return json({ type: 1 });

  // 2 = APPLICATION_COMMAND (/participacao-nodewar | -siege). Só staff; responde DEFERRED e
  // posta em background (evita estourar o limite de 3s do Discord num cold start).
  if (body.type === 2) {
    const tipo = tipoDoComando(String(body.data?.name ?? ""));
    if (!tipo) return efemero("Comando desconhecido.");
    if (!ehStaff(body.member?.roles)) return efemero("⛔ Sem permissão — apenas staff pode disparar a participação.");
    const token = String(body.token ?? "");
    after(async () => {
      try {
        const r = await postarMensagem(tipo);
        await editarMensagem(token, { content: r.ok ? `✅ Participação **${tipo}** postada no canal.` : `⚠ Não deu: ${r.erro}` });
      } catch (e) { console.error("slash participacao erro", e); }
    });
    return json({ type: 5, data: { flags: 64 } }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE (efêmero)
  }

  // 3 = MESSAGE_COMPONENT (clique Can/Cant). ACK deferido (type 6) e faz o trabalho pesado
  // em after(): resolve nome, grava e reconstrói o embed agrupado, editando a mensagem.
  if (body.type === 3) {
    const m = String(body.data?.custom_id ?? "").match(/^part:(can|cant):(nodewar|siege)$/);
    if (!m) return efemero("Botão inválido.");
    const resposta = m[1] as "can" | "cant";
    const tipo = m[2] as Tipo;
    const warKey = String(body.message?.id ?? "");
    const user = body.member?.user ?? body.user;
    const userId = String(user?.id ?? "");
    const nick = body.member?.nick ?? user?.global_name ?? user?.username ?? "";
    const token = String(body.token ?? "");
    if (!warKey || !userId) return efemero("Não consegui te identificar.");

    after(async () => {
      try {
        // resolve o nome canônico (fuzzy) contra os players (query leve), p/ casar com a atribuição
        const players = (await listNomesFamilia()).map((nf) => ({ chave: chaveNome(nf), nome: nf }));
        const familia = casarNome(familiaDoNick(nick) ?? String(nick), [], players).slice(0, 100);
        await upsertResposta({ warKey, userId, username: String(nick).slice(0, 100), familia, chave: chaveNome(familia), tipo, resposta });
        await atualizarMensagemGrupos(token, tipo, warKey);
      } catch (e) { console.error("clique participacao erro", e); }
    });
    return json({ type: 6 }); // DEFERRED_UPDATE_MESSAGE — ack instantâneo; a mensagem atualiza logo após
  }

  return efemero("Interação não suportada.");
}
