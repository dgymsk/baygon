import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { postarMensagem } from "@/lib/participacao";
import { ehTipo } from "@/lib/participacaoConfig";

// POST { tipo: "nodewar"|"siege" } — dispara a mensagem de participação (staff).
export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: { tipo?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  if (!ehTipo(body.tipo)) return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
  const r = await postarMensagem(body.tipo);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 502 });
  return NextResponse.json(r);
}
