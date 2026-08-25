// Crase dentro de um bloco sql`...` FECHA o template literal.
//
// O erro que o TypeScript devolve aponta pra outra linha — normalmente um "',' expected" dezenas de
// linhas abaixo — então a causa nunca é óbvia. Já aconteceu três vezes neste projeto, sempre em
// comentário SQL citando um identificador com crase (-- ver `players`).
//
// Este script acha o caso antes do compilador, e diz a linha CERTA.
// Uso: node scripts/check_sql_crase.mjs      (sai 1 se achar algo)
import fs from "node:fs";
import path from "node:path";

const RAIZ = process.cwd();
const IGNORAR = new Set(["node_modules", ".next", ".git", "backup"]);

function arquivos(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!IGNORAR.has(e.name)) out.push(...arquivos(path.join(dir, e.name))); }
    else if (/\.(ts|tsx|mjs)$/.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

/** Corpo de cada bloco sql`...` do arquivo, com a linha em que começa. Respeita a barra de escape. */
function blocosSql(txt) {
  const out = [];
  const re = /\bsql\s*`/g;
  let m;
  while ((m = re.exec(txt))) {
    const ini = m.index + m[0].length;
    let i = ini;
    while (i < txt.length) {
      if (txt[i] === "\\") { i += 2; continue; }
      if (txt[i] === "`") break;
      i++;
    }
    out.push({ linha: txt.slice(0, m.index).split("\n").length, corpo: txt.slice(ini, i) });
    re.lastIndex = i + 1;
  }
  return out;
}

let achados = 0;
for (const f of arquivos(RAIZ)) {
  if (f.endsWith("check_sql_crase.mjs")) continue;   // o próprio script fala de crase o tempo todo
  const txt = fs.readFileSync(f, "utf8");
  if (!txt.includes("sql`")) continue;
  for (const b of blocosSql(txt)) {
    /**
     * A ASSINATURA: o template fecha NO MEIO de uma linha de COMENTÁRIO.
     *
     * Dois formatos, porque o erro já apareceu nos dois: o comentário de SQL (-- ver `x`) e o
     * bloco JSDoc escrito DENTRO da query, cuja linha começa com asterisco. O segundo passou
     * batido pela primeira versão deste script, que só olhava o "--".
     *
     * Quando a crase está dentro de um "-- ...", o corpo lido termina naquela linha, e a última
     * linha dele ainda tem o "--" aberto. Bloco legítimo nunca acaba assim: ou a crase de
     * fechamento está no início de uma linha, ou a última linha é SQL de verdade.
     *
     * Testar isso, e não "o corpo parece curto": o corpo pode ser enorme e ainda estar cortado,
     * porque a crase costuma aparecer perto do fim da query.
     */
    const ultima = b.corpo.slice(b.corpo.lastIndexOf("\n") + 1);
    if (ultima.includes("--") || /^\s*\*/.test(ultima)) {
      const nLinha = b.linha + b.corpo.split("\n").length - 1;
      console.error(`${path.relative(RAIZ, f)}:${nLinha}  o bloco sql fecha DENTRO de um comentário — crase solta`);
      console.error(`   linha: ${JSON.stringify(ultima.trim().slice(0, 100))}`);
      achados++;
    }
  }
}

if (achados) {
  console.error(`\n${achados} ocorrência(s). Em comentário de SQL, cite identificador com aspas ("players") — nunca com crase.`);
  process.exit(1);
}
console.log("nenhuma crase solta dentro de sql`...` ✓");
