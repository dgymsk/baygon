/**
 * Regressão dos dois montadores de embed do bot: a chamada de intenção (lib/intencaoEmbed) e a
 * lista publicada da escalação (lib/listaEscalacao).
 *
 * O que ele guarda: a mensagem parava de crescer nos 4096 caracteres de UMA descrição e as últimas
 * funções/PTs sumiam inteiras. A conta engana porque o caro é invisível — emoji custom `<:x:123…>`
 * são ~28 caracteres, menção ~21, link mascarado ~55. Agora o corpo transborda pros embeds
 * seguintes (6000 somados) e, se nem isso bastar, a lista é redesenhada num nível mais barato.
 *
 * Rodar: node scripts/teste_embed.mjs   (sai 1 se alguma invariante quebrar)
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createJiti } from "jiti";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": raiz } });
const { montarEmbedIntencao } = await jiti.import(join(raiz, "lib/intencaoEmbed.ts"));
const { montarLista } = await jiti.import(join(raiz, "lib/listaEscalacao.ts"));

const id = (i) => String(1160000000000000000n + BigInt(i));
const CLASSES = ["Ninja", "Sorc", "Witch", "Shai", "Zerk", "Musa", "Tamer", "Guard"];
const GUILDAS = ["OsSemDinheiro", "Psicose", "Baygon"];
// emojis custom REAIS têm ~28 chars — é isso que estoura o orçamento
const emojis = {
  classes: Object.fromEntries(CLASSES.map((c, i) => [c, `<:${c}:${id(500 + i)}>`])),
  guildas: Object.fromEntries(GUILDAS.map((g, i) => [g, `<:${g.slice(0, 12)}:${id(600 + i)}>`])),
};
const tags = { OsSemDinheiro: "[OSD]", Psicose: "[PSI]", Baygon: "[BAY]" };
const NOMES = ["Caller", "Scout", "Elefante", "Bandeira", "Flame", "Hwacha", "Canhao", "Mago/Bruxa", "Unga Unga", "Ranged"];

let falhas = 0;
const check = (ok, msg) => { if (!ok) { falhas++; console.log("   FALHA: " + msg); } };
const chars = (embeds) => embeds.reduce((a, e) =>
  a + (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text?.length ?? 0), 0);

/** Invariantes que valem pra QUALQUER mensagem — estourar qualquer uma dá 400 do Discord. */
function limites(embeds, rotulo) {
  const total = chars(embeds);
  check(total <= 6000, `${rotulo}: total ${total} > 6000 — o Discord recusaria com 400`);
  check(embeds.every((e) => e.description && e.description.length <= 4096), `${rotulo}: descrição > 4096 ou vazia`);
  check(embeds.length <= 10, `${rotulo}: mais de 10 embeds`);
  check(embeds.filter((e) => e.title).length === 1, `${rotulo}: título repetido ou ausente`);
  check(embeds.filter((e) => e.image).length <= 1, `${rotulo}: imagem repetida`);
  // menção partida na emenda de dois embeds vira id cru na tela
  for (const e of embeds) {
    const abertos = (e.description.match(/<@\d*$/m) || []).length;
    check(abertos === 0, `${rotulo}: menção partida no fim de uma descrição`);
  }
  return total;
}

console.log("=========== CHAMADA DE INTENÇÃO ===========");
const FUNCOES = NOMES.map((nome, i) => ({ id: i + 1, nome, emoji: `<:f${i}:${id(700 + i)}>` }));
function cenarioInt(qtdMarcou, qtdNao, qtdPendente, o = {}) {
  const marcas = [], respostas = [], perfil = new Map(), membros = [];
  const suf = o.nomeLongo ? "_com_nome_bem_comprido" : "";
  for (let i = 0; i < qtdMarcou; i++) {
    const chave = `p${i}`, fam = `Jogador${i}${suf}`;
    marcas.push({ user_id: id(i), funcao_id: FUNCOES[i % FUNCOES.length].id });
    respostas.push({ user_id: id(i), familia: o.semFamilia ? null : fam, chave, resposta: "vai" });
    perfil.set(chave, { guilda: GUILDAS[i % 3], classe: CLASSES[i % CLASSES.length], gs: 820 + (i % 70) });
    membros.push({ chave, familia: fam });
  }
  for (let i = 0; i < qtdNao; i++) {
    const chave = `n${i}`, fam = `Recusou${i}${suf}`;
    respostas.push({ user_id: id(2000 + i), familia: fam, chave, resposta: "nao" });
    membros.push({ chave, familia: fam });
  }
  for (let i = 0; i < qtdPendente; i++) membros.push({ chave: `x${i}`, familia: `Pendente${i}${suf}` });
  return { presetId: 1, presetNome: "NODEWAR T2", mensagem: o.mensagem ?? "Vai participar da war hoje? Marque abaixo.",
    funcoes: FUNCOES, marcas, respostas, membros, perfil, emojis, tags };
}

const CASOS_INT = [
  [0, 0, 0, {}], [5, 0, 0, {}], [28, 2, 40, {}], [76, 6, 45, {}], [120, 10, 60, {}],
  [200, 20, 90, {}], [400, 40, 200, {}],
  // elenco grande: o caso em que a seção de não-decididos sumia INTEIRA (linha atômica)
  [1, 0, 460, {}], [1, 0, 600, {}], [10, 0, 420, {}],
  [0, 0, 300, { nomeLongo: true }], [0, 0, 300, { mensagem: "x".repeat(1500) }],
  // sem nome de família todo mundo vira menção de 22 chars
  [246, 0, 0, { semFamilia: true }], [247, 0, 0, { semFamilia: true }], [400, 0, 0, { semFamilia: true }],
];

for (const [marcou, nao, pend, o] of CASOS_INT) {
  const d = cenarioInt(marcou, nao, pend, o);
  const { embeds, components } = montarEmbedIntencao(d);
  const texto = embeds.map((e) => e.description).join("\n");
  const rotulo = `int/${marcou}m-${nao}n-${pend}p${o.semFamilia ? "-anon" : ""}${o.nomeLongo ? "-longo" : ""}${o.mensagem ? "-msg" : ""}`;
  const total = limites(embeds, rotulo);
  const cortou = texto.includes("não exibidos");
  const some = (lista) => lista.filter((n) => !texto.includes(n));
  const faltamMarcados = o.semFamilia
    ? Array.from({ length: marcou }, (_, i) => id(i)).filter((x) => !texto.includes(x))
    : some(Array.from({ length: marcou }, (_, i) => `Jogador${i}${o.nomeLongo ? "_com" : ""}`));
  const faltamPend = some(Array.from({ length: pend }, (_, i) => `Pendente${i}`));
  // no nível 0 os "não vão" saem como menção, não como nome de família — vale qualquer um dos dois
  const faltamNao = Array.from({ length: nao }, (_, i) => i)
    .filter((i) => !texto.includes(`Recusou${i}`) && !texto.includes(id(2000 + i)));
  console.log(`${rotulo} → ${embeds.length} embed(s), ${total} chars, cortou=${cortou}` +
    ` [faltam ${faltamMarcados.length}m ${faltamNao.length}n ${faltamPend.length}p]`);
  check(components.length <= 5 && components.every((r) => r.components.length <= 5), `${rotulo}: linha de botões inválida`);
  // nenhuma função pode sumir enquanto houver orçamento; com o ⚠ na tela, perder a cauda é o
  // último recurso e está anunciado
  if (!cortou) for (const f of FUNCOES) check(texto.includes(f.nome), `${rotulo}: função "${f.nome}" sumiu`);
  // ninguém pode sumir em silêncio: ou aparece, ou o ⚠ está lá dizendo que faltou
  const sumiu = faltamMarcados.length + faltamPend.length + faltamNao.length;
  check(sumiu === 0 || cortou, `${rotulo}: ${sumiu} nome(s) sumiram SEM aviso`);
  // e quando corta, tem que sobrar quase todo o orçamento usado — o defeito era apagar a seção
  // inteira e mandar uma mensagem de 130 chars com 5900 de orçamento ocioso
  check(!cortou || total > 5000, `${rotulo}: cortou usando só ${total} de ~5900 — seção atômica caiu inteira`);
}

console.log("\n=========== LISTA DA ESCALAÇÃO ===========");
function cenarioLista(qtdPts, porPt, recusaram = 5) {
  const parties = Array.from({ length: qtdPts }, (_, i) => ({ id: i + 1, nome: NOMES[i % NOMES.length] + (i >= NOMES.length ? " 2" : ""), icone: `<:p${i}:${id(800 + i)}>` }));
  const escalados = [];
  for (let p = 0; p < qtdPts; p++) for (let j = 0; j < porPt; j++) {
    const i = p * porPt + j;
    escalados.push({ chave: `e${i}`, familia: `Escalado${i}`, userId: id(i), partyId: p + 1,
      guilda: GUILDAS[i % 3], classe: CLASSES[i % CLASSES.length], gs: 820 + (i % 70),
      confirmouEscalacao: i % 3 === 0 ? true : i % 3 === 1 ? false : null,
      confirmouIngame: i % 4 === 0, ordem: i + 1, ordemPt: j, filler: i % 11 === 0 });
  }
  return { titulo: "2026-08-07", data: "07/08", tamanhoMax: qtdPts * porPt, parties, escalados,
    recusaram: Array.from({ length: recusaram }, (_, i) => `Recusou${i}`), emojis, tags,
    nota: "Entrar no canal de voz 20 min antes.", vazio: `<:vazio:${id(999)}>` };
}

for (const [pts, porPt, rec] of [[1, 5, 5], [5, 5, 5], [8, 5, 5], [10, 5, 5], [12, 5, 5], [20, 5, 5], [40, 5, 5], [10, 5, 200]]) {
  const { embeds } = montarLista(cenarioLista(pts, porPt, rec));
  const texto = embeds.map((e) => e.description).join("\n");
  const rotulo = `lista/${pts * porPt}esc-${rec}rec`;
  const total = limites(embeds, rotulo);
  const cortou = texto.includes("não exibidos");
  const faltam = Array.from({ length: pts * porPt }, (_, i) => i).filter((i) => !texto.includes(id(i)) && !texto.includes(`Escalado${i}`));
  const faltamRec = Array.from({ length: rec }, (_, i) => `Recusou${i}`).filter((n) => !texto.includes(n));
  console.log(`${rotulo} → ${embeds.length} embed(s), ${total} chars, cortou=${cortou} [faltam ${faltam.length}esc ${faltamRec.length}rec]`);
  check(embeds.filter((e) => e.footer).length === 1, `${rotulo}: footer repetido ou ausente`);
  check(texto.includes("👑"), `${rotulo}: coroa sumiu`);
  check(texto.includes("líder da PT"), `${rotulo}: legenda sumiu`);
  check(faltam.length + faltamRec.length === 0 || cortou, `${rotulo}: nome(s) sumiram SEM aviso`);
  check(!cortou || total > 5000, `${rotulo}: cortou usando só ${total} — seção atômica caiu inteira`);
  if (pts <= 20) for (const p of cenarioLista(pts, porPt, rec).parties) check(texto.includes(p.nome), `${rotulo}: PT "${p.nome}" sumiu`);
}

console.log("\n--- amostra: chamada com 76 marcados, primeiras 8 linhas ---");
console.log(montarEmbedIntencao(cenarioInt(76, 6, 45)).embeds[0].description.split("\n").slice(0, 8).join("\n"));
console.log("\n--- amostra: escalação com 50, primeiras 7 linhas ---");
console.log(montarLista(cenarioLista(10, 5)).embeds[0].description.split("\n").slice(0, 7).join("\n"));

console.log("\n" + (falhas ? falhas + " FALHA(S)" : "tudo ok"));
process.exit(falhas ? 1 : 0);
