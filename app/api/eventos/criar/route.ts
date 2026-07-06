import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { criarEventoManual } from "@/lib/eventos";

// POST /api/eventos/criar { tipo, data, titulo } — cria evento RETROATIVO (à mão, sem disparo). Staff.
export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: { tipo?: string; data?: string; titulo?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const ev = await criarEventoManual({ tipo: String(body.tipo ?? "nodewar"), data: body.data, titulo: body.titulo });
  return NextResponse.json({ ok: true, uuid: ev.uuid });
}
