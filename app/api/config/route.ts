import { NextResponse } from "next/server";
import { getConfig, saveConfig } from "@/lib/config";

// GET /api/config — estado atual (grupos, players/cores, métricas)
export async function GET() {
  try {
    return NextResponse.json(await getConfig());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// PUT /api/config — grava cores + métricas por grupo
// body: { cores: string[], gruposMetricas: Record<grupo, metrica[]> }
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const b = body as { cores?: unknown; gruposMetricas?: unknown };
  const cores = Array.isArray(b.cores) ? b.cores.filter((x): x is string => typeof x === "string") : [];
  const gm: Record<string, string[]> = {};
  if (b.gruposMetricas && typeof b.gruposMetricas === "object") {
    for (const [grupo, lista] of Object.entries(b.gruposMetricas as Record<string, unknown>)) {
      if (Array.isArray(lista)) gm[grupo] = lista.filter((x): x is string => typeof x === "string");
    }
  }
  try {
    await saveConfig(cores, gm);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
