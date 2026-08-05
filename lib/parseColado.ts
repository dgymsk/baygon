import { METRICAS_RESULTADO } from "./metricasResultado";

export type LinhaColada = { familia: string; valores: Record<string, string> };

const CABECALHO = new Set(["familia", "família", "nome", "name", "personagem", "jogador", "player", "family"]);
const EH_TEMPO = /^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/;

/**
 * Parse do bloco colado (TSV do Google Sheets — ou colunas separadas por espaço).
 *
 * As 15 métricas vêm na ORDEM CANÔNICA de METRICAS_RESULTADO, mas quantas colunas existem ANTES
 * delas varia: a tela do jogo tem Nome + Classe + 15 (=17), e uma planilha montada à mão costuma ter
 * Nome + 15 (=16). Antes isto assumia 16 sempre; um TSV de 17 deslizava tudo uma casa e ainda assim
 * preenchia as 15 chaves — a war inteira entrava trocada, sem uma única mensagem de erro.
 *
 * Por isso as métricas são lidas a partir do FIM (as 15 últimas colunas) e o que sobra na frente é
 * o nome. E a linha só é aceita se as duas últimas colunas forem mm:ss, que são as únicas métricas
 * nesse formato: sem essa conferência, um layout diferente viraria uma war inteira errada em vez de
 * uma linha recusada.
 *
 * Puro (client-safe). Não normaliza os valores (deixa cru p/ normalizarValor + revisão humana).
 */
export function parseColado(texto: string): LinhaColada[] {
  const metricas = METRICAS_RESULTADO.map((m) => m.metrica);
  const N = metricas.length;
  const out: LinhaColada[] = [];

  for (const linha of (texto ?? "").split(/\r?\n/)) {
    if (!linha.trim()) continue;
    const comTab = linha.includes("\t");
    const toks = (comTab ? linha.split("\t") : linha.trim().split(/\s+/)).map((c) => c.trim());
    if (toks.length < N + 1) continue;                       // não cabe nem nome + 15
    const primeiro = toks[0] ?? "";
    if (!primeiro || CABECALHO.has(primeiro.toLowerCase())) continue;

    const vals = toks.slice(-N);
    let cabeca = toks.slice(0, toks.length - N).filter(Boolean);
    // a coluna de Classe entra entre nome e métricas quando o TSV vem da tela do jogo. Só cai fora
    // em TSV — sem tabs não dá pra distinguir classe de sobrenome ("Dark Knight" vs "Dark" "Knight")
    if (comTab && cabeca.length > 1) cabeca = cabeca.slice(0, 1);
    const familia = cabeca.join(" ").trim();
    if (!familia || CABECALHO.has(familia.toLowerCase())) continue;

    // âncora de alinhamento: tempo_morto e tempo_sobrevivencia são as duas últimas e as únicas mm:ss
    if (!EH_TEMPO.test(vals[N - 2] ?? "") || !EH_TEMPO.test(vals[N - 1] ?? "")) continue;

    const valores: Record<string, string> = {};
    for (let i = 0; i < N; i++) {
      const v = vals[i] ?? "";
      if (v) valores[metricas[i]] = v;
    }
    out.push({ familia, valores });
  }
  return out;
}
