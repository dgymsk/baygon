import { NextResponse } from "next/server";
import { agendasDevidas, marcarDisparo, agoraBR, diaDaGuerra, nomeDoEvento } from "@/lib/agenda";
import { postarIntencao } from "@/lib/intencao";

/**
 * Disparo AGENDADO da chamada de intenção. Tem DOIS chamadores, e eles são diferentes.
 *
 * O WORKER sempre-ligado (worker/gateway.mjs) bate de 5 em 5 minutos e acerta o horário: é ele quem
 * dá a precisão de que a chamada precisa (sai 20:20 na véspera).
 *
 * O CRON DA VERCEL é a rede de segurança — e existe porque worker sempre-ligado cai, e quando cai
 * ninguém percebe até a chamada não sair. No plano Hobby ele roda UMA vez por dia por entrada, e a
 * Vercel escolhe o minuto dentro da hora marcada: "0 23 * * *" pode disparar às 23:59. Por isso as
 * seis entradas em vercel.json (uma por hora da noite, cada uma diária — sub-diário FALHA o deploy
 * no Hobby) e a tolerância maior abaixo. Num plano Pro, aquelas seis viram uma só de cinco em cinco
 * minutos, e o polling do worker vira redundância.
 *
 * (A expressão de cinco minutos não aparece escrita aqui de propósito: ela contém a sequência que
 * FECHA um bloco de comentário, e o erro que isso gera aponta pra outra linha.)
 *
 * Liberado no middleware; a segurança é o CRON_SECRET — a Vercel manda o valor dessa env
 * automaticamente no header Authorization, no mesmo formato que o worker já usa, então o mesmo
 * cheque serve pros dois.
 */
export const dynamic = "force-dynamic";
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * A JANELA DE ATRASO ACEITÁVEL, por chamador.
 *
 * 6 minutos casa com o worker, que bate a cada 5: janela curta é o que impede uma chamada de sair
 * fora de hora quando o processo volta depois de um tempo parado.
 *
 * 120 minutos é pro cron, que chega a qualquer minuto da hora marcada e só tem uma chance por hora.
 * O teto existe porque chamada atrasada demais é pior que chamada nenhuma — perguntar às 23h se a
 * pessoa vai jogar amanhã não dá tempo de a staff montar escalação com a resposta.
 *
 * Duplicar não é risco: `marcarDisparo` carimba `ultimo_disparo` e `agendasDevidas` recusa agenda
 * que já saiu no mesmo dia BR. É a "idempotência por reconciliação" que a própria doc do cron
 * recomenda, já que a entrega dela pode faltar OU repetir.
 */
const TOLERANCIA_WORKER = 6;
const TOLERANCIA_CRON = 120;

async function executar(toleranciaMin: number) {
  const devidas = await agendasDevidas(toleranciaMin);
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
  return { ok: true, agora: agoraBR(), toleranciaMin, devidas: devidas.length, feitos };
}

export async function GET(req: Request) {
  if (!CRON_SECRET || req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  // quem chamou: a Vercel carimba o horário que disparou em `x-vercel-cron-schedule` e se
  // identifica no user-agent. Qualquer um dos dois serve; o worker não manda nenhum.
  const daVercel = req.headers.get("x-vercel-cron-schedule") != null
    || (req.headers.get("user-agent") ?? "").includes("vercel-cron");
  return NextResponse.json(await executar(daVercel ? TOLERANCIA_CRON : TOLERANCIA_WORKER));
}
export const POST = GET;
