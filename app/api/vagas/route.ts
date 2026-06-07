import { NextResponse } from "next/server";
import { getVagas, saveVagas } from "@/lib/vagas";
import { requireEditor } from "@/lib/requireAuth";

export async function GET() {
  try {
    return NextResponse.json(await getVagas());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// PUT /api/vagas  { MANI?: {hidden?, texto?}, RESO?: {hidden?, texto?} }  (merge: só altera o que vier)
export async function PUT(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "body deve ser um objeto { MANI?, RESO? }" }, { status: 400 });
  }
  try {
    return NextResponse.json(await saveVagas(body));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
