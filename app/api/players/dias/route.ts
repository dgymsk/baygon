import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { diasOk } from "@/lib/players";
import { requireEditor } from "@/lib/requireAuth";

/**
 * POST /api/players/dias  { nome, dias: number[] | null }
 *
 * Rota PRÓPRIA, e não um campo a mais no PATCH de /api/players, por um motivo concreto: aquele
 * endpoint RECONSTRÓI a linha inteira a partir do corpo, com valores padrão para o que não vem
 * (grupo vira "Indefinido", guilda vira "MANI", is_core vira false). Mandar de lá só o nome e os
 * dias apagaria metade do cadastro em silêncio, com HTTP 200. Uma ação, uma rota, uma coluna.
 */
export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let b: { nome?: unknown; dias?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const nome = typeof b.nome === "string" ? b.nome.trim() : "";
  if (!nome) return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });
  // ausente ≠ vazio: um corpo truncado (ou um cliente com bug) não pode apagar os dias em silêncio.
  // `null` explícito continua valendo como "voltar a não informado".
  if (b.dias !== null && !Array.isArray(b.dias)) return NextResponse.json({ error: "dias deve ser array ou null" }, { status: 400 });
  const dias = diasOk(b.dias);

  // RETURNING porque o driver HTTP do Neon não tem rowCount: sem ele, gravar num nome que não
  // existe voltaria "ok" e a staff acharia que salvou
  const r = (await sql`UPDATE players SET dias_semana = ${dias as unknown as number[] | null}
                       WHERE nome_familia = ${nome} RETURNING 1`) as unknown[];
  if (!r.length) return NextResponse.json({ error: "jogador não encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true, dias: dias ?? [] });
}
