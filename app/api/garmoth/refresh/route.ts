import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { atualizarTodos } from "@/lib/garmoth";

// POST /api/garmoth/refresh — busca a gear de todo mundo no Garmoth e atualiza garmoth_build.
// Disparado pelo WORKER a cada 2h (Authorization: Bearer CRON_SECRET) OU pelo botão da staff (sessão).
// Liberado no middleware; a segurança é o CRON_SECRET (worker) ou requireEditor (staff).
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const CRON_SECRET = process.env.CRON_SECRET;

export async function POST(req: Request) {
  const viaCron = !!CRON_SECRET && req.headers.get("authorization") === `Bearer ${CRON_SECRET}`;
  if (!viaCron) {
    const unauth = await requireEditor();
    if (unauth) return unauth;
  }
  try {
    const r = await atualizarTodos();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: msg.includes("GARMOTH_API_KEY") ? 503 : 500 });
  }
}
