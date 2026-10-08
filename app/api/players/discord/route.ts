import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { buscarContas, contaDiscord, parseDiscordId, trocarDiscord, vinculoAtual } from "@/lib/trocarDiscord";

/**
 * O vínculo Discord ↔ jogador, pela staff (o cartão de /membros).
 *
 *   GET  ?nome=Família   → { vinculo }  o Discord de hoje, com a conta resolvida pelo bot
 *   GET  ?q=texto        → { contas }   busca no servidor ativo (começo de username/apelido),
 *                                       ou a conta exata se `q` for um ID / menção
 *   POST { nome, discordId: string | null } → troca (ou desvincula, com null)
 *
 * Rota própria, pelo mesmo motivo de renomear e dias: o PATCH de /api/players reconstrói a linha
 * inteira, e um vínculo de identidade não pode andar junto de um auto-save de grupo. Staff, como o
 * resto de /membros: quem é cada conta do servidor não é vitrine.
 */
export async function GET(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const sp = new URL(req.url).searchParams;
  const nome = (sp.get("nome") ?? "").trim();
  if (nome) {
    const vinculo = await vinculoAtual(nome);
    if (!vinculo) return NextResponse.json({ error: "jogador não encontrado" }, { status: 404 });
    return NextResponse.json({ vinculo });
  }
  const q = (sp.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ error: "informe nome= ou q=" }, { status: 400 });
  const id = parseDiscordId(q);
  if (id) {
    const c = await contaDiscord(id);
    // ID válido que o bot não resolve ainda pode ser vinculado — a tela mostra só o número
    return NextResponse.json({ contas: c ? [c] : [{ id, username: id, nome: `ID ${id}`, avatar: null, noServidor: false, bot: false }] });
  }
  return NextResponse.json({ contas: await buscarContas(q) });
}

export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let b: { nome?: unknown; discordId?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  // ausente ≠ null: um corpo sem o campo não pode desvincular ninguém por acidente
  if (!("discordId" in b)) return NextResponse.json({ error: "discordId obrigatório (string ou null)" }, { status: 400 });

  const r = await trocarDiscord(b.nome, b.discordId);
  if (r.ok) return NextResponse.json({ ...r, conta: r.para ? await contaDiscord(r.para) : null });
  const status = r.codigo === "nao_existe" ? 404 : r.codigo === "ocupado" ? 409 : 400;
  return NextResponse.json({ error: r.erro, codigo: r.codigo, dono: r.dono }, { status });
}
