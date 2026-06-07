import { NextResponse } from "next/server";
import { deletePlayer } from "@/lib/players";

// DELETE /api/players/[nome] — exclui definitivamente (só se não tiver histórico)
export async function DELETE(_req: Request, { params }: { params: Promise<{ nome: string }> }) {
  const { nome } = await params;
  try {
    const r = await deletePlayer(decodeURIComponent(nome));
    if (r === "tem_historico")
      return NextResponse.json({ error: "tem histórico de war — desative em vez de excluir" }, { status: 409 });
    if (r === "nao_existe") return NextResponse.json({ error: "não encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
