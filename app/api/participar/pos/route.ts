import { NextResponse } from "next/server";
import { setPosLiberacao } from "@/lib/participarStatus";
import { requireEditor } from "@/lib/requireAuth";

// POST /api/participar/pos  { posLiberacao: boolean, warKey } -> { posLiberacao }
// Liga/desliga o modo "pós-liberação (20:30)" da war atual.
export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: { posLiberacao?: unknown; warKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  try {
    const posLiberacao = await setPosLiberacao(!!body.posLiberacao, typeof body.warKey === "string" ? body.warKey : null);
    return NextResponse.json({ posLiberacao });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
