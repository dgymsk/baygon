import { NextResponse } from "next/server";
import { evolucao, type Escopo } from "@/lib/evolucao";

// GET /api/evolucao?escopo=geral|grupo|player&valor=...&from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: Request) {
  const u = new URL(req.url);
  const escopo = (u.searchParams.get("escopo") ?? "geral") as Escopo;
  const valor = u.searchParams.get("valor");
  const from = u.searchParams.get("from") || "1900-01-01";
  const to = u.searchParams.get("to") || "2999-12-31";
  if (!["geral", "grupo", "player"].includes(escopo))
    return NextResponse.json({ error: "escopo inválido" }, { status: 400 });
  if (escopo !== "geral" && !valor)
    return NextResponse.json({ error: "valor obrigatório para grupo/player" }, { status: 400 });
  try {
    const serie = await evolucao(escopo, valor, from, to);
    return NextResponse.json({ serie });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
