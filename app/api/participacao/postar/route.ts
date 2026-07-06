import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { postarMensagem } from "@/lib/participacao";

// POST { templateId } — dispara a mensagem de participação a partir de um template (staff).
export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: { templateId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const id = Math.trunc(Number(body.templateId));
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "template inválido" }, { status: 400 });
  const r = await postarMensagem(id);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 502 });
  return NextResponse.json(r);
}
