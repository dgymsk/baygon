import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { sql } from "@/lib/db";
import { lerResultado } from "@/lib/lerResultado";
import { lerRosas } from "@/lib/lerRosas";
import { normalizarValor } from "@/lib/normalizarValor";
import { chaveNome, acharSimilar } from "@/lib/nomes";

export const maxDuration = 60; // Vercel Hobby limita a 60s; Opus lê 1 print bem dentro disso

// POST /api/eventos/[id]/resultado/extrair { image:{mediaType,data} }
//   -> { linhas: [{ familiaLida, familia|null, valores:{ metrica:{raw,valor} } }] }  (NÃO grava — só revisão)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const eid = Math.trunc(Number((await params).id));
  if (!Number.isFinite(eid) || eid <= 0) return NextResponse.json({ error: "evento inválido" }, { status: 400 });

  let body: { image?: { mediaType?: unknown; data?: unknown } };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const data = body.image?.data;
  if (typeof data !== "string" || !data) return NextResponse.json({ error: "image.data (base64) é obrigatório" }, { status: 400 });
  const mediaType = typeof body.image?.mediaType === "string" ? body.image.mediaType : "image/png";

  // evento tem que existir antes de gastar chamada paga de Opus (id velho/errado ⇒ 404, não queima IA)
  const ev = (await sql`SELECT tipo FROM evento WHERE id = ${eid}`) as { tipo: string }[];
  if (!ev[0]) return NextResponse.json({ error: "evento não encontrado" }, { status: 404 });

  // candidatos p/ casar nome (todos os players — o FK de desempenho aponta pra players)
  const players = (await sql`SELECT nome_familia FROM players`) as { nome_familia: string }[];
  const cands = players.map((p) => ({ chave: chaveNome(p.nome_familia), nome: p.nome_familia }));
  const casar = (nome: string): string | null => {
    const k = chaveNome(nome);
    return cands.find((c) => c.chave === k)?.nome ?? acharSimilar(k, cands)?.nome ?? null;
  };

  try {
    /**
     * ROSAS lê outro print. Na Guerra das Rosas o jogo não dá tela de estatística de combate — só a
     * lista de participação (Nome · Cargo · Abates · Mortes). Mandá-la pro leitor da node war, que
     * casa 15 colunas por POSIÇÃO porque o cabeçalho de lá é só de ícones, produziria 15 números
     * embaralhados a partir de 2 — lixo com cara de dado.
     *
     * Os valores já vêm como inteiro do leitor, então não passam por `normalizarValor` (que existe
     * pra "635.1k" e "09:56"): o `raw` vai como texto só pra tabela de revisão mostrar o que foi lido.
     */
    if (ev[0].tipo === "rosas") {
      const linhas = await lerRosas({ data, mediaType });
      const out = linhas.map((l) => ({
        familiaLida: l.familia,
        familia: casar(l.familia),
        valores: {
          kills:  { raw: String(l.abates), valor: l.abates },
          mortes: { raw: String(l.mortes), valor: l.mortes },
        },
      }));
      return NextResponse.json({ linhas: out });
    }

    const linhas = await lerResultado({ data, mediaType });
    const out = linhas.map((l) => ({
      familiaLida: l.familia,
      familia: casar(l.familia),
      valores: Object.fromEntries(Object.entries(l.valores).map(([m, raw]) => [m, { raw, valor: normalizarValor(raw) }])),
    }));
    return NextResponse.json({ linhas: out });
  } catch (e) {
    const msg = (e as Error).message;
    const status = msg.includes("ANTHROPIC_API_KEY") || msg.includes("GEMINI_API_KEY") ? 503 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
