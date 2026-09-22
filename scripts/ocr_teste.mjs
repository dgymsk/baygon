// Harness do OCR: roda o tesseract.js em Node sobre um print, monta as linhas com lib/ocrResultado.ts
// (o MESMO parser que o navegador usa) e, se houver CSV, mede a acurácia célula a célula.
// Uso: node scripts/ocr_teste.mjs <print.png> [--csv war.csv] [--psm 6] [--sem-pre] [--dump]
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { readFileSync, writeFileSync } from "node:fs";
import { montarLinhasOCR } from "../lib/ocrResultado.ts";
import { METRICAS_RESULTADO } from "../lib/metricasResultado.ts";
import { normalizarValor } from "../lib/normalizarValor.ts";

const args = process.argv.slice(2);
const img = args.find((a) => !a.startsWith("--"));
if (!img) { console.error("uso: node scripts/ocr_teste.mjs <print> [--csv x.csv] [--psm 6] [--sem-pre] [--dump]"); process.exit(1); }
const opt = (k) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : undefined; };
const PSM = opt("psm") ?? "6";
const CSV = opt("csv");

/** Pré-processamento = o mesmo plano do navegador: escala pra texto ~30px, cinza, inverte se escuro, estica contraste. */
async function preprocessar(buf) {
  const meta = await sharp(buf).metadata();
  // alvo ~3300px de largura (texto do jogo vira ~30px, faixa boa pro tesseract), sem passar de 3x
  const escala = opt("escala") ? Number(opt("escala")) : Math.min(3, Math.max(1, 3300 / meta.width));
  let s = sharp(buf).resize(Math.round(meta.width * escala), null, { kernel: "lanczos3" }).grayscale();
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true });
  let soma = 0; for (let i = 0; i < data.length; i += 7) soma += data[i];
  const media = soma / Math.ceil(data.length / 7);
  const escuro = media < 110;
  // contraste: percentis 2/98 → 0/255
  const hist = new Array(256).fill(0); for (let i = 0; i < data.length; i += 3) hist[data[i]]++;
  const tot = Math.ceil(data.length / 3); let acc = 0, p2 = 0, p98 = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= tot * 0.02) { p2 = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= tot * 0.02) { p98 = v; break; } }
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) { let v = (data[i] - p2) * 255 / Math.max(1, p98 - p2); v = Math.max(0, Math.min(255, v)); out[i] = escuro ? 255 - v : v; }
  const png = await sharp(out, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer();
  return { png, escala, escuro, media: Math.round(media), largura: info.width };
}

const t0 = Date.now();
const bruto = readFileSync(img);
const pre = args.includes("--sem-pre") ? { png: bruto, escala: 1, escuro: false, media: 0 } : await preprocessar(bruto);
if (args.includes("--dump")) writeFileSync(img + ".pre.png", pre.png);
console.log(`pré: escala ${pre.escala}x, ${pre.escuro ? "invertido (fundo escuro)" : "sem inversão"}, luminância média ${pre.media}`);

const worker = await createWorker("eng", 1, { logger: () => {} });
await worker.setParameters({ tessedit_pageseg_mode: PSM, preserve_interword_spaces: "1", user_defined_dpi: "300" });
const { data } = await worker.recognize(pre.png, {}, { text: true, blocks: true });
await worker.terminate();

const palavras = [];
for (const b of data.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) for (const w of l.words ?? [])
  palavras.push({ text: w.text, x0: w.bbox.x0 / pre.escala, y0: w.bbox.y0 / pre.escala, x1: w.bbox.x1 / pre.escala, y1: w.bbox.y1 / pre.escala, conf: w.confidence });
console.log(`OCR: ${palavras.length} palavras em ${Date.now() - t0} ms (psm ${PSM})`);

const metricas = METRICAS_RESULTADO.map((m) => m.metrica);
const formatos = Object.fromEntries(METRICAS_RESULTADO.map((m) => [m.metrica, m.formato]));
const res = montarLinhasOCR(palavras, metricas, formatos);
console.log(`linhas: ${res.linhas.length} | descartadas: ${res.descartadas.length} | com aviso: ${res.linhas.filter((l) => l.aviso).length}`);
for (const d of res.descartadas.slice(0, 8)) console.log(`  ✗ ${d.motivo}: ${d.texto.slice(0, 90)}`);
if (res.colunas) console.log("colunas (x):", res.colunas.map((c) => Math.round(c)).join(" "));
for (const l of res.linhas) console.log(`  ${l.familia.padEnd(18)} ${metricas.map((m) => (l.valores[m] ?? "·").padStart(7)).join(" ")}${l.aviso ? "  ⚠ " + l.aviso : ""}${args.includes("--tokens") ? "\n      tokens: " + l.tokens.join(" ") : ""}`);

if (CSV) {
  const csv = readFileSync(CSV, "utf8").trim().split(/\r?\n/);
  const cab = csv[0].split(",");
  const esperado = new Map(csv.slice(1).map((l) => { const c = l.split(","); return [c[0].toLowerCase(), Object.fromEntries(cab.slice(1).map((k, i) => [k, c[i + 1]]))]; }));
  let cel = 0, ok = 0, vazias = 0, nomesOk = 0; const erros = [];
  for (const l of res.linhas) {
    const exp = esperado.get(l.familia.toLowerCase());
    if (!exp) { erros.push(`nome não bate: "${l.familia}"`); continue; }
    nomesOk++;
    for (const m of metricas) {
      cel++;
      const lido = l.valores[m];
      if (lido == null) { vazias++; continue; }
      if (normalizarValor(lido) === normalizarValor(exp[m])) ok++; else erros.push(`${l.familia}.${m}: lido "${lido}" esperado "${exp[m]}"`);
    }
  }
  console.log(`\nACURÁCIA: nomes ${nomesOk}/${esperado.size} · células certas ${ok}/${cel} (${(100 * ok / Math.max(1, cel)).toFixed(1)}%) · vazias ${vazias} · erradas ${cel - ok - vazias}`);
  for (const e of erros.slice(0, 25)) console.log("  ", e);
}
