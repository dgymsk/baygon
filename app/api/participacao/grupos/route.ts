import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { criarGrupo, atualizarGrupo, excluirGrupo } from "@/lib/participacaoGrupos";

// Grupos do bot de participação (staff). POST cria, PATCH edita, DELETE remove.
async function corpo(req: Request): Promise<Record<string, unknown> | null> {
  try { return (await req.json()) as Record<string, unknown>; } catch { return null; }
}

export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const b = await corpo(req);
  if (!b) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  const g = await criarGrupo(b.tipo, b.nome, b.emoji, b.limite);
  if (!g) return NextResponse.json({ error: "tipo/nome inválido" }, { status: 400 });
  return NextResponse.json(g);
}

export async function PATCH(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const b = await corpo(req);
  if (!b) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  await atualizarGrupo(b.id, { nome: b.nome, emoji: b.emoji, limite: b.limite });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const b = await corpo(req);
  if (!b) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  await excluirGrupo(b.id);
  return NextResponse.json({ ok: true });
}
