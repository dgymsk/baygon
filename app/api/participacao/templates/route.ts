import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { criarTemplate, atualizarTemplate, excluirTemplate } from "@/lib/participacaoPt";

// Templates (nome + tipo + tamanho_max + PTs). POST cria, PATCH edita, DELETE remove. Staff.
async function corpo(req: Request): Promise<Record<string, unknown> | null> {
  try { return (await req.json()) as Record<string, unknown>; } catch { return null; }
}

export async function POST(req: Request) {
  const unauth = await requireEditor(); if (unauth) return unauth;
  const b = await corpo(req); if (!b) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  const tpl = await criarTemplate(b.nome, b.tipo, b.tamanhoMax, b.pts);
  if (!tpl) return NextResponse.json({ error: "nome/tipo inválido" }, { status: 400 });
  return NextResponse.json(tpl);
}
export async function PATCH(req: Request) {
  const unauth = await requireEditor(); if (unauth) return unauth;
  const b = await corpo(req); if (!b) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  await atualizarTemplate(b.id, { nome: b.nome, tipo: b.tipo, tamanhoMax: b.tamanhoMax, pts: b.pts });
  return NextResponse.json({ ok: true });
}
export async function DELETE(req: Request) {
  const unauth = await requireEditor(); if (unauth) return unauth;
  const b = await corpo(req); if (!b) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  await excluirTemplate(b.id);
  return NextResponse.json({ ok: true });
}
