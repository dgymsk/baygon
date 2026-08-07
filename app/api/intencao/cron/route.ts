import { NextResponse } from "next/server";
import { agendasDevidas, marcarDisparo, agoraBR, diaDaGuerra, nomeDoEvento } from "@/lib/agenda";
import { postarIntencao } from "@/lib/intencao";

/**
 * Disparo AGENDADO da chamada de intenção.
 *
 * Quem bate aqui é o WORKER sempre-ligado (worker/gateway.mjs), não o Vercel: o plano Hobby não
 * faz cron sub-diário e a chamada precisa sair na hora certa. Liberado no middleware; a segurança
 * é o CRON_SECRET, igual ao /api/participacao/cron e ao /api/garmoth/refresh.
 */
export const dynamic = "force-dynamic";
const CRON_SECRET = process.env.CRON_SECRET;

async function executar() {
  const devidas = await agendasDevidas();
  const feitos: { preset: string; ok: boolean; erro?: string }[] = [];
  for (const a of devidas) {
    // marca ANTES de postar: se o post falhar a gente perde uma chamada, mas se marcasse depois
    // e o processo morresse no meio, a próxima batida dispararia de novo — e chamada duplicada
    // no canal é pior do que uma que não saiu (esta você reenvia por botão).
    await marcarDisparo(a.id);
    // a chamada agendada sai NO DIA da guerra ("vai participar da war hoje?"), então o evento nasce
    // com a data e o nome do dia do disparo. Quem dispara na véspera usa o token {amanha} no modelo.
    // a chamada sai na VÉSPERA: às 20:20 se pergunta sobre a war de amanhã. O evento é do dia da
    // GUERRA, não do dia em que o bot postou.
    const dia = diaDaGuerra();
    // sem modelo configurado o padrão é a DATA, não o nome da chamada: é assim que a staff nomeia
    // ("2026-08-07"), e todo disparo agendado teria o mesmo nome se caísse no nome do preset
    const r = await postarIntencao(a.preset_id, { titulo: nomeDoEvento(a.nome_padrao || "{data}", dia), data: dia });
    feitos.push({ preset: a.preset_nome, ok: r.ok, erro: r.erro });
  }
  return { ok: true, agora: agoraBR(), devidas: devidas.length, feitos };
}

export async function GET(req: Request) {
  if (!CRON_SECRET || req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  return NextResponse.json(await executar());
}
export const POST = GET;
