import { NextResponse } from "next/server";
import { saveStatus, resetStatus } from "@/lib/participarStatus";
import { requireEditor } from "@/lib/requireAuth";

// POST /api/participar/status  { membros: [{familia, participar}], warKey? } -> { status }
// A war é relida no servidor; o warKey do client serve só pra resolver QUAL sala ele está
// vendo (com várias salas do Apollo configuradas), não pra confiar no valor.
export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: { membros?: unknown; warKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  try {
    const status = await saveStatus(body.membros, typeof body.warKey === "string" ? body.warKey : null);
    return NextResponse.json({ status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// DELETE /api/participar/status -> reseta o status lido
export async function DELETE() {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  try {
    await resetStatus();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
