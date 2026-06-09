import { NextResponse } from "next/server";
import { aplicarOps, resetPt } from "@/lib/ptStatus";
import { requireEditor } from "@/lib/requireAuth";

// POST /api/confirmados/pt  { ops: [{familia, pt, lider}], warKey } -> { pt }
// Deltas por linha (seguro p/ edição concorrente). war_key relida do bot no servidor.
export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: { ops?: unknown; warKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  try {
    const pt = await aplicarOps(body.ops, typeof body.warKey === "string" ? body.warKey : null);
    return NextResponse.json({ pt });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// DELETE /api/confirmados/pt -> limpa todas as marcações
export async function DELETE() {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  try {
    await resetPt();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
