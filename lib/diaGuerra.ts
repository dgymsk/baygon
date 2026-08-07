/**
 * O dia da GUERRA de um disparo — PURO, importável no client.
 *
 * Sempre o dia SEGUINTE: a chamada sai na véspera. É o desenho desde o Apollo, que posta às 20:20
 * a war de amanhã, e é por isso que datar o evento com "hoje" erra por um dia — o que estraga a
 * ordem do hub, a janela de faltas e o nome que a staff quer dar ("2026-08-07").
 *
 * Vive num módulo próprio porque o servidor (cron) e a tela (Lançar) precisam do MESMO cálculo:
 * duas cópias divergindo é o tipo de bug que só aparece na virada do dia.
 */
export function diaDaGuerra(base = new Date()): string {
  const br = new Date(base.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  br.setDate(br.getDate() + 1);
  return `${br.getFullYear()}-${String(br.getMonth() + 1).padStart(2, "0")}-${String(br.getDate()).padStart(2, "0")}`;
}

/** Resolve o modelo do nome. Sem modelo devolve null, e quem chama cai no nome do preset. */
export function nomeDoEvento(modelo: string | null | undefined, data = diaDaGuerra()): string | null {
  const m = (modelo ?? "").trim();
  if (!m) return null;
  return m.replace(/\{data\}/gi, data).slice(0, 200);
}
