import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { processarLote, getProgresso } from "@/lib/buzinador";

// POST { envioId, tamanho? } — processa UM lote de DMs pendentes; ao zerar, posta o relatório.
// GET ?envioId= — só o progresso, sem processar. O painel chama POST em loop até concluir. Staff.
export const runtime = "nodejs";
export const maxDuration = 60; // um lote abre DM + envia p/ N alvos (sequencial, com 429-handling)

export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: { envioId?: unknown; tamanho?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const id = Math.trunc(Number(body.envioId));
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "envio inválido" }, { status: 400 });
  const tam = Math.min(Math.max(Math.trunc(Number(body.tamanho)) || 20, 1), 40);
  const r = await processarLote(id, tam);
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 404 });
  return NextResponse.json(r);
}

export async function GET(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const id = Math.trunc(Number(new URL(req.url).searchParams.get("envioId")));
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "envio inválido" }, { status: 400 });
  const p = await getProgresso(id);
  if (!p) return NextResponse.json({ error: "envio não encontrado" }, { status: 404 });
  return NextResponse.json(p);
}
