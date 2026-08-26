import { NextResponse } from "next/server";
import { dispararAgendaDevida } from "@/lib/disparoAgenda";

/**
 * Disparo AGENDADO da chamada de intenção. Tem DOIS chamadores automáticos, e eles são diferentes.
 *
 * O WORKER sempre-ligado (worker/gateway.mjs) bate de 5 em 5 minutos e acerta o horário: é ele quem
 * dá a precisão de que a chamada precisa (sai 20:20 na véspera).
 *
 * O CRON DA VERCEL é a rede de segurança — e existe porque worker sempre-ligado cai, e quando cai
 * ninguém percebe até a chamada não sair. No plano Hobby ele roda UMA vez por dia por entrada, e a
 * Vercel escolhe o minuto dentro da hora marcada: "0 23 * * *" pode disparar às 23:59. Por isso as
 * seis entradas em vercel.json (uma por hora da noite, cada uma diária — sub-diário FALHA o deploy
 * no Hobby) e a tolerância maior, que a staff regula em /hub sem precisar de deploy.
 *
 * Liberado no middleware; a segurança é o CRON_SECRET — a Vercel manda o valor dessa env
 * automaticamente no header Authorization, no mesmo formato que o worker já usa, então o mesmo
 * cheque serve pros dois.
 *
 * A lógica em si mora em lib/disparoAgenda, porque o botão "rodar agora" da tela precisa dela sem
 * passar por HTTP (e sem o segredo chegar ao navegador). Cada batida fica registrada em `cron_exec`.
 */
export const dynamic = "force-dynamic";
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: Request) {
  if (!CRON_SECRET || req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  // quem chamou: a Vercel carimba a expressão que disparou em `x-vercel-cron-schedule` e se
  // identifica no user-agent. O worker não manda nenhum dos dois.
  const agendamento = req.headers.get("x-vercel-cron-schedule");
  const daVercel = agendamento != null || (req.headers.get("user-agent") ?? "").includes("vercel-cron");
  return NextResponse.json(await dispararAgendaDevida({ origem: daVercel ? "vercel" : "worker", agendamento }));
}
export const POST = GET;
