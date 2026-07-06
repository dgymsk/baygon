import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { auth } from "@/auth";
import { criarEnvio, type Audiencia } from "@/lib/buzinador";

// POST { mensagem, imagemUrl?, canalReportId, audiencia:{tipo,roleId?,userIds?} } — cria um
// disparo de DM. Resolve a audiência e grava os alvos; o processamento vai por lotes. Staff.
export const runtime = "nodejs";
export const maxDuration = 60; // resolver "todos"/cargo pode paginar os membros

export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const session = await auth();
  let body: { mensagem?: unknown; imagemUrl?: unknown; canalReportId?: unknown; audiencia?: Audiencia };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const r = await criarEnvio({
    mensagem: body.mensagem,
    imagemUrl: body.imagemUrl,
    canalReportId: body.canalReportId,
    audiencia: (body.audiencia ?? {}) as Audiencia,
    criadoPor: session?.user?.name ?? null,
  });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ envioId: r.envioId, total: r.total });
}
