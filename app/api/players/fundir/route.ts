import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { fundirPlayers } from "@/lib/fundirPlayers";

/**
 * POST /api/players/fundir { perdedor, vencedor, forcar? }
 *
 * Junta dois cadastros que são a mesma pessoa — o caso de quem trocou o nome no jogo e ganhou um
 * cadastro novo pelo print da war seguinte.
 *
 * O 409 de "jogaram_juntos" é o guarda-corpo que importa: se os dois têm estatística na MESMA war,
 * estavam em campo ao mesmo tempo e provavelmente não são a mesma pessoa. A staff pode insistir com
 * `forcar`, mas só depois de ver a lista de wars.
 */
export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let b: { perdedor?: unknown; vencedor?: unknown; forcar?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const r = await fundirPlayers(b.perdedor, b.vencedor, { forcar: b.forcar === true });
  if (r.ok) return NextResponse.json(r);
  const status = r.codigo === "nao_existe" ? 404 : r.codigo === "jogaram_juntos" ? 409 : 400;
  return NextResponse.json({ error: r.erro, codigo: r.codigo, warsEmComum: r.warsEmComum }, { status });
}
