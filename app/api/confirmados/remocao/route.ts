import { NextResponse } from "next/server";
import { aplicarOps, resetRemocoes } from "@/lib/remocaoStatus";
import { requireEditor } from "@/lib/requireAuth";

// POST /api/confirmados/remocao  { ops: [{familia, tipo}], warKey } -> { remocoes }
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
    const remocoes = await aplicarOps(body.ops, typeof body.warKey === "string" ? body.warKey : null);
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
