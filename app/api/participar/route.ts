import { NextResponse } from "next/server";
import { lerParticipar } from "@/lib/participar";
import { requireEditor } from "@/lib/requireAuth";

export const maxDuration = 60; // a leitura por visão pode demorar alguns segundos

// POST /api/participar  { image: { mediaType, data(base64) } } -> { membros: [{familia, participar}] }
export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;

  let body: { image?: { mediaType?: unknown; data?: unknown } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const data = body.image?.data;
  const mediaType = body.image?.mediaType;
  if (typeof data !== "string" || !data) {
    return NextResponse.json({ error: "image.data (base64) é obrigatório" }, { status: 400 });
  }

  try {
    const membros = await lerParticipar({ data, mediaType: typeof mediaType === "string" ? mediaType : "image/png" });
    return NextResponse.json({ membros });
  } catch (e) {
    const msg = (e as Error).message;
    const status = msg.includes("ANTHROPIC_API_KEY") ? 503 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
