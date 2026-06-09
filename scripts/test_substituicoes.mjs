// Testa o parsing de ícones + a cascata de promoção contra o embed AO VIVO.
// Uso: node --env-file=.env.local scripts/test_substituicoes.mjs
import { fetchConfirmados } from "../lib/confirmados.ts";

const conf = await fetchConfirmados();
if (!conf.ok) { console.error("falha:", conf.erro); process.exit(1); }

console.log("== GRUPOS (icon | nome | cap | limite | players) ==");
for (const g of conf.grupos) {
  console.log(`${(g.iconKey ?? "—").padEnd(24)} ${g.nome.padEnd(16)} ${g.capacidade}  lim=${g.limite}  [${g.players.map((p) => p.nome).join(", ")}]`);
}

// quantos da espera casam com cada grupo por ícone?
const porIcon = new Map();
for (const w of conf.listaEspera) {
  if (!w.iconKey) continue;
  porIcon.set(w.iconKey, [...(porIcon.get(w.iconKey) ?? []), w.nome]);
}
console.log("\n== ESPERA por pt ==");
for (const g of conf.grupos) {
  const fila = porIcon.get(g.iconKey) ?? [];
  if (fila.length) console.log(`${g.nome.padEnd(16)} <- ${fila.join(", ")}`);
}
const semIcon = conf.listaEspera.filter((w) => !w.iconKey).map((w) => w.nome);
if (semIcon.length) console.log("SEM ÍCONE (não casa):", semIcon.join(", "));

// validação da regra (X/Y): inscritos = no-grupo + na-espera-da-pt; limite = Y
console.log("\n== checagem (inscritos = grupo + espera) vs capacidade ==");
let okAll = true;
for (const g of conf.grupos) {
  const fila = (porIcon.get(g.iconKey) ?? []).length;
  const inscritos = g.players.length + fila;
  const esperado = g.capacidade?.split("/")[0];
  const bate = String(inscritos) === esperado;
  if (!bate) { okAll = false; console.log(`  ✗ ${g.nome}: calc ${inscritos} != cap ${g.capacidade}`); }
}
console.log(okAll ? "  ✓ todos os grupos batem (grupo+espera = inscritos)" : "  (divergências acima — pode ser truncamento do Apollo)");

// simula tirar Denzel + CorvoNegroo (PsssPsss) -> deve subir Infa + Beatersx
console.log("\n== SIMULAÇÃO: remover Denzel + CorvoNegroo ==");
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const removidos = new Set(["denzel", "corvonegroo"].map(norm));
for (const g of conf.grupos) {
  const need = g.players.filter((p) => removidos.has(norm(p.nome))).length;
  if (!need) continue;
  const fila = conf.listaEspera.filter((w) => w.iconKey === g.iconKey && !removidos.has(norm(w.nome)));
  console.log(`  ${g.nome}: removidos ${need} -> sobem: ${fila.slice(0, need).map((w) => w.nome).join(", ") || "(ninguém)"}`);
}

// === teste sintético: DOIS grupos com o MESMO ícone (distribuição por cursor) ===
// replica o algoritmo do SubstituicoesBoard p/ garantir que não duplica nem perde reserva.
console.log("\n== SINTÉTICO: 2 grupos mesmo ícone (PT1=[A,B] PT2=[C,D], espera 🛡=[W1,W2]); remove A e C ==");
function cascata(grupos, espera, rem) {
  const isR = (n) => rem.has(norm(n));
  const need = new Map();
  for (const g of grupos) { const n = g.players.filter(isR).length; if (n) need.set(g.icon, (need.get(g.icon) ?? 0) + n); }
  const fila = new Map();
  for (const w of espera) { if (isR(w.nome)) continue; const left = need.get(w.icon) ?? 0; if (left <= 0) continue; fila.set(w.icon, [...(fila.get(w.icon) ?? []), w]); need.set(w.icon, left - 1); }
  const cursor = new Map(); const plano = [];
  for (const g of grupos) {
    const removed = g.players.filter(isR);
    if (!removed.length) continue;
    const pool = fila.get(g.icon) ?? []; const start = cursor.get(g.icon) ?? 0;
    const prom = pool.slice(start, start + removed.length); cursor.set(g.icon, start + prom.length);
    removed.forEach((r, i) => plano.push(`${g.nome}: ${r} -> ${prom[i]?.nome ?? "(sem reserva)"}`));
  }
  return plano;
}
const synth = cascata(
  [{ nome: "PT1", icon: "u🛡", players: ["A", "B"] }, { nome: "PT2", icon: "u🛡", players: ["C", "D"] }],
  [{ nome: "W1", icon: "u🛡" }, { nome: "W2", icon: "u🛡" }],
  new Set(["a", "c"]),
);
synth.forEach((l) => console.log("  " + l));
const okSynth = synth.join("|") === "PT1: A -> W1|PT2: C -> W2";
console.log(okSynth ? "  ✓ sem duplicar: A->W1 e C->W2 (1:1)" : "  ✗ FALHOU distribuição");
