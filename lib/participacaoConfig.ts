/**
 * Config do BOT DE PARTICIPAÇÃO próprio (área /participacao), por TIPO de war.
 * Tudo configurável (canal, textos, cargo a mencionar, agenda) — nada chumbado.
 * Puro (sem imports de servidor) — usável no client.
 */
export type Agenda = { ativo: boolean; dias: number[]; hora: string }; // dias 0=dom..6=sáb; hora "HH:MM" (Brasília)
export type TipoCfg = { channelId: string; titulo: string; mensagem: string; pingRoleId: string; imagem: string; agenda: Agenda };
export type ParticipacaoConfig = { nodewar: TipoCfg; siege: TipoCfg };

export const TIPOS = ["nodewar", "siege"] as const;
export type Tipo = (typeof TIPOS)[number];
export const ehTipo = (t: unknown): t is Tipo => t === "nodewar" || t === "siege";
export const rotuloTipo = (t: Tipo) => (t === "siege" ? "Siege" : "Nodewar");

function tipoPadrao(label: string): TipoCfg {
  return { channelId: "", titulo: `Participação — ${label}`, mensagem: "Vai participar da war hoje? Marque abaixo.", pingRoleId: "", imagem: "", agenda: { ativo: false, dias: [], hora: "20:00" } };
}
const urlOk = (s: unknown) => (typeof s === "string" && /^https?:\/\/\S{1,500}$/.test(s.trim()) ? s.trim() : "");
export function configPadrao(): ParticipacaoConfig {
  return { nodewar: tipoPadrao("Nodewar"), siege: tipoPadrao("Siege") };
}

const soDigitos = (s: unknown, max = 25) => (typeof s === "string" ? s.replace(/[^0-9]/g, "").slice(0, max) : "");
const texto = (s: unknown, max: number, def = "") => (typeof s === "string" ? s.slice(0, max) : def);
const horaOk = (s: unknown) => (typeof s === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.trim()) ? s.trim() : "20:00");

function sanTipo(raw: unknown, pad: TipoCfg): TipoCfg {
  const r = (raw ?? {}) as Partial<TipoCfg> & { agenda?: Partial<Agenda> };
  const a = (r.agenda ?? {}) as Partial<Agenda>;
  const dias = Array.isArray(a.dias) ? [...new Set(a.dias.map((d) => Math.trunc(Number(d))).filter((d) => d >= 0 && d <= 6))].sort((x, y) => x - y) : [];
  return {
    channelId: soDigitos(r.channelId),
    titulo: texto(r.titulo, 100, pad.titulo).trim() || pad.titulo,
    mensagem: texto(r.mensagem, 1500, pad.mensagem),
    pingRoleId: soDigitos(r.pingRoleId),
    imagem: urlOk((r as { imagem?: unknown }).imagem),
    agenda: { ativo: a.ativo === true, dias, hora: horaOk(a.hora) },
  };
}

/** Parseia/sanitiza a config (do banco ou do cliente) com defaults. */
export function parseParticipacaoConfig(raw: unknown): ParticipacaoConfig {
  let obj: unknown = raw;
  if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { obj = null; } }
  const o = (obj ?? {}) as Partial<ParticipacaoConfig>;
  const pad = configPadrao();
  return { nodewar: sanTipo(o.nodewar, pad.nodewar), siege: sanTipo(o.siege, pad.siege) };
}
