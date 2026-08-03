import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { aplicarEscalacao, limparEscalacao, getEscalacao } from "@/lib/escalacao";
import { marcarPresenca, salvarPresenca } from "@/lib/presencaEvento";

// Escalação do evento (deltas por linha) + override da presença in-game. Staff.

export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: { eventoId?: unknown; ops?: unknown; presenca?: unknown; familia?: unknown; participar?: unknown; membros?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const eid = Math.trunc(Number(body.eventoId));
  if (!Number.isFinite(eid)) return NextResponse.json({ error: "evento inválido" }, { status: 400 });

  // override manual da presença in-game (o print pode ler nome errado)
  if (body.presenca === "manual" && typeof body.familia === "string") {
    await marcarPresenca(eid, body.familia, !!body.participar);
    return NextResponse.json({ ok: true });
  }
  // lote vindo da leitura por visão do print
  if (body.presenca === "print") {
    return NextResponse.json({ presenca: await salvarPresenca(eid, body.membros, "print") });
  }
  return NextResponse.json({ escalacao: await aplicarEscalacao(eid, body.ops) });
}

export async function DELETE(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const eid = Math.trunc(Number(new URL(req.url).searchParams.get("eventoId")));
  if (!Number.isFinite(eid)) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
  await limparEscalacao(eid);
  return NextResponse.json({ escalacao: await getEscalacao(eid) });
}
