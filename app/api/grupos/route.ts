import { NextResponse } from "next/server";
import { createGrupo, renameGrupo } from "@/lib/grupos";

// POST /api/grupos { nome } — cria grupo (com métricas baseline)
export async function POST(req: Request) {
  let b: { nome?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const nome = typeof b.nome === "string" ? b.nome : "";
  const r = await createGrupo(nome);
  if (r === "invalido") return NextResponse.json({ error: "nome inválido" }, { status: 400 });
  if (r === "existe") return NextResponse.json({ error: "grupo já existe" }, { status: 409 });
  return NextResponse.json({ ok: true });
}

// PATCH /api/grupos { from, to } — renomeia (ou funde, se 'to' já existir)
export async function PATCH(req: Request) {
  let b: { from?: unknown; to?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const from = typeof b.from === "string" ? b.from : "";
  const to = typeof b.to === "string" ? b.to : "";
  const r = await renameGrupo(from, to);
  if (r === "invalido") return NextResponse.json({ error: "nomes inválidos" }, { status: 400 });
  if (r === "nao_existe") return NextResponse.json({ error: "grupo de origem não existe" }, { status: 404 });
  return NextResponse.json({ ok: true, merged: r === "merge" });
}
