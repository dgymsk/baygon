import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { atribuirMembro } from "@/lib/participacaoPt";
import { ehTipo } from "@/lib/participacaoConfig";

// PUT { tipo, atribuicoes: [{ familia, ptId | null }] } — atribui jogadores a PTs (por tipo, staff).
// Envia só os deltas. ptId null/"" remove a atribuição.
export async function PUT(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: { tipo?: unknown; atribuicoes?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  if (!ehTipo(body.tipo) || !Array.isArray(body.atribuicoes)) return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  const itens = body.atribuicoes.slice(0, 500) as { familia?: unknown; ptId?: unknown }[];
  for (const a of itens) await atribuirMembro(body.tipo, a.familia, a.ptId ?? null);
  return NextResponse.json({ ok: true, aplicados: itens.length });
}
