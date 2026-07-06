import { NextResponse } from "next/server";
import { getParticipacaoConfig, postarMensagem, postsAtivos } from "@/lib/participacao";
import { listTemplates } from "@/lib/participacaoPt";
import { TIPOS } from "@/lib/participacaoConfig";

// Disparo AGENDADO. Chamado pelo Vercel Cron (Authorization: Bearer <CRON_SECRET>).
// Liberado no middleware; a segurança é o CRON_SECRET.
export const dynamic = "force-dynamic";
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: Request) {
  if (!CRON_SECRET || req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  const cfg = await getParticipacaoConfig();

  // horário de Brasília (UTC-3; sem horário de verão desde 2019)
  const nowMs = Date.now();
  const dataBR = (ms: number) => new Date(ms - 3 * 3600 * 1000).toISOString().slice(0, 10); // YYYY-MM-DD em BR
  const br = new Date(nowMs - 3 * 3600 * 1000);
  const dia = br.getUTCDay();    // 0=dom..6=sáb (em BR)
  const hora = br.getUTCHours();
  const hojeBR = dataBR(nowMs);

  const [posts, templates] = await Promise.all([postsAtivos(), listTemplates()]);
  // dedup por DATA (BR): não auto-posta um tipo se já houve QUALQUER post dele hoje (manual ou auto)
  const jaPostouHoje = (tipo: string) => posts.some((p) => p.tipo === tipo && dataBR(new Date(p.criado).getTime()) === hojeBR);

  const feitos: string[] = [];
  for (const tipo of TIPOS) {
    const a = cfg[tipo].agenda;
    const hAgenda = Number(a.hora.split(":")[0]); // agenda é por HORA (o cron roda de hora em hora)
    if (a.ativo && a.dias.includes(dia) && hora === hAgenda && !jaPostouHoje(tipo)) {
      const tpl = templates.find((x) => x.tipo === tipo); // usa o 1º template do tipo
      if (tpl) { const r = await postarMensagem(tpl.id); if (r.ok) feitos.push(tipo); }
    }
  }
  return NextResponse.json({ ok: true, feitos, br: `dia ${dia} ${hora}h` });
}
