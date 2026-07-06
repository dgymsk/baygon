import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { setResultado } from "@/lib/eventos";

// POST /api/eventos/[id]/resultado { resultado } — resultado manual (derrota/participacao/vitoria). Staff.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const eid = Math.trunc(Number((await params).id));
  if (!Number.isFinite(eid) || eid <= 0) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
  let body: { resultado?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const r = await setResultado(eid, String(body.resultado ?? ""));
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true });
}
