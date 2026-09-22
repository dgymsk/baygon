// Gera um print SINTÉTICO de resultado de war a partir do CSV real, imitando a tela do jogo
// (fundo escuro, texto claro, cabeçalho só de ícones, coluna de classe sem texto).
// Uso: node scripts/ocr_sintetico.mjs [saida.png] [--largura 1920] [--fonte 15]
import sharp from "sharp";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const saida = args.find((a) => !a.startsWith("--")) ?? "sintetico.png";
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? Number(args[i + 1]) : d; };
const LARG = opt("largura", 1920), FONTE = opt("fonte", 15);

const csv = readFileSync(new URL("../war_2026-06-05_completa.csv", import.meta.url), "utf8").trim().split(/\r?\n/);
const cab = csv[0].split(",");
const linhas = csv.slice(1).map((l) => l.split(","));

// larguras proporcionais à tela do jogo: nome largo, classe (ícone), 15 valores
const colW = [220, 60, ...Array(15).fill((LARG - 220 - 60 - 40) / 15)];
const rowH = Math.round(FONTE * 2.1), top = 70;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LARG}" height="${top + rowH * (linhas.length + 1)}">
<rect width="100%" height="100%" fill="#14161a"/>`;
// cabeçalho de ícones (quadradinhos) — sem texto, como no jogo
let x = 20;
for (let c = 0; c < colW.length; c++) { if (c >= 1) svg += `<rect x="${x + colW[c] / 2 - 9}" y="${top - 40}" width="18" height="18" rx="3" fill="#6b6f78"/>`; x += colW[c]; }
linhas.forEach((cols, r) => {
  const y = top + rowH * r;
  if (r % 2) svg += `<rect x="10" y="${y}" width="${LARG - 20}" height="${rowH}" fill="#1b1e24"/>`;
  let x = 20;
  const ty = y + rowH * 0.68;
  svg += `<text x="${x + 6}" y="${ty}" font-family="Arial, Helvetica, sans-serif" font-size="${FONTE}" fill="#d8d4c8">${esc(cols[0])}</text>`;
  x += colW[0];
  svg += `<circle cx="${x + colW[1] / 2}" cy="${y + rowH / 2}" r="${FONTE * 0.55}" fill="#8a5a2b"/>`; // ícone de classe
  x += colW[1];
  for (let c = 1; c < cab.length; c++) {
    const v = cols[c] ?? "";
    svg += `<text x="${x + colW[c + 1] - 8}" y="${ty}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="${FONTE}" fill="${v === "0" ? "#8b8f98" : "#e6e2d6"}">${esc(v)}</text>`;
    x += colW[c + 1];
  }
});
svg += "</svg>";
await sharp(Buffer.from(svg)).png().toFile(saida);
console.log(`ok → ${saida} (${LARG}px, fonte ${FONTE}px, ${linhas.length} linhas)`);
