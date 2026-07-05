import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { getParticipacaoConfig, setParticipacaoConfig } from "@/lib/participacao";

// GET e PUT só staff (a config tem canais/cargos/agenda). Estrutura: { nodewar, siege }.
export async function GET() {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  return NextResponse.json(await getParticipacaoConfig());
}

export async function PUT(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  return NextResponse.json(await setParticipacaoConfig(body));
}
