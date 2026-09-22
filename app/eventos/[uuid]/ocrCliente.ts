/**
 * OCR do print de resultado NO NAVEGADOR (tesseract.js) — a alternativa "sem IA" do extrator.
 *
 * Nada sai da máquina de quem está lendo: a imagem é preparada num canvas (escala, cinza,
 * inversão de fundo escuro, contraste), o tesseract roda num web worker e devolve palavras com
 * caixa; lib/ocrResultado.ts reconstrói a tabela. Os binários (worker, core wasm, idioma) vêm do
 * CDN do próprio tesseract.js na primeira leitura e ficam em cache no navegador.
 *
 * O worker é um singleton: subir o tesseract custa segundos, ler um print custa menos de um.
 */
import { montarLinhasOCR, type PalavraOCR, type ResultadoOCR } from "@/lib/ocrResultado";

type TWorker = import("tesseract.js").Worker;
type Log = { status?: string; progress?: number };

export type LeituraOCR = ResultadoOCR & { texto: string; ms: number; escala: number; palavras: number };

let workerP: Promise<TWorker> | null = null;
let onLog: ((m: Log) => void) | null = null;

async function getWorker(): Promise<TWorker> {
  if (!workerP) {
    workerP = (async () => {
      const T = await import("tesseract.js");
      const w = await T.createWorker("eng", 1, { logger: (m: Log) => onLog?.(m) });
      // PSM 6 = "um bloco uniforme de texto": foi o que melhor manteve as linhas da tabela inteiras
      await w.setParameters({ tessedit_pageseg_mode: T.PSM.SINGLE_BLOCK, preserve_interword_spaces: "1", user_defined_dpi: "300" });
      return w;
    })().catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}

const ROTULO: Record<string, string> = {
  "loading tesseract core": "baixando o motor do OCR…",
  "initializing tesseract": "iniciando o OCR…",
  "loading language traineddata": "baixando o idioma…",
  "initializing api": "preparando…",
  "recognizing text": "lendo o print…",
};
function rotulo(m: Log): string {
  const base = ROTULO[m.status ?? ""] ?? (m.status || "OCR…");
  return m.progress != null && m.status === "recognizing text" ? `${base} ${Math.round(m.progress * 100)}%` : base;
}

/**
 * Prepara a imagem pro tesseract: escala até ~3300px de largura (texto do jogo vira ~30px, a faixa
 * boa do motor), cinza, inverte se o fundo é escuro (o tesseract quer texto escuro em fundo claro)
 * e estica o contraste pelos percentis 2/98. Devolve o canvas e a escala (pra desfazer nas caixas).
 */
async function preparar(file: File): Promise<{ canvas: HTMLCanvasElement; escala: number }> {
  const bmp = await createImageBitmap(file);
  const MAX_AREA = 16e6;
  let escala = Math.min(3, Math.max(1, 3300 / bmp.width));
  if (bmp.width * bmp.height * escala * escala > MAX_AREA) escala = Math.sqrt(MAX_AREA / (bmp.width * bmp.height));
  const W = Math.round(bmp.width * escala), H = Math.round(bmp.height * escala);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas indisponível neste navegador");
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close();
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data, n = W * H;
  const g = new Uint8ClampedArray(n), hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) { const v = ((d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000) | 0; g[i] = v; hist[v]++; }
  let acc = 0, p2 = 0, p98 = 255, soma = 0;
  for (let v = 0; v < 256; v++) soma += hist[v] * v;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.02) { p2 = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.02) { p98 = v; break; } }
  const invertido = soma / n < 110, faixa = Math.max(1, p98 - p2);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let v = ((g[i] - p2) * 255) / faixa;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    if (invertido) v = 255 - v;
    d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, escala };
}

/**
 * Lê UM print. `metricas` na ordem das colunas (METRICAS_RESULTADO ou as da Rosas), com o formato
 * de cada uma. `onProg` recebe o estágio em PT-BR pra mostrar no botão.
 */
export async function lerPrintOCR(
  file: File,
  metricas: { metrica: string; formato: string }[],
  onProg?: (s: string) => void,
): Promise<LeituraOCR> {
  const t0 = performance.now();
  onProg?.("preparando a imagem…");
  const { canvas, escala } = await preparar(file);
  onLog = (m) => onProg?.(rotulo(m));
  try {
    const w = await getWorker();
    onProg?.("lendo o print…");
    const { data } = await w.recognize(canvas, {}, { text: true, blocks: true });
    const palavras: PalavraOCR[] = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const wd of l.words) {
      palavras.push({ text: wd.text, x0: wd.bbox.x0 / escala, y0: wd.bbox.y0 / escala, x1: wd.bbox.x1 / escala, y1: wd.bbox.y1 / escala, conf: wd.confidence });
    }
    const res = montarLinhasOCR(palavras, metricas.map((m) => m.metrica), Object.fromEntries(metricas.map((m) => [m.metrica, m.formato])));
    return { ...res, texto: data.text ?? "", ms: Math.round(performance.now() - t0), escala, palavras: palavras.length };
  } finally {
    onLog = null;
    canvas.width = 0; canvas.height = 0; // solta a memória do bitmap
  }
}
