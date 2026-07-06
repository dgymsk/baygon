import { METRICAS_RESULTADO } from "./metricasResultado";

export type LinhaColada = { familia: string; valores: Record<string, string> };

const CABECALHO = new Set(["familia", "família", "nome", "name", "personagem", "jogador", "player", "family"]);

/**
 * Parse do bloco colado (TSV do Google Sheets — ou colunas separadas por espaço).
 * Coluna 0 = família; as 15 seguintes = métricas na ORDEM CANÔNICA (igual ao CSV/`metricas`).
 * Puro (client-safe). Não normaliza os valores (deixa cru p/ normalizarValor + revisão humana).
 * Ignora linhas vazias e o cabeçalho (1ª coluna = palavra de cabeçalho conhecida).
 */
export function parseColado(texto: string): LinhaColada[] {
  const metricas = METRICAS_RESULTADO.map((m) => m.metrica);
  const out: LinhaColada[] = [];
  for (const linha of (texto ?? "").split(/\r?\n/)) {
    if (!linha.trim()) continue;
    let cols: string[];
    if (linha.includes("\t")) {
      cols = linha.split("\t").map((c) => c.trim());
    } else {
      // sem tabs: as ÚLTIMAS 15 colunas são as métricas → o resto (início) é o nome (permite nome com espaço)
      const toks = linha.trim().split(/\s+/);
      cols = toks.length >= metricas.length + 1
        ? [toks.slice(0, toks.length - metricas.length).join(" "), ...toks.slice(-metricas.length)]
        : toks;
    }
    const familia = (cols[0] ?? "").trim();
    if (!familia || CABECALHO.has(familia.toLowerCase())) continue;
    const valores: Record<string, string> = {};
    for (let i = 0; i < metricas.length; i++) {
      const v = (cols[i + 1] ?? "").trim();
      if (v) valores[metricas[i]] = v;
    }
    out.push({ familia, valores });
  }
  return out;
}
