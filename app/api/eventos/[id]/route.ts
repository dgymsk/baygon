import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { deletarEvento } from "@/lib/eventos";
import { botFetch } from "@/lib/discordApi";

// DELETE /api/eventos/[id] — apaga o evento (facetas caem por FK; wars/desempenho permanecem). Staff.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const eid = Math.trunc(Number((await params).id));
  if (!Number.isFinite(eid) || eid <= 0) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
  const r = await deletarEvento(eid);
  if (!r.ok) return NextResponse.json({ error: "evento não encontrado" }, { status: 404 });
  // Best-effort: tira os botões da mensagem viva (senão o post órfão seguiria aceitando cliques como "legado").
  if (r.messageId && r.channelId) {
    try {
      await botFetch(`/channels/${r.channelId}/messages/${r.messageId}`, {
        method: "PATCH",
        body: JSON.stringify({ components: [], allowed_mentions: { parse: [] } }),
      });
    } catch { /* best-effort */ }
  }
  return NextResponse.json({ ok: true });
}
