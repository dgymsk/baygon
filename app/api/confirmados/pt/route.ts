import { NextResponse } from "next/server";
import { savePt, resetPt } from "@/lib/ptStatus";
import { requireEditor } from "@/lib/requireAuth";

// POST /api/confirmados/pt  { marcacoes: [{familia, pt, lider}], warKey } -> { pt }
// Replace-all; a war (war_key) é relida do bot no servidor.
export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: { marcacoes?: unknown; warKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  try {
    const pt = await savePt(body.marcacoes, typeof body.warKey === "string" ? body.warKey : null);
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
