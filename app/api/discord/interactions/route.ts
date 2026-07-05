import { after } from "next/server";
import { verificarInteracao } from "@/lib/discordVerify";
import { upsertResposta, postarMensagem } from "@/lib/participacao";
import { type Tipo } from "@/lib/participacaoConfig";
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

/** Edita a resposta deferida (não precisa de bot token — o token da interação autoriza). */
async function editarResposta(token: string, content: string): Promise<void> {
  if (!APP_ID || !token) return;
  try {
    await fetch(`https://discord.com/api/v10/webhooks/${APP_ID}/${token}/messages/@original`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }),
    });
  } catch { /* best-effort */ }
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
      const r = await postarMensagem(tipo);
      await editarResposta(token, r.ok ? `✅ Participação **${tipo}** postada no canal.` : `⚠ Não deu: ${r.erro}`);
    });
    return json({ type: 5, data: { flags: 64 } }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE (efêmero)
  }

  // 3 = MESSAGE_COMPONENT (clique Can/Cant). Caminho quente: SEM leitura no banco.
  if (body.type === 3) {
    const m = String(body.data?.custom_id ?? "").match(/^part:(can|cant):(nodewar|siege)$/);
    if (!m) return efemero("Botão inválido.");
    const resposta = m[1] as "can" | "cant";
    const tipo = m[2];
    const warKey = String(body.message?.id ?? "");
    const user = body.member?.user ?? body.user;
    const userId = String(user?.id ?? "");
    const nick = body.member?.nick ?? user?.global_name ?? user?.username ?? "";
    if (!warKey || !userId) return efemero("Não consegui te identificar.");

    // guarda o nick; nome canônico + guilda são resolvidos na página /participacao.
    const familia = (familiaDoNick(nick) ?? String(nick)).slice(0, 100);
    await upsertResposta({ warKey, userId, username: String(nick).slice(0, 100), familia, chave: chaveNome(familia), tipo, resposta });

    return efemero(resposta === "can" ? "✅ Marcado: **Can** — você vai participar." : "❌ Marcado: **Cant** — você não vai.");
  }

  return efemero("Interação não suportada.");
}
