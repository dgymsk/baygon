import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { criarPt, atualizarPt, excluirPt } from "@/lib/participacaoPt";

// PTs (catálogo global). POST cria, PATCH edita, DELETE remove. Staff.
async function corpo(req: Request): Promise<Record<string, unknown> | null> {
  try { return (await req.json()) as Record<string, unknown>; } catch { return null; }
}

export async function POST(req: Request) {
  const unauth = await requireEditor(); if (unauth) return unauth;
  const b = await corpo(req); if (!b) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  const pt = await criarPt(b.nome, b.emoji, b.cor);
  if (!pt) return NextResponse.json({ error: "nome inválido" }, { status: 400 });
  return NextResponse.json(pt);
}
export async function PATCH(req: Request) {
  const unauth = await requireEditor(); if (unauth) return unauth;
  const b = await corpo(req); if (!b) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  await atualizarPt(b.id, { nome: b.nome, emoji: b.emoji, cor: b.cor });
  return NextResponse.json({ ok: true });
}
export async function DELETE(req: Request) {
  const unauth = await requireEditor(); if (unauth) return unauth;
  const b = await corpo(req); if (!b) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  await excluirPt(b.id);
  return NextResponse.json({ ok: true });
}
