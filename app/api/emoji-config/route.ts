import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { getEmojiMap, setEmojiMap } from "@/lib/emojiConfig";

// Mapa de emojis (classe→emoji, guilda→emoji) do embed do bot. Staff.
export async function GET() {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  return NextResponse.json(await getEmojiMap());
}
export async function PUT(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  return NextResponse.json(await setEmojiMap(body));
}
