import { NextResponse } from "next/server";
import { addPlayer, listPlayers, updatePlayers, type PlayerUpdate } from "@/lib/players";

// GET /api/players — todos os membros (com nº de wars)
export async function GET() {
  try {
    return NextResponse.json({ players: await listPlayers() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST /api/players — adiciona membro { nome_familia, grupo, classe_bdo?, ativo? }
export async function POST(req: Request) {
  let b: { nome_familia?: unknown; grupo?: unknown; classe_bdo?: unknown; classe_tipo?: unknown; guilda?: unknown; ativo?: unknown };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const nome = typeof b.nome_familia === "string" ? b.nome_familia.trim() : "";
  const grupo = typeof b.grupo === "string" ? b.grupo : "";
  const classe = typeof b.classe_bdo === "string" ? b.classe_bdo : null;
  const tipo = typeof b.classe_tipo === "string" ? b.classe_tipo : null;
  const guilda = typeof b.guilda === "string" ? b.guilda : "MANI";
  const ativo = b.ativo === undefined ? true : Boolean(b.ativo);
  if (!nome) return NextResponse.json({ error: "nome_familia obrigatório" }, { status: 400 });
  try {
    const ok = await addPlayer(nome, grupo, classe, ativo, guilda, tipo);
    if (!ok) return NextResponse.json({ error: `"${nome}" já existe` }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// PATCH /api/players — atualiza em lote { updates: PlayerUpdate[] }
export async function PATCH(req: Request) {
  let b: { updates?: unknown };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!Array.isArray(b.updates)) return NextResponse.json({ error: "updates deve ser array" }, { status: 400 });
  const updates: PlayerUpdate[] = [];
  for (const u of b.updates) {
    if (u && typeof u === "object" && typeof (u as PlayerUpdate).nome_familia === "string") {
      const x = u as Record<string, unknown>;
      updates.push({
        nome_familia: x.nome_familia as string,
        grupo: typeof x.grupo === "string" ? x.grupo : "Indefinido",
        classe_bdo: typeof x.classe_bdo === "string" ? x.classe_bdo : null,
        classe_tipo: typeof x.classe_tipo === "string" ? x.classe_tipo : null,
        is_core: Boolean(x.is_core),
        guilda: typeof x.guilda === "string" ? x.guilda : "MANI",
      });
    }
  }
  try {
    await updatePlayers(updates);
    return NextResponse.json({ ok: true, n: updates.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
