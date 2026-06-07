import { NextResponse } from "next/server";
import { listWars } from "@/lib/score";

// GET /api/wars — lista de wars (mais recente primeiro) para o seletor do painel.
export async function GET() {
  try {
    return NextResponse.json({ wars: await listWars() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
