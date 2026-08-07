import { sql } from "@/lib/db";
export { hojeBR, amanhaBR, nomeDoEvento } from "@/lib/datas";

/**
 * Agendamento do disparo da chamada. Uma linha por HORÁRIO, com os dias em que vale —
 * "todo dia às 20:20 e às 22:00" são duas linhas.
 *
 * Quem chama isto NÃO é o Vercel: o plano Hobby não faz cron sub-diário, e a chamada precisa
 * sair na hora certa. Quem bate no endpoint é o worker sempre-ligado (o mesmo que já pinga o
 * Garmoth de 2 em 2h) — ver worker/gateway.mjs.
 */
export type Agenda = { id: number; preset_id: number; dias: number[]; hora: string; ativo: boolean; ultimo_disparo: string | null;
  /** modelo do nome do evento; {data} vira o dia do disparo e {amanha} o seguinte. NULL = nome do preset. */
  nome_padrao: string | null };
export type AgendaVM = Agenda & { preset_nome: string; preset_tipo: string };

const num = (v: unknown) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : null; };
const horaOk = (s: unknown) => (typeof s === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.trim()) ? s.trim().padStart(5, "0") : null);
const diasOk = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(num).filter((d): d is number => d != null && d >= 0 && d <= 6))].sort() : []);

export async function listAgendas(): Promise<AgendaVM[]> {
  return (await sql`
    SELECT a.id::int AS id, a.preset_id::int AS preset_id, a.dias, a.hora, a.ativo,
           a.ultimo_disparo::text AS ultimo_disparo, a.nome_padrao, p.nome AS preset_nome, p.tipo AS preset_tipo
    FROM intencao_agenda a JOIN intencao_preset p ON p.id = a.preset_id
    ORDER BY a.hora, p.nome`) as AgendaVM[];
}

export async function criarAgenda(presetId: unknown, dias: unknown, hora: unknown, nomePadrao?: unknown): Promise<AgendaVM | null> {
  const pid = num(presetId), h = horaOk(hora), d = diasOk(dias);
  if (pid == null || !h || !d.length) return null;
  const n = typeof nomePadrao === "string" ? nomePadrao.trim().slice(0, 200) : "";
  await sql`INSERT INTO intencao_agenda (preset_id, dias, hora, nome_padrao) VALUES (${pid}, ${d as unknown as number[]}, ${h}, ${n || null})`;
  return (await listAgendas()).find((a) => a.preset_id === pid && a.hora === h) ?? null;
}

export async function atualizarAgenda(id: unknown, patch: { dias?: unknown; hora?: unknown; ativo?: unknown; nomePadrao?: unknown }): Promise<void> {
  const aid = num(id);
  if (aid == null) return;
  if (patch.dias !== undefined) await sql`UPDATE intencao_agenda SET dias = ${diasOk(patch.dias) as unknown as number[]} WHERE id = ${aid}`;
  const h = horaOk(patch.hora);
  if (h) await sql`UPDATE intencao_agenda SET hora = ${h} WHERE id = ${aid}`;
  if (patch.ativo !== undefined) await sql`UPDATE intencao_agenda SET ativo = ${!!patch.ativo} WHERE id = ${aid}`;
  // vazio é escolha válida ("volta a usar o nome do preset"), por isso o teste é no campo vir
  if (patch.nomePadrao !== undefined) {
    const n = typeof patch.nomePadrao === "string" ? patch.nomePadrao.trim().slice(0, 200) : "";
    await sql`UPDATE intencao_agenda SET nome_padrao = ${n || null} WHERE id = ${aid}`;
  }
}

export async function excluirAgenda(id: unknown): Promise<void> {
  const aid = num(id);
  if (aid != null) await sql`DELETE FROM intencao_agenda WHERE id = ${aid}`;
}

/** Agora em Brasília (UTC-3, sem horário de verão desde 2019) — mesma conta do cron antigo. */
export function agoraBR(ms = Date.now()): { dia: number; hhmm: string; data: string } {
  const br = new Date(ms - 3 * 3600 * 1000);
  const hh = String(br.getUTCHours()).padStart(2, "0");
  const mm = String(br.getUTCMinutes()).padStart(2, "0");
  return { dia: br.getUTCDay(), hhmm: `${hh}:${mm}`, data: br.toISOString().slice(0, 10) };
}

/**
 * Agendas que devem disparar agora. `toleranciaMin` cobre o intervalo do timer: se ele bate de
 * 5 em 5 minutos, um horário exato seria perdido quase sempre. `ultimo_disparo` no MESMO dia BR
 * trava a repetição — sem isso, toda batida dentro da janela dispararia de novo.
 */
export async function agendasDevidas(toleranciaMin = 6, ms = Date.now()): Promise<AgendaVM[]> {
  const { dia, hhmm, data } = agoraBR(ms);
  const minAgora = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  const todas = await listAgendas();
  return todas.filter((a) => {
    if (!a.ativo || !a.dias.includes(dia)) return false;
    const alvo = Number(a.hora.slice(0, 2)) * 60 + Number(a.hora.slice(3));
    const atraso = minAgora - alvo;
    if (atraso < 0 || atraso > toleranciaMin) return false; // só dispara DEPOIS da hora, e dentro da janela
    if (a.ultimo_disparo) {
      const ultimoBR = agoraBR(new Date(a.ultimo_disparo).getTime());
      if (ultimoBR.data === data) return false; // já saiu hoje
    }
    return true;
  });
}

export async function marcarDisparo(id: number): Promise<void> {
  await sql`UPDATE intencao_agenda SET ultimo_disparo = now() WHERE id = ${id}`;
}
