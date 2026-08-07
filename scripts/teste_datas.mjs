/**
 * Regressão do cálculo de data do disparo (lib/datas.ts). Um dia de erro aqui desalinha o nome
 * do evento, a ordem do hub e a janela de faltas — e só aparece na virada do dia.
 *
 * Rodar: node scripts/teste_datas.mjs
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createJiti } from "jiti";
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": raiz } });
const { hojeBR, amanhaBR, diaDaGuerra, nomeDoEvento } = await jiti.import(join(raiz, "lib/datas.ts"));

let falhas = 0;
const eq = (a, b, msg) => { if (a !== b) { falhas++; console.log(`FALHA ${msg}: ${a} != ${b}`); } };

// 03:00 UTC de 08/08 = 00:00 em São Paulo do dia 08 → hoje é 08, amanhã 09
const meiaNoiteSP = new Date("2026-08-08T03:00:00Z");
eq(hojeBR(meiaNoiteSP), "2026-08-08", "meia-noite SP → hoje");
eq(amanhaBR(meiaNoiteSP), "2026-08-09", "meia-noite SP → amanhã");
// 02:59 UTC ainda é dia 07 em São Paulo
eq(hojeBR(new Date("2026-08-08T02:59:00Z")), "2026-08-07", "um minuto antes da virada");
// 23:20 SP = 02:20 UTC do dia seguinte — o disparo das 20:20 e das 23:00 tem que dar o mesmo "hoje"
eq(hojeBR(new Date("2026-08-07T23:20:00Z")), "2026-08-07", "20:20 SP");
eq(hojeBR(new Date("2026-08-08T02:20:00Z")), "2026-08-07", "23:20 SP");
// virada de mês e de ano
eq(amanhaBR(new Date("2026-08-31T15:00:00Z")), "2026-09-01", "virada de mês");
eq(amanhaBR(new Date("2026-12-31T15:00:00Z")), "2027-01-01", "virada de ano");

// a chamada das 20:20 do dia 07 é da guerra do dia 08 — é o dia da GUERRA que batiza o evento
eq(diaDaGuerra(new Date("2026-08-07T23:20:00Z")), "2026-08-08", "disparo 20:20 SP → guerra de amanhã");
eq(nomeDoEvento("{data}"), diaDaGuerra(), "sem argumento, {data} é o dia da guerra");

eq(nomeDoEvento("{data}", "2026-08-08", "2026-08-07"), "2026-08-08", "token data = dia da guerra");
eq(nomeDoEvento("NW {HOJE}", "2026-08-08", "2026-08-07"), "NW 2026-08-07", "token hoje maiúsculo");
eq(nomeDoEvento("Guerra {data} · T2", "2026-08-08", "x"), "Guerra 2026-08-08 · T2", "token no meio");
eq(nomeDoEvento("", "a", "b"), null, "modelo vazio → null");
eq(nomeDoEvento(null, "a", "b"), null, "modelo nulo → null");
eq(nomeDoEvento("x".repeat(300), "a", "b").length, 200, "corta em 200");
eq(nomeDoEvento("sem token", "a", "b"), "sem token", "literal");

console.log(falhas ? `${falhas} FALHA(S)` : "datas: tudo ok");
process.exit(falhas ? 1 : 0);
