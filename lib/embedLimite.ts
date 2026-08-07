/**
 * Orçamento de caracteres dos embeds do Discord.
 *
 * Existe porque as duas mensagens grandes do bot — a chamada de intenção (lib/intencaoEmbed) e a
 * lista da escalação (lib/listaEscalacao) — estouravam o limite do mesmo jeito e cortavam as
 * últimas seções inteiras. O que engana é o custo do que parece pequeno: um emoji custom é
 * `<:GAllianceMark:1417...>`, ~28 caracteres; uma menção `<@1160...>`, ~21; um link mascarado
 * `[McFly](https://discord.com/users/1160...)`, ~55 para um nome de 5 letras. A ~100 caracteres por
 * pessoa, 50 pessoas já passam do teto de UMA descrição.
 *
 * A saída são as duas alavancas que o Discord dá:
 *  - transbordar pro embed SEGUINTE (10 por mensagem, 6000 somados) em vez de truncar em 4096;
 *  - quando nem isso basta, redesenhar a lista inteira num nível de detalhe mais barato — quem
 *    monta a mensagem decide o que cortar primeiro, aqui só se mede.
 */

export const LIM_DESC = 4096;   // descrição de UM embed
export const LIM_TOTAL = 6000;  // soma de TODOS os embeds da mensagem — estourar dá 400 do Discord
export const MAX_EMBEDS = 10;   // por mensagem
export const AVISO = "⚠ +itens não exibidos (limite do Discord).";

/** Custo de um corpo escrito em linhas — o "\n" entre elas também conta. */
export const custoLinhas = (linhas: string[]) => (linhas.length ? linhas.join("\n").length : 0);

/**
 * Tira linhas do fim até caber, já reservando o espaço do aviso. Só deve sobrar corte quando nem o
 * nível de detalhe mais barato coube: perder a cauda avisando é o último recurso, não o primeiro.
 */
export function cortarAteCaber(linhas: string[], orcamento: number): { linhas: string[]; cortou: boolean } {
  if (custoLinhas(linhas) <= orcamento) return { linhas, cortou: false };
  const out = [...linhas];
  const reserva = orcamento - AVISO.length - 2; // "\n\n" antes do aviso
  while (out.length && custoLinhas(out) > reserva) out.pop();
  out.push("", AVISO);
  return { linhas: out, cortou: true };
}

/**
 * Quebra uma lista de nomes em VÁRIAS linhas de até `porLinha` caracteres.
 *
 * Existe porque uma seção escrita como uma linha só ("fulano, beltrano, …") é atômica pro corte:
 * quando ela não cabe, `cortarAteCaber` joga fora a linha inteira e sobra o cabeçalho órfão
 * ("⬜ Não decididos — 460") sem um nome sequer, com quase todo o orçamento sem uso. Em blocos, o
 * corte tira só a cauda e o transbordo leva o resto pro embed seguinte — que é o que os dois já
 * sabem fazer. A vírgula no fim do bloco avisa que a lista continua na linha de baixo.
 */
export function linhasDeNomes(nomes: string[], o: { porLinha?: number; prefixo?: string } = {}): string[] {
  const porLinha = o.porLinha ?? 400;
  const pre = o.prefixo ?? "";
  const out: string[] = [];
  let atual = "";
  for (const n of nomes) {
    const cand = atual ? `${atual}, ${n}` : n;
    if (cand.length > porLinha && atual) { out.push(pre + atual + ","); atual = n; } else atual = cand;
  }
  if (atual) out.push(pre + atual);
  return out;
}

/**
 * Quebra o corpo em descrições de até 4096 sem partir uma linha no meio. Uma linha sozinha maior
 * que o limite é fatiada na marra — degenerado, mas melhor que o Discord recusar a mensagem
 * inteira. O corte procura um separador antes: partir `<@1160…` no meio faz o Discord desistir da
 * menção e imprimir o id cru, e um par surrogate partido vira caractere quebrado.
 */
export function empacotarDescricoes(linhas: string[]): string[] {
  const partes: string[] = [];
  let atual = "";
  const fecha = () => { if (atual) { partes.push(atual); atual = ""; } };
  for (const l of linhas) {
    let resto = l;
    while (resto.length > LIM_DESC) {
      fecha();
      const janela = resto.slice(0, LIM_DESC);
      const sep = Math.max(janela.lastIndexOf(", "), janela.lastIndexOf(" "));
      let corte = sep > LIM_DESC / 2 ? sep + 1 : LIM_DESC; // separador longe demais não vale o buraco
      const antes = resto.charCodeAt(corte - 1);
      if (antes >= 0xd800 && antes <= 0xdbff) corte--; // não partir emoji ao meio
      partes.push(resto.slice(0, corte));
      resto = resto.slice(corte).replace(/^ +/, "");
    }
    const cand = atual ? atual + "\n" + resto : resto;
    if (cand.length > LIM_DESC && atual) { fecha(); atual = resto; } else atual = cand;
  }
  fecha();
  return partes.slice(0, MAX_EMBEDS);
}
