import { METRICAS_RESULTADO, type FormatoMetrica } from "@/lib/metricasResultado";

/**
 * O caminho de volta do `normalizarValor`: o banco guarda número puro (484200, 2885 segundos) e a
 * tela precisa mostrar do jeito que o jogo mostra ("484.2k", "48:05").
 *
 * Guardar cru e formatar na exibição é de propósito — somar, tirar média e ordenar só funcionam com
 * número, e reconverter na ponta custa nada.
 */
const FORMATO = new Map<string, FormatoMetrica>(METRICAS_RESULTADO.map((m) => [m.metrica, m.formato]));

/** 484200 → "484.2k" · 6300000 → "6.3M". Abaixo de 10 mil não abrevia (perderia precisão à toa). */
export function abreviar(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (a >= 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

/** 2885 → "48:05". Passa a hh:mm:ss sozinho quando estoura 60 min (siege é longa). */
export function segParaTempo(seg: number): string {
  const s = Math.max(0, Math.round(seg));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
}

/** Valor de uma métrica no formato da tela do jogo. `null`/ausente vira "—", que é diferente de 0. */
export function formatarMetrica(metrica: string, valor: number | null | undefined): string {
  if (valor == null || !Number.isFinite(valor)) return "—";
  switch (FORMATO.get(metrica)) {
    case "tempo": return segParaTempo(valor);
    case "abreviado": return abreviar(valor);
    default: return valor.toLocaleString("pt-BR");
  }
}
