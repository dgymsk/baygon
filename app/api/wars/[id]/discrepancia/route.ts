import { NextResponse } from "next/server";
import { discrepanciaPorWar } from "@/lib/score";

// GET /api/wars/[id]/discrepancia — discrepância (3 lentes) da war, calculada na hora.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const warId = Number(id);
  if (!Number.isInteger(warId) || warId <= 0) {
    return NextResponse.json({ error: "id de war inválido" }, { status: 400 });
  }
  try {
    const discrepancia = await discrepanciaPorWar(warId);
    return NextResponse.json({ warId, total: discrepancia.length, discrepancia });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
