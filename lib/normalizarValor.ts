/**
 * Normaliza um valor de célula do print de resultado da war para NÚMERO cru, do jeito
 * que o modelo de dados espera (desempenho.valor). Puro (sem imports de servidor) — o
 * mesmo cálculo roda no client (preview da revisão) e no servidor (gravação).
 *   "635.1k" -> 635100 · "6.7M" -> 6700000 · "1.2B" -> 1200000000
 *   "09:56"  -> 596 (segundos) · "1:09:56" -> 4196
 *   "1.234"/"1,234" (milhar) -> 1234 · "12,5" (decimal) -> 12.5 · "-"/vazio -> null
 */
export function normalizarValor(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (!s || /^[-–—]+$/.test(s) || /^n\/?a$/i.test(s)) return null;
  s = s.replace(/\s+/g, "");
  if (/^[-–—]/.test(s)) return null; // negativo não faz sentido nas métricas de war → sinaliza p/ o revisor

  // tempo mm:ss ou hh:mm:ss -> segundos (aceita minutos de até 3 dígitos; valida segundos/minutos < 60)
  if (/^\d{1,3}:[0-5]?\d(:[0-5]?\d)?$/.test(s)) {
    return s.split(":").map(Number).reduce((acc, n) => acc * 60 + n, 0);
  }
  if (s.includes(":")) return null; // parece tempo mas é malformado (ex.: 10:99) → null, não vira número torto

  // número + sufixo multiplicador opcional
  const m = s.match(/^([\d.,]+)(k|mil|m|mi|mm|kk|b|bi)?$/i);
  const corpo = m ? m[1] : s.replace(/[^\d.,]/g, "");
  const num = parseNum(corpo);
  if (num == null) return null;
  const suf = (m?.[2] ?? "").toLowerCase();
  const mult = suf === "" ? 1
    : suf === "k" || suf === "mil" ? 1e3
    : suf === "b" || suf === "bi" ? 1e9
    : 1e6; // m / mi / mm / kk
  return num * mult;
}

/** Interpreta separadores (. e ,) decidindo qual é decimal e qual é milhar. */
function parseNum(s: string): number | null {
  s = s.trim();
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let norm: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // ambos presentes: o que aparece por último é o decimal, o outro é milhar
    const dec = lastDot > lastComma ? "." : ",";
    const mil = dec === "." ? "," : ".";
    norm = s.split(mil).join("").replace(dec, ".");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = s.split(sep);
    // grupos de 3 depois do separador (e <=3 antes) = milhar; senão = decimal
    const pareceMilhar = parts.length > 1 && parts.slice(1).every((p) => p.length === 3) && parts[0].length <= 3 && parts.length <= 4;
    norm = pareceMilhar ? parts.join("") : s.replace(sep, ".");
  } else {
    norm = s;
  }
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}
