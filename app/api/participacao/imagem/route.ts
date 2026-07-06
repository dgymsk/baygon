import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { uploadImagem, listImagens } from "@/lib/blob";

// GET lista as imagens do Blob; POST (multipart, campo "file") faz upload e devolve a URL. Staff.
export const runtime = "nodejs";

export async function GET() {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  return NextResponse.json(await listImagens());
}

export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "envie multipart com o campo file" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "arquivo ausente" }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "imagem grande demais (máx 8MB)" }, { status: 400 });
  const nome = (file as File).name || "img.png";
  try {
    const url = await uploadImagem(nome, file);
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "falha no upload (Blob configurado?)" }, { status: 500 });
  }
}
