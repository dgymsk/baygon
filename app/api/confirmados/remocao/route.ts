import { NextResponse } from "next/server";
import { saveRemocoes, resetRemocoes } from "@/lib/remocaoStatus";
import { requireEditor } from "@/lib/requireAuth";

// POST /api/confirmados/remocao  { familias: string[] } -> { remocoes }
// Replace-all; a war (war_key) é relida do bot no servidor — não vem do client.
export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: { removidos?: unknown; promovidos?: unknown; warKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  try {
    const remocoes = await saveRemocoes(body.removidos, body.promovidos, typeof body.warKey === "string" ? body.warKey : null);
    return NextResponse.json({ remocoes });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// DELETE /api/confirmados/remocao -> limpa todas as remoções
export async function DELETE() {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  try {
    await resetRemocoes();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
