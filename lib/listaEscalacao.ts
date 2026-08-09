/**
 * A LISTA da escalação como mensagem do Discord — PURO, sem I/O.
 *
 * Mantém a diagramação do bot antigo (lib/participacaoEmbed.ts), que já é a que a guilda lê sem
 * pensar: uma seção por PT, e cada pessoa numa linha de blockquote
 *     > {emoji da guilda} · Nome(clicável) · GS · {emoji da classe}
 * O blockquote dá a barra à esquerda E mantém o link clicável — code block não mantém.
 *
 * A diferença pro bot antigo é o que cada seção significa: lá era PT do template, aqui é a PARTY
 * in-game já escalada pela staff.
 *
 * ORÇAMENTO: uma linha cheia custa ~100 caracteres (emoji custom são ~28 cada, menção ~21), então
 * uma escalação de 10 PTs de 5 não cabia nos 4096 de uma descrição e as últimas PTs sumiam. Agora
 * o corpo transborda pros embeds seguintes (lib/embedLimite) e, se ainda não couber, a lista
 * inteira é redesenhada num nível de detalhe mais barato — ver `linha`.
 */
import { LIM_TOTAL, custoLinhas, cortarAteCaber, empacotarDescricoes, linhasDeNomes } from "@/lib/embedLimite";
import { rotuloGuerra } from "@/lib/tiposGuerra";

export type PartyL = { id: number; nome: string; icone: string | null };
export type EscaladoL = {
  chave: string; familia: string; userId: string | null; partyId: number | null;
  guilda: string | null; classe: string | null; gs: number | null;
  confirmouEscalacao: boolean | null; confirmouIngame: boolean;
  ordem: number | null;   // posição na FILA da chamada (1 = marcou primeiro); null = entrou sem marcar
  ordemPt: number | null; // posição DENTRO da PT, montada pela staff — 0 é o líder
  filler: boolean;        // veio in-game sem ter marcado na chamada
};
export type PerfilEmojis = { classes: Record<string, string>; guildas: Record<string, string> };

const COR = 0xcc0000;
const NIVEL_MIN = 5; // último nível de detalhe (nome de família seco)
/** Reserva o slot da coroa em quem não é líder.
 *
 *  O certo é um emoji transparente do servidor (`:vazio:`), porque emoji tem largura fixa no
 *  Discord e caractere não tem — fora de code block a fonte é proporcional, e qualquer espaço
 *  branco aproxima sem casar. O espaço ideográfico fica como queda: se o emoji for apagado, a lista
 *  volta a desalinhar um pouco em vez de exibir "<:vazio:123>" cru. */
const VAZIO_FALLBACK = "　";
const safeLink = (s: string) => (s || "?").replace(/[`[\]()\n]/g, "").trim() || "?";

export type DadosLista = {
  titulo: string;
  data?: string;              // exibição (dd/mm)
  tamanhoMax?: number | null; // teto do preset — só referência
  parties: PartyL[];
  escalados: EscaladoL[];
  recusaram?: string[];
  emojis?: PerfilEmojis;
  tags?: Record<string, string>;
  nota?: string;
  vazio?: string | null;  // emoji transparente que reserva o slot da coroa
};

/**
 * A mesma mensagem, DEPOIS que a guerra acabou.
 *
 * Encerrar o evento troca a escalação inteira por um cartão de resultado. O motivo é que a lista
 * publicada envelhece mal: ela continua dizendo "⏳ aguardando" e "🎮 está no jogo" de uma guerra
 * que terminou, e quem rola o canal na semana seguinte lê aquilo como se fosse a de hoje. Some
 * também as menções, que faziam a lista velha aparecer na busca de cada pessoa.
 *
 * É EDIÇÃO da mesma mensagem, não apagar e postar outra: o link que já foi compartilhado continua
 * valendo, e o histórico do canal não ganha um buraco.
 */
export type DadosEncerramento = {
  titulo: string;
  data?: string;
  tipo?: string | null;        // nodewar | siege — vira "na Node War" / "na Siege"
  resultado?: string | null;   // vitoria | participacao | derrota; null = encerrado sem resultado
  escalados?: number;
  ingame?: number;
  comEstatistica?: number;
};

/** Cores REAIS (a paleta do site é carmesim pra tudo — aqui é o Discord, e verde tem que ser verde). */
const COR_RESULTADO: Record<string, number> = { vitoria: 0x3fbf5f, participacao: 0xe0bd3a, derrota: 0xe04b4b };
const FRASE: Record<string, string> = { vitoria: "Vitória", participacao: "Participação", derrota: "Derrota" };

export function montarEncerramento(d: DadosEncerramento) {
  const r = (d.resultado ?? "").toLowerCase();
  const tipoRot = d.tipo ? rotuloGuerra(d.tipo) : null;
  // "Vitória na Siege" quando os dois são conhecidos; sem resultado, só "Evento concluído" — chutar
  // um resultado que ninguém gravou seria pior que não dizer nada
  const desfecho = FRASE[r] ? `${FRASE[r]}${tipoRot ? ` na ${tipoRot}` : ""}` : null;
  const titulo = `🏁 Evento concluído${desfecho ? ` — ${desfecho}` : ""}`.slice(0, 256);

  const L: string[] = [`**${safeLink(d.titulo)}**${d.data ? ` · ${d.data}` : ""}`];
  const n: string[] = [];
  if (d.escalados) n.push(`👥 ${d.escalados} escalados`);
  if (d.ingame) n.push(`🎮 ${d.ingame} in-game`);
  if (d.comEstatistica) n.push(`📊 ${d.comEstatistica} com estatística`);
  if (n.length) L.push(n.join(" · "));
  L.push("", "_A escalação saiu do ar porque a guerra acabou. O histórico completo fica no site._");

  return {
    embeds: [{
      title: titulo,
      description: L.join("\n").slice(0, 4096),
      color: COR_RESULTADO[r] ?? 0x8f8f8f,   // cinza quando não há resultado gravado
    }],
  };
}

export function montarLista(d: DadosLista) {
  const tags = d.tags ?? {};
  const porParty = new Map<number, EscaladoL[]>();
  for (const e of d.escalados) {
    if (e.partyId == null) continue;
    const a = porParty.get(e.partyId) ?? [];
    a.push(e);
    porParty.set(e.partyId, a);
  }
  // a ordem é a que a staff MONTOU arrastando (ordem_pt) — tem que bater com a tela, senão a coroa
  // sairia em pessoas diferentes nos dois lugares. Sem posição montada, cai na fila de chegada.
  for (const a of porParty.values()) {
    a.sort((x, y) => (x.ordemPt ?? x.ordem ?? 1e9) - (y.ordemPt ?? y.ordem ?? 1e9) || x.familia.localeCompare(y.familia, "pt-BR"));
  }

  /**
   * Linha de uma pessoa, por NÍVEL de detalhe. O nível 0 é o desenho de sempre; cada nível seguinte
   * corta o que custa mais caractere por informação, na ordem em que menos dói:
   *   0  👑 · sinal · {guilda} · @menção · GS · {classe} · 🔴   (~100 chars)
   *   1  sem o ícone de classe (−28)
   *   2  o `:vazio:` que reserva a coroa vira espaço ideográfico (−26): o alinhamento piora um
   *      pouco, mas é enfeite, e ícone de guilda é informação — enfeite sai primeiro
   *   3  guilda vira tag textual (−23)   4  sem guilda (−8)
   *   5  menção vira nome de família e cai o GS
   * A menção é a última a sair de propósito: é ela que faz a pessoa se achar na lista.
   */
  const linha = (e: EscaladoL, i: number, n = 0): string => {
    const gEmoji = n <= 2 ? (e.guilda && d.emojis?.guildas[e.guilda]) || (e.guilda && tags[e.guilda]) || ""
      : n === 3 ? (e.guilda && tags[e.guilda]) || "" : "";
    const cEmoji = n === 0 ? (e.classe && d.emojis?.classes[e.classe]) || (e.classe ? `(${safeLink(e.classe)})` : "") : "";
    // menção de verdade (<@id>) em vez de link mascarado: vira o chip do Discord, com avatar no
    // hover, e a pessoa se acha na lista pelo próprio nome do servidor. Sem user_id vinculado
    // (escalado à mão, sem registro) sobra o nome de família em texto.
    const nome = e.userId && n <= 4 ? `<@${e.userId}>` : safeLink(e.familia);
    // um sinal só, e o IN-GAME tem prioridade: quem já apareceu no jogo respondeu na prática a
    // pergunta que o ⏳ fazia. "Aguardando resposta" ao lado de "está no jogo" era contradição na
    // mesma linha.
    const sinal = e.confirmouIngame ? "🎮"
      : e.confirmouEscalacao === true ? "✅"
      : e.confirmouEscalacao === false ? "❌" : "⏳";
    // 👑 = líder (quem a staff pôs em primeiro). Quem não é líder recebe o espaço no lugar da
    // coroa: sem isso a linha de baixo começava deslocada, e o olho perde a coluna do nome.
    // O Discord usa fonte proporcional fora de code block, então isso aproxima — não casa ao pixel.
    const marca = i === 0 ? "👑" : (n <= 1 && d.vazio) || VAZIO_FALLBACK;
    // 🔴 filler: entrou na PT sem ter marcado na chamada. Fica na própria linha, junto de quem
    // ele está jogando — separá-lo numa seção dizia "tem alguém sobrando" sem dizer onde.
    return [marca, sinal, gEmoji, nome, n <= 4 && e.gs != null ? String(e.gs) : null, cEmoji, e.filler ? "🔴" : null].filter(Boolean).join(" · ");
  };
  // índice explícito: `es.map(linha)` passaria o índice como 2º argumento por acidente, e aqui ele
  // decide quem leva a coroa — melhor deixar à vista
  const moldura = (es: EscaladoL[], n: number) => es.map((e, i) => "> " + linha(e, i, n));

  const rodape = "👑 líder da PT · 🔴 filler · 🎮 está no jogo · ✅ confirmou na DM · ⏳ aguardando · ❌ recusou";

  /** O corpo inteiro num nível, linha a linha ("" separa seções) — refeito a cada tentativa. */
  const corpoEm = (n: number): string[] => {
    const L: string[] = [];
    const sep = () => { if (L.length) L.push(""); };
    for (const p of d.parties) {
      const dentro = porParty.get(p.id) ?? [];
      const gss = dentro.map((e) => e.gs).filter((x): x is number => x != null);
      const media = gss.length ? Math.round(gss.reduce((a, b) => a + b, 0) / gss.length) : null;
      sep();
      L.push(`${p.icone ? p.icone + " " : ""}**${p.nome}** — ${dentro.length}${media != null ? ` · GS ${media}` : ""}`);
      L.push(...(dentro.length ? moldura(dentro, n) : ["> _(vazia)_"]));
    }
    if (d.recusaram?.length) {
      sep();
      L.push(`**❌ Não vão — ${d.recusaram.length}**`);
      // em blocos, nunca uma linha só: linha atômica grande some INTEIRA no corte
      L.push(...linhasDeNomes(d.recusaram.map(safeLink)));
    }
    return L;
  };

  const total = d.escalados.filter((e) => e.partyId != null).length;
  const ok = d.escalados.filter((e) => e.partyId != null && e.confirmouEscalacao === true).length;
  const titulo = `📋 Escalação — ${d.titulo}${d.data ? ` · ${d.data}` : ""}`.slice(0, 256);
  const footer = { text: `${ok}/${total} confirmados${d.tamanhoMax ? ` · meta ${d.tamanhoMax}` : ""}` };
  const topo = d.nota ? [d.nota.trim().slice(0, 1000), ""] : [];
  const legenda = ["", rodape];
  // título e footer também contam no teto de 6000 da mensagem
  const orcamento = LIM_TOTAL - titulo.length - footer.text.length - 40;
  const custo = (L: string[]) => custoLinhas([...topo, ...L, ...legenda]);

  // desce de nível até a escalação INTEIRA caber; completa e simples vale mais que bonita e cortada
  let nivel = 0;
  let linhas = corpoEm(0);
  while (nivel < NIVEL_MIN && custo(linhas) > orcamento) { nivel++; linhas = corpoEm(nivel); }
  const corte = cortarAteCaber([...topo, ...linhas], orcamento - custoLinhas(legenda));

  const usadas = empacotarDescricoes([...corte.linhas, ...legenda]);
  if (!usadas.length) usadas.push(rodape);

  return {
    embeds: usadas.map((desc, i) => ({
      ...(i === 0 ? { title: titulo } : {}),
      description: desc,
      color: COR, // em todos, pra barra vermelha ficar contínua e parecer um bloco só
      ...(i === usadas.length - 1 ? { footer } : {}),
    })),
  };
}
