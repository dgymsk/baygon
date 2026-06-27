import { NextResponse } from "next/server";
import { setModoPt } from "@/lib/ptStatus";
import { requireEditor } from "@/lib/requireAuth";

// POST /api/confirmados/pt-config  { modo, siegePts } -> { modo, siegePts }
// Template das PTs (nodewar | siege + nº de PTs). Persiste; não mexe nas marcações.
export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: { modo?: unknown; siegePts?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  try {
    const cfg = await setModoPt(body.modo, body.siegePts);
    return NextResponse.json(cfg);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
