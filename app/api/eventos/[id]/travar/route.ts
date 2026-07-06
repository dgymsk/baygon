import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { travarEvento } from "@/lib/eventos";
import { botFetch } from "@/lib/discordApi";

// POST /api/eventos/[id]/travar — trava o evento (nenhuma participação extra é registrada). Staff.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const eid = Math.trunc(Number((await params).id));
  if (!Number.isFinite(eid) || eid <= 0) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
  const r = await travarEvento(eid);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  // best-effort: tira os botões da mensagem (o gate no servidor já barra cliques)
  if (r.messageId && r.channelId) {
    try { await botFetch(`/channels/${r.channelId}/messages/${r.messageId}`, { method: "PATCH", body: JSON.stringify({ components: [], allowed_mentions: { parse: [] } }) }); } catch { /* best-effort */ }
  }
  return NextResponse.json({ ok: true });
}
