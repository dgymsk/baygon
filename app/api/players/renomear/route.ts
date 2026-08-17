import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { renomearPlayer } from "@/lib/renomearPlayer";

/**
 * POST /api/players/renomear { de, para }
 *
 * Renomear é a operação mais invasiva do app (o nome é PK e viaja denormalizado por 12 tabelas),
 * então ela tem rota própria em vez de entrar no PATCH em lote de /api/players: aquele grava várias
 * linhas de uma vez e um renome no meio de um auto-save de 10s seria disparado sem ninguém pedir.
 *
 * Os erros voltam com CÓDIGO, e não só texto: a tela usa o código pra distinguir "digite outro
 * nome" (400) de "isso seria fusão de dois cadastros" (409), que exigem respostas diferentes.
 */
export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let b: { de?: unknown; para?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const r = await renomearPlayer(b.de, b.para);
  if (r.ok) return NextResponse.json(r);
  const status = r.codigo === "nao_existe" ? 404
    : r.codigo === "fusao" || r.codigo === "chave_duplicada" || r.codigo === "colisao" ? 409
    : 400;
  return NextResponse.json({ error: r.erro, codigo: r.codigo, colisoes: r.colisoes }, { status });
}
