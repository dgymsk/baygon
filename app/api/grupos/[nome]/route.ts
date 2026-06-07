import { NextResponse } from "next/server";
import { deleteGrupo } from "@/lib/grupos";
import { requireEditor } from "@/lib/requireAuth";

// DELETE /api/grupos/[nome] — exclui o grupo (membros vão p/ Indefinido)
export async function DELETE(_req: Request, { params }: { params: Promise<{ nome: string }> }) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const { nome } = await params;
  const r = await deleteGrupo(decodeURIComponent(nome));
  if (r === "invalido") return NextResponse.json({ error: "não dá pra excluir esse grupo" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
