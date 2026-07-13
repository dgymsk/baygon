import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { getGuildMeta, setGuildMeta, fetchAllianceFromDiscord } from "@/lib/guildConfig";

// Identidade da aliança + guildas participantes. Staff.
// GET devolve a config atual + o que o Discord tem (icone/banner/nome do servidor) p/ o botão "puxar".
export async function GET() {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const [config, discord] = await Promise.all([getGuildMeta(), fetchAllianceFromDiscord()]);
  return NextResponse.json({ config, discord });
}
export async function PUT(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  return NextResponse.json(await setGuildMeta(body));
}
