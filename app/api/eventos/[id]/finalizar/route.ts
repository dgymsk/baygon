import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { finalizarEvento } from "@/lib/eventos";
import { botFetch } from "@/lib/discordApi";

// POST /api/eventos/[id]/finalizar — congela o snapshot do roster + tira os botões da mensagem. Staff.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const eid = Math.trunc(Number((await params).id));
  if (!Number.isFinite(eid) || eid <= 0) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
  const det = await finalizarEvento(eid);
  if (!det) return NextResponse.json({ error: "evento não encontrado" }, { status: 404 });
  // Best-effort: remove os botões da mensagem (o gate no servidor já barra cliques). Embed/roster fica congelado.
  if (det.messageId && det.channelId) {
    try {
      await botFetch(`/channels/${det.channelId}/messages/${det.messageId}`, {
        method: "PATCH",
        body: JSON.stringify({ components: [], allowed_mentions: { parse: [] } }),
      });
    } catch { /* best-effort */ }
  }
  return NextResponse.json({ ok: true, uuid: det.uuid });
}
