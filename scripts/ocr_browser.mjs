// Testa o caminho do NAVEGADOR de verdade: compila app/eventos/[uuid]/ocrCliente.ts (canvas +
// tesseract.js do CDN) e roda num Chrome headless via DevTools Protocol, com o print embutido.
// Serve pra comparar com scripts/ocr_teste.mjs (Node + sharp): se divergir, o problema é o
// pré-processamento no canvas ou o build wasm do navegador — não o parser.
// Uso: node scripts/ocr_browser.mjs <print.png> [--csv war.csv] [--chrome "C:/.../chrome.exe"]
import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { METRICAS_RESULTADO } from "../lib/metricasResultado.ts";
import { normalizarValor } from "../lib/normalizarValor.ts";

const args = process.argv.slice(2);
const img = args.find((a) => !a.startsWith("--"));
if (!img) { console.error("uso: node scripts/ocr_browser.mjs <print.png> [--csv x.csv]"); process.exit(1); }
const opt = (k) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : undefined; };
const CHROME = opt("chrome") ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(existsSync);
if (!CHROME) { console.error("Chrome não encontrado; passe --chrome"); process.exit(1); }

// 1) compila os dois módulos pro navegador (o alias @/lib vira caminho relativo)
const dir = join(tmpdir(), "baygon-ocr-browser");
mkdirSync(dir, { recursive: true });
try {
  execSync(`npx tsc "app/eventos/[uuid]/ocrCliente.ts" lib/ocrResultado.ts --outDir "${dir}" --module esnext --target es2022 --moduleResolution bundler --skipLibCheck --lib dom,es2022`, { stdio: "pipe" });
} catch (e) {
  const out = String(e.stdout ?? "");
  // o único erro esperado é o alias @/lib (tsc não conhece o tsconfig aqui); qualquer outro derruba
  const outros = out.split(/\r?\n/).filter((l) => /error TS/.test(l) && !/TS2307.*@\/lib/.test(l));
  if (outros.length) { console.error(out); process.exit(1); }
}
const cli = join(dir, "app/eventos/[uuid]/ocrCliente.js");
writeFileSync(cli, readFileSync(cli, "utf8").replace('"@/lib/ocrResultado"', '"../../../lib/ocrResultado.js"'));

// 2) página de teste: UMD do tesseract (CDN) + shim ESM pro `import("tesseract.js")` do módulo
const b64 = readFileSync(img).toString("base64");
const ext = extname(img).toLowerCase() === ".jpg" || extname(img).toLowerCase() === ".jpeg" ? "image/jpeg" : "image/png";
writeFileSync(join(dir, "tesseract-shim.js"), "export const createWorker = window.Tesseract.createWorker; export const PSM = window.Tesseract.PSM;\n");
writeFileSync(join(dir, "teste.html"), `<!doctype html><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js"></script>
<script type="importmap">{"imports":{"tesseract.js":"./tesseract-shim.js"}}</script>
<script type="module">
import { lerPrintOCR } from "./app/eventos/[uuid]/ocrCliente.js";
window.__log = [];
window.__resultado = (async () => {
  const blob = await (await fetch("data:${ext};base64,${b64}")).blob();
  const file = new File([blob], "print.png", { type: "${ext}" });
  return await lerPrintOCR(file, ${JSON.stringify(METRICAS_RESULTADO.map((m) => ({ metrica: m.metrica, formato: m.formato })))}, (s) => window.__log.push(s));
})().then((r) => ({ ok: true, r }), (e) => ({ ok: false, erro: String((e && e.stack) || e) }));
</script>`);

// 3) servidor local (módulos ES não carregam de file://)
const TIPOS = { ".html": "text/html", ".js": "text/javascript" };
const pedidos = [];
const srv = createServer((req, res) => {
  const p = join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
  const ok = existsSync(p);
  pedidos.push(`${ok ? 200 : 404} ${req.url}`);
  if (!ok) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TIPOS[extname(p)] ?? "application/octet-stream" }); res.end(readFileSync(p));
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${srv.address().port}/teste.html`;

// 4) Chrome headless + CDP — abre em branco, liga o console ANTES de navegar (senão erro de import some)
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(dir, "perfil")}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise((resolve, reject) => {
  let s = ""; const t = setTimeout(() => reject(new Error("Chrome não abriu a porta de DevTools: " + s.slice(-300))), 20000);
  chrome.stderr.on("data", (d) => { s += d; const m = s.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); resolve(m[1]); } });
});
const porta = new URL(wsUrl).port;
let alvo;
for (let i = 0; i < 40 && !alvo; i++) {
  const lista = await (await fetch(`http://127.0.0.1:${porta}/json`)).json().catch(() => []);
  alvo = lista.find((t) => t.type === "page");
  if (!alvo) await new Promise((r) => setTimeout(r, 250));
}
if (!alvo) { chrome.kill(); process.exit(1); }
const ws = new WebSocket(alvo.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map(); const erros = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") erros.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? JSON.stringify(m.params).slice(0, 300));
  else if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) erros.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  else if (m.method === "Log.entryAdded" && m.params.entry?.level === "error") erros.push(`[${m.params.entry.source}] ${m.params.entry.text} ${m.params.entry.url ?? ""}`);
};
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await cdp("Runtime.enable");
await cdp("Log.enable");
await cdp("Page.enable");
await cdp("Page.navigate", { url });
const t0 = Date.now();
// o módulo só roda depois que o UMD do CDN carrega — espera a promessa existir antes de esperar por ela
let pronto = false;
for (let i = 0; i < 120 && !pronto; i++) {
  const t = await cdp("Runtime.evaluate", { expression: "typeof window.__resultado", returnByValue: true });
  pronto = t.result?.result?.value === "object";
  if (!pronto) await new Promise((r) => setTimeout(r, 500));
}
if (!pronto) { ws.close(); chrome.kill(); srv.close(); console.error("a página não iniciou o teste (módulo não rodou).\nerros:", erros, "\npedidos ao servidor:", pedidos); process.exit(1); }
const res = await Promise.race([
  cdp("Runtime.evaluate", { expression: "window.__resultado", awaitPromise: true, returnByValue: true, timeout: 180000 }),
  new Promise((r) => setTimeout(() => r({ timeout: true }), 185000)),
]);
const log = (await cdp("Runtime.evaluate", { expression: "window.__log", returnByValue: true })).result?.result?.value ?? [];
ws.close(); chrome.kill(); srv.close();

if (res.timeout) { console.error("TIMEOUT no navegador. log:", log, "erros:", erros); process.exit(1); }
const v = res.result?.result?.value;
if (!v || !v.ok) { console.error("FALHOU no navegador:", v?.erro ?? JSON.stringify(res).slice(0, 500), "\nlog:", log, "\nerros:", erros); process.exit(1); }
const r = v.r;
console.log(`navegador: ${r.palavras} palavras, escala ${r.escala.toFixed(2)}x, ${r.ms} ms de OCR (${Date.now() - t0} ms total) | estágios: ${[...new Set(log.map((s) => s.replace(/ \d+%$/, "")))].join(" → ")}`);
if (erros.length) console.log("erros de console:", erros.slice(0, 5));
const metricas = METRICAS_RESULTADO.map((m) => m.metrica);
console.log(`linhas: ${r.linhas.length} | descartadas: ${r.descartadas.length} | com aviso: ${r.linhas.filter((l) => l.aviso).length}`);
for (const d of r.descartadas.slice(0, 6)) console.log(`  ✗ ${d.motivo}: ${d.texto.slice(0, 90)}`);
for (const l of r.linhas) console.log(`  ${l.familia.padEnd(18)} ${metricas.map((m) => (l.valores[m] ?? "·").padStart(7)).join(" ")}${l.aviso ? "  ⚠ " + l.aviso : ""}`);

const CSV = opt("csv");
if (CSV) {
  const csv = readFileSync(CSV, "utf8").trim().split(/\r?\n/);
  const cab = csv[0].split(",");
  const esperado = new Map(csv.slice(1).map((l) => { const c = l.split(","); return [c[0].toLowerCase(), Object.fromEntries(cab.slice(1).map((k, i) => [k, c[i + 1]]))]; }));
  let cel = 0, ok = 0, vazias = 0, nomesOk = 0; const errs = [];
  for (const l of r.linhas) {
    const exp = esperado.get(l.familia.toLowerCase());
    if (!exp) { errs.push(`nome não bate: "${l.familia}"`); continue; }
    nomesOk++;
    for (const m of metricas) { cel++; const lido = l.valores[m]; if (lido == null) { vazias++; continue; } if (normalizarValor(lido) === normalizarValor(exp[m])) ok++; else errs.push(`${l.familia}.${m}: lido "${lido}" esperado "${exp[m]}"`); }
  }
  console.log(`\nACURÁCIA (navegador): nomes ${nomesOk}/${esperado.size} · células certas ${ok}/${cel} (${(100 * ok / Math.max(1, cel)).toFixed(1)}%) · vazias ${vazias} · erradas ${cel - ok - vazias}`);
  for (const e of errs.slice(0, 20)) console.log("  ", e);
}
