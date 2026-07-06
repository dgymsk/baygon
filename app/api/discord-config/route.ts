import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { getDiscordConfig, setDiscordConfig } from "@/lib/discordConfig";

// Config geral do Discord (servidor ativo + cargos de staff + canais do Apollo). Staff.
export async function GET() {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  return NextResponse.json(await getDiscordConfig());
}
export async function PUT(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  return NextResponse.json(await setDiscordConfig(body));
}
