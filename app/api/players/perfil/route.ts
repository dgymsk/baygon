import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { perfilPlayer } from "@/lib/perfilPlayer";

/**
 * GET /api/players/perfil?nome=Família  →  o mini resumo do cartão de /membros.
 *
 * Sob demanda, e não junto da lista: a tabela carrega 220 jogadores, e trazer o funil de cada um
 * seria 220 vezes esta consulta pra mostrar uma. O clique é que paga.
 *
 * Staff, como o resto de /membros: o funil de participação de uma pessoa (recusou, não respondeu,
 * não apareceu) é material de conversa de staff, não de vitrine.
 */
export async function GET(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const nome = new URL(req.url).searchParams.get("nome") ?? "";
  if (!nome.trim()) return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });
  const perfil = await perfilPlayer(nome);
  if (!perfil) return NextResponse.json({ error: "jogador não encontrado" }, { status: 404 });
  return NextResponse.json({ perfil });
}
