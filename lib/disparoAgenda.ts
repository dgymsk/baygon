import { agendasDevidas, marcarDisparo, agoraBR, diaDaGuerra, nomeDoEvento } from "@/lib/agenda";
import { postarIntencao } from "@/lib/intencao";
import { getCronConfig, registrarExec, type Origem } from "@/lib/cronLog";

/**
 * O DISPARO DA CHAMADA AGENDADA — um lugar só, três portas de entrada.
 *
 *   worker  — bate de 5 em 5 minutos e acerta o horário; é dele a precisão;
 *   vercel  — o cron, rede de segurança pra quando o worker está fora do ar;
 *   manual  — o botão "rodar agora" da tela, pra staff conferir sem esperar a hora.
 *
 * Ficava dentro do route handler, e por isso o botão da tela teria que chamar o próprio endpoint por
 * HTTP levando o CRON_SECRET até o navegador. Aqui, a tela chama a função.
 */
export const ENDPOINT_AGENDA = "/api/intencao/cron";

/**
 * A janela do WORKER é curta de propósito: ele bate a cada 5 minutos, então 6 minutos cobrem o
 * intervalo inteiro — e janela curta é o que impede uma chamada de sair fora de hora quando o
 * processo volta depois de um tempo parado.
 *
 * As outras duas origens usam a tolerância da config (padrão 2h), que a staff regula na tela: o cron
 * da Vercel chega a qualquer minuto da hora marcada e só tem uma chance por hora.
 */
export const TOLERANCIA_WORKER = 6;

export type ResultadoDisparo = {
  ok: boolean;
  agora: ReturnType<typeof agoraBR>;
  toleranciaMin: number;
  devidas: number;
  feitos: { preset: string; ok: boolean; erro?: string }[];
  /** true = a rede de segurança está desligada na tela; a batida foi registrada e nada foi postado. */
  desligado?: boolean;
};

export async function dispararAgendaDevida(o: { origem: Origem; agendamento?: string | null; quem?: string | null }): Promise<ResultadoDisparo> {
  const t0 = Date.now();
  const cfg = await getCronConfig();
  const toleranciaMin = o.origem === "worker" ? TOLERANCIA_WORKER : cfg.toleranciaMin;

  /**
   * DESLIGAR vale só pra Vercel. O worker é o disparo principal e o botão é a mão da staff — parar
   * esses dois pelo mesmo interruptor transformaria "desligue a rede de segurança" em "a chamada não
   * sai mais", que é o contrário do que quem clica quer.
   */
  if (o.origem === "vercel" && !cfg.ativo) {
    const r: ResultadoDisparo = { ok: true, agora: agoraBR(), toleranciaMin, devidas: 0, feitos: [], desligado: true };
    await registrarExec({ endpoint: ENDPOINT_AGENDA, origem: o.origem, agendamento: o.agendamento, ms: Date.now() - t0, ok: true, devidas: 0, resultado: r });
    return r;
  }

  try {
    const devidas = await agendasDevidas(toleranciaMin);
    const feitos: { preset: string; ok: boolean; erro?: string }[] = [];
    for (const a of devidas) {
      // marca ANTES de postar: se o post falhar a gente perde uma chamada, mas se marcasse depois e
      // o processo morresse no meio, a próxima batida dispararia de novo — e chamada duplicada no
      // canal é pior do que uma que não saiu (esta você reenvia por botão).
      await marcarDisparo(a.id);
      // a chamada sai na VÉSPERA: às 20:20 se pergunta sobre a war de amanhã. O evento é do dia da
      // GUERRA, não do dia em que o bot postou.
      const dia = diaDaGuerra();
      // sem modelo configurado o padrão é a DATA, não o nome do preset: é assim que a staff nomeia
      const r = await postarIntencao(a.preset_id, { titulo: nomeDoEvento(a.nome_padrao || "{data}", dia), data: dia });
      feitos.push({ preset: a.preset_nome, ok: r.ok, erro: r.erro });
    }
    const res: ResultadoDisparo = { ok: true, agora: agoraBR(), toleranciaMin, devidas: devidas.length, feitos };
    await registrarExec({
      endpoint: ENDPOINT_AGENDA, origem: o.origem, agendamento: o.agendamento, quem: o.quem,
      ms: Date.now() - t0, ok: feitos.every((f) => f.ok), devidas: devidas.length, resultado: res,
      erro: feitos.find((f) => !f.ok)?.erro ?? null,
    });
    return res;
  } catch (e) {
    // registra a falha ANTES de propagar: batida que estourou é exatamente a que a staff precisa ver
    await registrarExec({
      endpoint: ENDPOINT_AGENDA, origem: o.origem, agendamento: o.agendamento, quem: o.quem,
      ms: Date.now() - t0, ok: false, erro: (e as Error).message,
    });
    throw e;
  }
}
