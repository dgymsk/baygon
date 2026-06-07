import { NextResponse } from "next/server";
import { archivePlayer, deletePlayer, reactivatePlayer } from "@/lib/players";
import { requireEditor } from "@/lib/requireAuth";

// PATCH /api/players/[nome] — arquivar (vira ex-membro) ou reativar
// body: { action: "arquivar", saida_tipo: "Saiu"|"Kikado" }  |  { action: "reativar" }
export async function PATCH(req: Request, { params }: { params: Promise<{ nome: string }> }) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const { nome } = await params;
  const alvo = decodeURIComponent(nome);
  let b: { action?: unknown; saida_tipo?: unknown };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  try {
    if (b.action === "arquivar") {
      const tipo = b.saida_tipo === "Kikado" ? "Kikado" : "Saiu";
      const ok = await archivePlayer(alvo, tipo);
      if (!ok) return NextResponse.json({ error: "não encontrado" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }
    if (b.action === "reativar") {
      const ok = await reactivatePlayer(alvo);
      if (!ok) return NextResponse.json({ error: "não encontrado" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "action inválida (arquivar|reativar)" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// DELETE /api/players/[nome] — exclui definitivamente (só se não tiver histórico)
export async function DELETE(_req: Request, { params }: { params: Promise<{ nome: string }> }) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const { nome } = await params;
  try {
    const r = await deletePlayer(decodeURIComponent(nome));
    if (r === "tem_historico")
      return NextResponse.json({ error: "tem histórico de war — arquive em vez de excluir" }, { status: 409 });
    if (r === "nao_existe") return NextResponse.json({ error: "não encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
