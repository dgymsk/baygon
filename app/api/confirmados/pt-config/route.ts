import { NextResponse } from "next/server";
import { setPtConfig } from "@/lib/ptStatus";
import { requireEditor } from "@/lib/requireAuth";

// POST /api/confirmados/pt-config  { modo, nodewar:{num,extras}, siege:{num,extras} } -> config sanitizada
// Template das PTs por modo (PTs numeradas + nomeadas com ícone). Persiste; não mexe nas marcações.
export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  try {
    const cfg = await setPtConfig(body);
    return NextResponse.json(cfg);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
