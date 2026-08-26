import { sql } from "@/lib/db";

/**
 * O EXTRATO DAS EXECUÇÕES AUTOMÁTICAS — e o pouco que dá pra controlar sem deploy.
 *
 * Cron da Vercel se configura no vercel.json e só muda com deploy; o painel dela tem um botão que
 * desliga TODOS de uma vez. Isso é controle grosso demais pra uma guilda: o que a staff precisa
 * saber é "rodou hoje?", "o que ele fez?" e "posso desligar essa rede de segurança sem esperar
 * deploy?". As três respostas moram aqui.
 *
 * O registro é gravado SEMPRE, inclusive quando não havia nada vencido — "rodou e não tinha o que
 * fazer" é informação, e é diferente de "não rodou". Foi a distinção que faltou quando o worker
 * ficou fora do ar sem ninguém notar.
 */
export type Origem = "vercel" | "worker" | "manual";

export type CronExec = {
  id: number;
  endpoint: string;
  origem: Origem;
  agendamento: string | null;
  quem: string | null;
  inicio: string;
  ms: number | null;
  ok: boolean;
  devidas: number;
  resultado: unknown;
  erro: string | null;
};

export type CronConfig = { ativo: boolean; toleranciaMin: number };

/** Config da rede de segurança. Linha única; se sumir, o padrão é ligada com 2h de tolerância. */
export async function getCronConfig(): Promise<CronConfig> {
  const r = (await sql`SELECT ativo, tolerancia_min::int AS tol FROM cron_config WHERE id = 1`) as { ativo: boolean; tol: number }[];
  return { ativo: r[0]?.ativo ?? true, toleranciaMin: r[0]?.tol ?? 120 };
}

export async function setCronConfig(patch: { ativo?: unknown; toleranciaMin?: unknown }): Promise<CronConfig> {
  if (patch.ativo !== undefined) {
    await sql`UPDATE cron_config SET ativo = ${Boolean(patch.ativo)}, atualizado = now() WHERE id = 1`;
  }
  if (patch.toleranciaMin !== undefined) {
    // teto de 6h e piso de 5min: acima disso a chamada sairia tão atrasada que atrapalha em vez de
    // salvar, e abaixo a rede não pega nada, porque o cron chega a qualquer minuto da hora marcada
    const n = Math.max(5, Math.min(360, Math.trunc(Number(patch.toleranciaMin)) || 120));
    await sql`UPDATE cron_config SET tolerancia_min = ${n}, atualizado = now() WHERE id = 1`;
  }
  return getCronConfig();
}

/** Grava a batida. Nunca deixa o registro derrubar o trabalho: o disparo importa mais que o log. */
export async function registrarExec(e: {
  endpoint: string; origem: Origem; agendamento?: string | null; quem?: string | null;
  ms: number; ok: boolean; devidas?: number; resultado?: unknown; erro?: string | null;
}): Promise<void> {
  try {
    await sql`INSERT INTO cron_exec (endpoint, origem, agendamento, quem, ms, ok, devidas, resultado, erro)
              VALUES (${e.endpoint}, ${e.origem}, ${e.agendamento ?? null}, ${e.quem ?? null},
                      ${Math.round(e.ms)}, ${e.ok}, ${e.devidas ?? 0},
                      ${JSON.stringify(e.resultado ?? null)}::jsonb, ${e.erro ?? null})`;
  } catch (err) {
    console.error("cron_exec não gravou:", (err as Error).message);
  }
}

/** As últimas batidas, pra tela. */
export async function ultimasExecs(limite = 20): Promise<CronExec[]> {
  return (await sql`
    SELECT id::int AS id, endpoint, origem, agendamento, quem, inicio::text AS inicio,
           ms::int AS ms, ok, devidas::int AS devidas, resultado, erro
    FROM cron_exec ORDER BY inicio DESC LIMIT ${Math.max(1, Math.min(100, limite))}`) as CronExec[];
}

export type ResumoCron = {
  endpoint: string;
  ultima: string | null;
  ultimaOrigem: Origem | null;
  ultimaOk: boolean | null;
  /** Batidas nas últimas 24h, por origem — é como se vê que o worker está vivo. */
  vercel24h: number;
  worker24h: number;
  falhas24h: number;
};

/**
 * Um resumo por endpoint. `vercel24h` e `worker24h` separados de propósito: é assim que a tela
 * mostra, sem ninguém abrir log nenhum, que o worker parou de bater — o número dele zera e o da
 * Vercel continua.
 */
export async function resumoCron(): Promise<ResumoCron[]> {
  return (await sql`
    SELECT endpoint,
           max(inicio)::text AS ultima,
           (array_agg(origem ORDER BY inicio DESC))[1] AS "ultimaOrigem",
           (array_agg(ok     ORDER BY inicio DESC))[1] AS "ultimaOk",
           count(*) FILTER (WHERE origem = 'vercel' AND inicio > now() - interval '24 hours')::int AS "vercel24h",
           count(*) FILTER (WHERE origem = 'worker' AND inicio > now() - interval '24 hours')::int AS "worker24h",
           count(*) FILTER (WHERE NOT ok          AND inicio > now() - interval '24 hours')::int AS "falhas24h"
    FROM cron_exec GROUP BY endpoint ORDER BY endpoint`) as ResumoCron[];
}
