/**
 * Datas do disparo — PURO, importável no client.
 *
 * Vive num módulo próprio porque o servidor (cron) e a tela (Lançar) precisam do MESMO cálculo:
 * duas cópias divergindo é o tipo de bug que só aparece na virada do dia. E o fuso é sempre o de
 * São Paulo, não o do navegador de quem está olhando — quem decide o dia é a guerra, não o cliente.
 *
 * A CHAMADA SAI NA VÉSPERA: às 20:20 o bot pergunta sobre a node war do dia SEGUINTE. Por isso o
 * evento é datado e batizado com o dia da guerra (`{data}` = amanhã), e não com o dia em que a
 * mensagem foi postada — datar pelo disparo erra por um dia na ordem do hub, na janela de faltas e
 * no nome que a staff usa. Quem precisar do dia do disparo tem o token `{hoje}`.
 */
const emSP = (base: Date) => new Date(base.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Hoje em São Paulo, YYYY-MM-DD — o dia em que a chamada é postada. */
export function hojeBR(base = new Date()): string {
  return iso(emSP(base));
}

/** O dia seguinte em São Paulo — o DIA DA GUERRA de uma chamada disparada hoje. */
export function amanhaBR(base = new Date()): string {
  const d = emSP(base);
  d.setDate(d.getDate() + 1);
  return iso(d);
}

/** Apelido de `amanhaBR` no vocabulário de quem lê: o dia da guerra da chamada que sai agora. */
export const diaDaGuerra = amanhaBR;

/**
 * Resolve o modelo do nome. Sem modelo devolve null, e quem chama cai no nome do preset.
 * Tokens: `{data}` = o dia da guerra (o seguinte ao disparo), `{hoje}` = o dia do disparo.
 */
export function nomeDoEvento(modelo: string | null | undefined, data = diaDaGuerra(), hoje = hojeBR()): string | null {
  const m = (modelo ?? "").trim();
  if (!m) return null;
  return m.replace(/\{data\}/gi, data).replace(/\{hoje\}/gi, hoje).slice(0, 200);
}
