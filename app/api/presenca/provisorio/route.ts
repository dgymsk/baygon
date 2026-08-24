import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { marcarProvisorio } from "@/lib/presencaGlobal";

/**
 * POST /api/presenca/provisorio { eventoId, familia, marcar }
 *
 * O rascunho de quem se pretende levar. NÃO é escalação: não ocupa PT, não dispara DM e não entra
 * em nenhuma contagem do funil — por isso mora em tabela própria e tem rota própria, longe do
 * `escalar` do hub, que faz todas essas coisas.
 *
 * Sem gate de evento encerrado: montar rascunho de guerra encerrada é inofensivo (o seletor da tela
 * só oferece as abertas) e travar aqui só criaria um erro sem consequência pra explicar.
 */
export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let b: { eventoId?: unknown; familia?: unknown; marcar?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const eventoId = Math.trunc(Number(b.eventoId));
  if (!Number.isFinite(eventoId) || eventoId <= 0) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
  const r = await marcarProvisorio(eventoId, typeof b.familia === "string" ? b.familia : "", b.marcar !== false);
  if (!r.ok) return NextResponse.json({ error: "jogador inválido" }, { status: 400 });
  return NextResponse.json(r);
}
