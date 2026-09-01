import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { atualizarTodos } from "@/lib/garmoth";
import { registrarExec } from "@/lib/cronLog";

/**
 * Busca a gear de todo mundo no Garmoth e atualiza `garmoth_build`.
 *
 * TRÊS chamadores, e é por isso que aceita os dois verbos:
 *   GET  — o CRON DA VERCEL, de 2 em 2 horas (vercel.json). Cron sempre chama em GET;
 *   POST — o worker sempre-ligado (mesma cadência) e o botão da staff.
 *
 * Liberado no middleware; a segurança é o CRON_SECRET (automático) ou requireEditor (staff).
 *
 * Cada rodada fica registrada em `cron_exec`, como a da agenda: é o que faz o painel do /hub
 * responder "quando a gear foi atualizada pela última vez?" sem depender do log da Vercel. Foi
 * exatamente essa pergunta que ficou sem resposta quando o worker passou semanas fora do ar e o
 * gear de todo mundo congelou sem ninguém notar.
 */
export const dynamic = "force-dynamic";
/** Plano Pro: o teto é 300s. São ~240 buscas na API do Garmoth em lotes; 60s já apertava. */
export const maxDuration = 300;
const CRON_SECRET = process.env.CRON_SECRET;
const ENDPOINT = "/api/garmoth/refresh";

async function executar(req: Request, origem: "vercel" | "worker" | "manual") {
  const t0 = Date.now();
  try {
    const r = await atualizarTodos();
    await registrarExec({
      endpoint: ENDPOINT, origem, agendamento: req.headers.get("x-vercel-cron-schedule"),
      ms: Date.now() - t0,
      /**
       * FALHA é só o que impediu de GRAVAR. `semRetorno` (gente sem build no Garmoth) entra em
       * `erros` e é rotina — marcar a rodada como falhada por causa disso pintaria o painel de
       * vermelho todo dia e ensinaria a staff a ignorar o vermelho.
       */
      ok: (r.falhasGravacao?.length ?? 0) === 0,
      devidas: r.pedidos ?? 0, resultado: r,
      erro: r.falhasGravacao?.length ? `${r.falhasGravacao.length} não gravou: ${String(r.falhasGravacao[0]).slice(0, 100)}` : null,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const msg = (e as Error).message;
    await registrarExec({ endpoint: ENDPOINT, origem, ms: Date.now() - t0, ok: false, erro: msg });
    return NextResponse.json({ error: msg }, { status: msg.includes("GARMOTH_API_KEY") ? 503 : 500 });
  }
}

/** O segredo bate? Então é automático — e o header da Vercel diz qual dos dois. */
function origemDe(req: Request): "vercel" | "worker" | null {
  if (!CRON_SECRET || req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) return null;
  return req.headers.get("x-vercel-cron-schedule") != null
    || (req.headers.get("user-agent") ?? "").includes("vercel-cron") ? "vercel" : "worker";
}

export async function GET(req: Request) {
  const origem = origemDe(req);
  if (!origem) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  return executar(req, origem);
}

export async function POST(req: Request) {
  const origem = origemDe(req);
  if (!origem) {
    const unauth = await requireEditor();
    if (unauth) return unauth;
  }
  return executar(req, origem ?? "manual");
}
