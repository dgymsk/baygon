import { NextResponse } from "next/server";
import { requireSession } from "@/lib/requireAuth";
import { evolucaoGearPlayer } from "@/lib/garmothStats";

// GET /api/garmoth/evolucao?player=X&from=YYYY-MM-DD&to=YYYY-MM-DD -> { serie: PontoGear[] }
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const unauth = await requireSession();
  if (unauth) return unauth;
  const u = new URL(req.url);
  const player = (u.searchParams.get("player") || "").trim();
  if (!player) return NextResponse.json({ error: "player obrigatório" }, { status: 400 });
  const serie = await evolucaoGearPlayer(player, u.searchParams.get("from") || undefined, u.searchParams.get("to") || undefined);
  return NextResponse.json({ serie });
}
