/**
 * Datas do disparo — PURO, importável no client.
 *
 * Vive num módulo próprio porque o servidor (cron) e a tela (Lançar) precisam do MESMO cálculo:
 * duas cópias divergindo é o tipo de bug que só aparece na virada do dia. E o fuso é sempre o de
 * São Paulo, não o do navegador de quem está olhando — quem decide o dia é a guerra, não o cliente.
 *
 * O nome do evento sai com a data do DIA DO DISPARO. A chamada agendada sai no mesmo dia da war
 * ("vai participar da war hoje?"), então `{data}` = hoje. Quem agenda na véspera tem `{amanha}`.
 */
const emSP = (base: Date) => new Date(base.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Hoje em São Paulo, YYYY-MM-DD — o dia em que a chamada sai. */
export function hojeBR(base = new Date()): string {
  return iso(emSP(base));
}

/** O dia seguinte em São Paulo — pra quem dispara a chamada na véspera da guerra. */
export function amanhaBR(base = new Date()): string {
  const d = emSP(base);
  d.setDate(d.getDate() + 1);
  return iso(d);
}

/**
 * Resolve o modelo do nome. Sem modelo devolve null, e quem chama cai no nome do preset.
 * Tokens: `{data}` = o dia do disparo, `{amanha}` = o dia seguinte.
 */
export function nomeDoEvento(modelo: string | null | undefined, data = hojeBR(), amanha = amanhaBR()): string | null {
  const m = (modelo ?? "").trim();
  if (!m) return null;
  return m.replace(/\{data\}/gi, data).replace(/\{amanha\}/gi, amanha).slice(0, 200);
}
