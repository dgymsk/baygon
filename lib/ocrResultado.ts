/**
 * Monta as linhas do print de resultado a partir das PALAVRAS que um OCR devolveu (texto + caixa).
 *
 * É o irmão do leitor por visão (lib/lerResultado.ts), só que sem modelo nenhum: o OCR (tesseract,
 * no navegador) transcreve o que enxerga e ESTE módulo reconstrói a tabela — agrupa palavras em
 * linhas pela altura, separa o nome dos números e casa os números com as colunas por POSIÇÃO,
 * porque o cabeçalho do print é só de ícones (ver lib/metricasResultado.ts).
 *
 * PURO: não importa nada, roda no navegador e em Node (scripts/ocr_teste.mjs roda com `node`
 * direto). As métricas chegam por parâmetro pra não depender de resolução de import.
 *
 * O que ele NÃO faz: normalizar valor ("635.1k" → 635100 é o normalizarValor, na revisão) e casar
 * nome com jogador (chaveNome/acharSimilar, no componente). Aqui é só geometria e texto.
 */

export type PalavraOCR = { text: string; x0: number; y0: number; x1: number; y1: number; conf?: number };
export type LinhaOCR = {
  familia: string;
  /** valor CRU por métrica, do jeito que o OCR leu ("635.1k", "09:56"). Ausente = célula não lida. */
  valores: Record<string, string>;
  /** métricas cujo valor lido NÃO tem a cara da coluna (tempo sem ":", abreviado sem sufixo…) — conferir */
  suspeitos: string[];
  /** os tokens numéricos na ordem em que apareceram — pra depurar o alinhamento */
  tokens: string[];
  /** presente quando a linha veio com menos (ou mais) valores do que colunas: a staff precisa olhar */
  aviso?: string;
};
export type ResultadoOCR = {
  linhas: LinhaOCR[];
  /** linhas do OCR que não viraram jogador (cabeçalho, rodapé, lixo) e por quê */
  descartadas: { texto: string; motivo: string }[];
  /** centro X (na imagem) de cada coluna de valor, estimado pelas linhas completas; null se nenhuma */
  colunas: number[] | null;
};

const TEMPO = /^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/;
const NUM = /^\d+(?:\.\d+)?[kmb]?$/i;
const SO_SUFIXO = /^[kmb]$/i;
/** cargos da lista de participação da Rosas (PT/ES) — texto que fica ENTRE o nome e os números */
const CARGOS = /^(membro|miembro|oficial|capit[aã]o|capit[aá]n|mestre|maestro|l[ií]der|guilda|gremio|da|del|de|do|guild|member|officer|captain)$/i;

/** Confusões clássicas de OCR num token que é (quase) só número: O→0, l/I/|→1, vírgula→ponto, ;→: */
export function limparToken(bruto: string): string {
  let t = (bruto ?? "").trim().replace(/^[\[\(\{\|'"`«»]+|[\]\)\}\|'"`«»,.;:]+$/g, "");
  if (!/\d/.test(t)) return t;
  // só mexe se, tirando os caracteres de número, sobrar no máximo um sufixo — senão é nome com dígito (Tdz1, Haro33)
  const resto = t.replace(/[\d.,:;OolI|\s]/g, "");
  if (resto.length > 1 || (resto.length === 1 && !/[kmbKMB]/.test(resto))) return t;
  t = t.replace(/\s+/g, "").replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/,/g, ".").replace(/;/g, ":");
  return t.replace(/\.{2,}/g, ".");
}

export const ehValor = (t: string) => TEMPO.test(t) || NUM.test(t) || t === "-";

type Tok = { t: string; xc: number };
/**
 * Junta pedaços que o OCR separou: "635.1" + "k", "787" + "4k" (ponto perdido no meio), "09:" + "56",
 * "09" + ":" + "56". O pedaço fundido fica com o X do primeiro.
 */
function fundirPedacos(tokens: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const { t } = tokens[i];
    const prev = out[out.length - 1];
    if (prev) {
      if (SO_SUFIXO.test(t) && /^\d+(?:\.\d+)?$/.test(prev.t)) { prev.t += t; continue; }
      if (/^\d[kmb]$/i.test(t) && /^\d{1,3}\.?$/.test(prev.t)) { prev.t = prev.t.replace(/\.$/, "") + "." + t; continue; }
      if (/^\d{1,3}:$/.test(prev.t) && /^\d{2}$/.test(t)) { prev.t += t; continue; }
      if (t === ":" && /^\d{1,3}$/.test(prev.t) && /^\d{2}$/.test(tokens[i + 1]?.t ?? "")) { prev.t += ":" + tokens[i + 1].t; i++; continue; }
      if (/^:\d{2}$/.test(t) && /^\d{1,3}$/.test(prev.t)) { prev.t += t; continue; }
    }
    out.push({ t, xc: tokens[i].xc });
  }
  return out;
}

/** Agrupa palavras em linhas visuais: mesma linha = centro Y dentro de ~60% da altura mediana. */
export function agruparLinhas(palavras: PalavraOCR[]): PalavraOCR[][] {
  const ps = palavras.filter((p) => p.text && p.text.trim()).map((p) => ({ ...p, yc: (p.y0 + p.y1) / 2, h: Math.max(1, p.y1 - p.y0) }));
  if (!ps.length) return [];
  const alturas = ps.map((p) => p.h).sort((a, b) => a - b);
  const hMed = alturas[Math.floor(alturas.length / 2)];
  const tol = Math.max(3, hMed * 0.6);
  ps.sort((a, b) => a.yc - b.yc);
  const linhas: (typeof ps)[] = [];
  let atual: typeof ps = [];
  let ycAtual = 0;
  for (const p of ps) {
    if (atual.length && Math.abs(p.yc - ycAtual) > tol) { linhas.push(atual); atual = []; }
    atual.push(p);
    // média móvel do centro da linha — aguenta leve inclinação
    ycAtual = atual.reduce((s, q) => s + q.yc, 0) / atual.length;
  }
  if (atual.length) linhas.push(atual);
  return linhas.map((l) => l.sort((a, b) => a.x0 - b.x0));
}

/**
 * Nome de família no BDO NÃO tem espaço. O que aparece junto dele na linha é lixo (ícone lido
 * como "®", "“=", "Gr"), o nome do personagem entre parênteses, ou o cargo da Rosas. Fica o
 * PRIMEIRO token com 3+ caracteres de verdade; sem nenhum, o mais longo.
 */
function escolherNome(cabeca: string[]): string {
  const alnum = (t: string) => t.replace(/[^\p{L}\p{N}]/gu, "").length;
  const limpos = cabeca.join(" ").split("(")[0].split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}_]+$/gu, ""))
    .filter((t) => t && !CARGOS.test(t));
  const bom = limpos.find((t) => alnum(t) >= 3);
  if (bom) return bom;
  return limpos.reduce((m, t) => (alnum(t) > alnum(m) ? t : m), "");
}

/**
 * O que a resolução baixa come é o PONTO e os DOIS-PONTOS — "762.5k" vira "7625k", "14:52" vira
 * "1452". Os dois formatos são fixos no jogo, então dá pra devolver o que sumiu: valor abreviado
 * tem SEMPRE uma casa decimal (1–3 dígitos + ".d" + sufixo) e tempo é mm:ss.
 */
export function corrigirFormato(t: string, formato?: string): string {
  if (formato === "tempo") {
    if (/^\d{1,3}\.\d{2}$/.test(t)) return t.replace(".", ":");
    const m = t.match(/^(\d{1,3})(\d{2})$/);
    if (m && Number(m[2]) < 60) return `${m[1]}:${m[2]}`;
    return t;
  }
  const m = t.match(/^(\d{2,4})([kmbKMB])$/);
  if (m) return `${m[1].slice(0, -1)}.${m[1].slice(-1)}${m[2]}`;
  return t;
}

/** O valor (já corrigido) tem a cara da coluna? Tempo é mm:ss; abreviado é número com/sem sufixo; inteiro é só dígitos. */
export function cabeNoFormato(t: string, formato?: string): boolean {
  if (formato === "tempo") return TEMPO.test(t);
  if (formato === "inteiro") return /^\d+$/.test(t);
  if (formato === "abreviado") return /^\d+$/.test(t) || /^\d{1,3}\.\d[kmb]$/i.test(t);
  return true;
}

/**
 * Casa os valores de uma linha com as colunas.
 *
 * Linha completa (N valores) casa por ordem — MAS confere contra os centros de coluna: se algum
 * valor está a mais de meia coluna do lugar esperado, é sinal de que um número sumiu e outro se
 * partiu em dois (a contagem bate por acidente), e aí vale a posição. Linha incompleta casa cada
 * valor com o centro mais próximo, deixando VAZIAS as colunas sem valor — em vez de deslizar tudo
 * pra esquerda e gravar a war errada.
 */
function casarColunas(vals: Tok[], N: number, centros: number[] | null): (string | null)[] {
  const out: (string | null)[] = new Array(N).fill(null);
  const porPosicao = () => {
    if (!centros) return false;
    let col = 0;
    for (const v of vals) {
      let melhor = -1, dist = Infinity;
      for (let c = col; c < N; c++) { const d = Math.abs(centros[c] - v.xc); if (d < dist) { dist = d; melhor = c; } }
      if (melhor < 0) break;
      out[melhor] = v.t; col = melhor + 1;
    }
    return true;
  };
  if (vals.length === N) {
    if (centros && N > 1) {
      const passo = (centros[N - 1] - centros[0]) / (N - 1);
      const desvio = Math.max(...vals.map((v, i) => Math.abs(v.xc - centros[i])));
      if (desvio > passo * 0.45 && porPosicao()) return out;
    }
    vals.forEach((v, i) => { out[i] = v.t; });
    return out;
  }
  if (vals.length < N && porPosicao()) return out;
  // sem referência (ou valores DEMAIS): âncora pelas duas últimas se forem tempo, senão pela esquerda
  const doFim = vals.length >= 2 && TEMPO.test(vals[vals.length - 1].t) && TEMPO.test(vals[vals.length - 2].t);
  if (doFim) { const k = Math.min(vals.length, N); for (let i = 0; i < k; i++) out[N - 1 - i] = vals[vals.length - 1 - i].t; }
  else { for (let i = 0; i < Math.min(vals.length, N); i++) out[i] = vals[i].t; }
  return out;
}

/**
 * @param metricas chaves na ORDEM das colunas do print (METRICAS_RESULTADO ou METRICAS_ROSAS)
 * @param formatos por métrica ("inteiro" | "abreviado" | "tempo"): corrige ponto/dois-pontos perdidos e marca suspeitos
 */
export function montarLinhasOCR(palavras: PalavraOCR[], metricas: string[], formatos: Record<string, string> = {}): ResultadoOCR {
  const N = metricas.length;
  // na tabela de 15 colunas, menos de 5 números é lixo (cabeçalho lido como "9 2 4"); na Rosas (2) precisa dos dois
  const minVals = N <= 3 ? N : 5;
  const descartadas: ResultadoOCR["descartadas"] = [];
  type Bruta = { nome: string; vals: Tok[]; texto: string };
  const brutas: Bruta[] = [];

  for (const linha of agruparLinhas(palavras)) {
    const texto = linha.map((p) => p.text).join(" ");
    const toks: Tok[] = linha.map((p) => ({ t: limparToken(p.text), xc: (p.x0 + p.x1) / 2 })).filter((p) => p.t);
    const vals: Tok[] = [];
    const cabeca: string[] = [];
    let zonaNum = false;
    for (const { t, xc } of fundirPedacos(toks)) {
      if (ehValor(t)) { zonaNum = true; vals.push({ t: t === "-" ? "" : t, xc }); continue; }
      if (!zonaNum) cabeca.push(t);
      // lixo entre números (ícone lido como "@", "«"): ignora, não vira valor
    }
    const nome = escolherNome(cabeca);
    if (!vals.length) { descartadas.push({ texto, motivo: "sem números" }); continue; }
    if (vals.length < minVals) { descartadas.push({ texto, motivo: `só ${vals.length} número(s)` }); continue; }
    if (!nome) { descartadas.push({ texto, motivo: "números sem nome (linha de total, ou nome não lido)" }); continue; }
    brutas.push({ nome, vals, texto });
  }

  // centros de coluna = mediana do centro X, por índice, nas linhas COMPLETAS
  const completas = brutas.filter((b) => b.vals.length === N);
  let centros: number[] | null = null;
  if (completas.length) {
    centros = Array.from({ length: N }, (_, c) => {
      const xs = completas.map((b) => b.vals[c].xc).sort((a, b) => a - b);
      return xs[Math.floor(xs.length / 2)];
    });
  }

  const linhas: LinhaOCR[] = brutas.map((b) => {
    const casados = casarColunas(b.vals, N, centros);
    const valores: Record<string, string> = {};
    const suspeitos: string[] = [];
    casados.forEach((v, c) => {
      if (v == null || v === "") return;
      const m = metricas[c];
      valores[m] = corrigirFormato(v, formatos[m]);
      if (!cabeNoFormato(valores[m], formatos[m])) suspeitos.push(m);
    });
    const lidos = Object.keys(valores).length;
    const aviso = lidos === N ? undefined
      : b.vals.length > N ? `leu ${b.vals.length} valores pra ${N} colunas — sobrou número, confira o alinhamento`
      : `leu ${lidos} de ${N} valores — as colunas vazias precisam ser conferidas`;
    return { familia: b.nome, valores, suspeitos, tokens: b.vals.map((v) => v.t), aviso };
  });

  return { linhas, descartadas, colunas: centros };
}
