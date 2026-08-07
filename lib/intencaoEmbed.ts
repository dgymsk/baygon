/**
 * Mensagem do bot de INTENÇÃO — PURO, sem I/O (nem banco, nem Discord), pra poder ser testado.
 *
 * Diferenças pro bot de participação antigo (lib/participacaoEmbed.ts, que continua rodando):
 *  - a pessoa marca em QUAL função pretende jogar (um botão por função); marcar outra TROCA,
 *    porque numa war se joga numa posição só;
 *  - NÃO existe limite de vaga: aqui não há confirmado/espera, só quem marcou o quê;
 *  - os botões de função são NEUTROS (style 2). O Discord só tem 4 cores de botão e elas não podem
 *    variar por pessoa numa mensagem de canal — então a identidade fica no ícone, e a cor não
 *    tenta dizer nada. O ❌ é vermelho por ser ação de outra natureza, não uma PT.
 *
 * ORÇAMENTO DE CARACTERES (o que fazia a lista cortar em ~76 pessoas): o Discord limita a
 * DESCRIÇÃO de um embed a 4096 caracteres e a SOMA de todos os embeds da mensagem a 6000. Uma
 * linha cheia custa muito mais do que aparenta — `<:GAllianceMark:1417...>` são ~28 caracteres para
 * um ícone, e `[McFly](https://discord.com/users/1160...)` são ~55 para um nome de 5 letras. A
 * 110 caracteres por pessoa, 76 marcados estouram o limite e as últimas funções sumiam inteiras.
 *
 * A saída tem duas partes:
 *  1. NÍVEIS de detalhe — desenha no nível cheio e, se não couber, redesenha a lista INTEIRA num
 *     nível mais barato (ver `linha`). Perder o link de perfil de todo mundo é melhor que perder
 *     as três últimas funções, e o resultado fica uniforme em vez de meio bonito e meio cortado.
 *  2. VÁRIOS embeds na mesma mensagem — o corpo transborda pro embed seguinte (até 10), o que dá
 *     6000 em vez de 4096. Continua uma mensagem só, com os mesmos botões.
 */

import { LIM_TOTAL, custoLinhas, cortarAteCaber, empacotarDescricoes, linhasDeNomes } from "@/lib/embedLimite";

export type FuncaoI = { id: number; nome: string; emoji: string | null };
export type MarcaI = { user_id: string; funcao_id: number };
export type RespI = { user_id: string; familia: string | null; chave: string | null; resposta: "vai" | "nao" };
export type MembroI = { chave: string; familia: string }; // elenco esperado (registrados + com função)
export type PerfilI = { guilda: string; classe: string | null; gs: number | null };
export type EmojiMapI = { classes: Record<string, string>; guildas: Record<string, string> };

const COR = 0xcc0000; // carmesim (tema da aliança) — barra do embed
const MAX_BOTOES = 24; // 5 linhas x 5 = 25, menos o ❌
const NIVEL_MIN = 5; // último nível de detalhe (nomes corridos)

/** "<:nome:123>" / "<a:nome:123>" / "🏹" → objeto de emoji do Discord. Sem emoji → null. */
export function emojiDiscord(raw: string | null): { id?: string; name: string; animated?: boolean } | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const cm = s.match(/^<(a?):(\w+):(\d+)>$/);
  if (cm) return { id: cm[3], name: cm[2], animated: cm[1] === "a" };
  const um = s.match(/^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)/u);
  return um ? { name: um[1] } : null;
}

const safeLink = (s: string) => (s || "?").replace(/[`[\]()\n]/g, "").trim() || "?"; // texto seguro p/ [texto](url)

export type DadosIntencao = {
  presetId: number;
  presetNome: string;
  mensagem?: string;
  imagem?: string;
  funcoes: FuncaoI[];                 // já na ordem do preset
  marcas: MarcaI[];
  respostas: RespI[];
  membros?: MembroI[];        // elenco esperado — vira a lista de não decididos
  nomePorUser?: Map<string, string>; // user_id → nome de família (exibição)
  perfil?: Map<string, PerfilI>;     // chaveNome → guilda/classe/GS
  emojis?: EmojiMapI;
  tags?: Record<string, string>;     // id da guilda → tag curta (fallback sem emoji)
};

export function montarEmbedIntencao(d: DadosIntencao) {
  const tags = d.tags ?? {};
  const marcasPorFuncao = new Map<number, string[]>();
  for (const m of d.marcas) { const a = marcasPorFuncao.get(m.funcao_id) ?? []; a.push(m.user_id); marcasPorFuncao.set(m.funcao_id, a); }
  const respPorUser = new Map(d.respostas.map((r) => [r.user_id, r]));

  const dados = (userId: string) => {
    const r = respPorUser.get(userId);
    return { nomeFam: r?.familia ?? d.nomePorUser?.get(userId) ?? null, p: r?.chave ? d.perfil?.get(r.chave) : undefined };
  };
  const soNome = (userId: string) => { const { nomeFam } = dados(userId); return nomeFam ? safeLink(nomeFam) : `<@${userId}>`; };

  /**
   * Linha de uma pessoa, por NÍVEL de detalhe — cada nível corta o item mais caro em caracteres,
   * na ordem em que menos dói. Emoji sempre FORA do link (custom não renderiza dentro de link
   * mascarado); o blockquote de `moldura` é o que mantém o link clicável.
   *   0  {guilda} · [Nome](perfil) · GS · {classe}   ← o desenho de sempre (~110 chars)
   *   1  {guilda} · Nome · GS · {classe}             ← sem link mascarado (−55)
   *   2  {guilda} · Nome · GS                        ← sem ícone de classe (−28)
   *   3  [TAG] · Nome · GS                           ← guilda vira texto curto (−23)
   *   4  Nome · GS                                   ← sem guilda
   */
  const linha = (userId: string, n: number): string => {
    const { nomeFam, p } = dados(userId);
    const gEmoji = n <= 2 ? (p?.guilda && d.emojis?.guildas[p.guilda]) || (p?.guilda && tags[p.guilda]) || ""
      : n === 3 ? (p?.guilda && tags[p.guilda]) || "" : "";
    const cEmoji = n <= 1 ? (p?.classe && d.emojis?.classes[p.classe]) || (p?.classe ? `(${safeLink(p.classe)})` : "") : "";
    const nome = nomeFam && n === 0 ? `[${safeLink(nomeFam)}](https://discord.com/users/${userId})` : soNome(userId);
    return [gEmoji, nome, p?.gs != null ? String(p.gs) : null, cEmoji].filter(Boolean).join(" · ");
  };

  /** Corpo de uma função. No nível 5 vira nomes corridos (~9 chars por pessoa), em blocos — nunca
   *  uma linha só, senão o corte derrubaria a função inteira de uma vez. */
  const moldura = (ids: string[], n: number): string[] =>
    n >= NIVEL_MIN ? linhasDeNomes(ids.map(soNome), { prefixo: "> " }) : ids.map((u) => "> " + linha(u, n));

  const naoVao = d.respostas.filter((r) => r.resposta === "nao");

  // não decididos = quem é esperado na guerra e não respondeu nada (nem marca, nem ❌)
  const pendentes: string[] = [];
  if (d.membros?.length) {
    const respondeuChave = new Set(d.respostas.map((r) => r.chave).filter(Boolean) as string[]);
    const vistos = new Set<string>();
    for (const m of d.membros) {
      if (vistos.has(m.chave) || respondeuChave.has(m.chave)) continue;
      vistos.add(m.chave);
      // safeLink também aqui: o nome de família é digitado pela própria pessoa no /register e
      // "Mc[clique](https://…)" viraria link de verdade dentro da mensagem oficial da chamada
      pendentes.push(safeLink(m.familia));
    }
  }

  /** O corpo inteiro num nível, linha a linha ("" separa seções) — refeito a cada tentativa. */
  const corpoEm = (n: number): string[] => {
    const L: string[] = [];
    const sep = () => { if (L.length) L.push(""); };
    for (const pt of d.funcoes) {
      const ids = marcasPorFuncao.get(pt.id) ?? [];
      const gss = ids.map((u) => dados(u).p?.gs).filter((x): x is number => x != null);
      const media = gss.length ? Math.round(gss.reduce((a, b) => a + b, 0) / gss.length) : null;
      sep();
      L.push(`${pt.emoji ? pt.emoji + " " : ""}**${pt.nome}** — ${ids.length}${media != null ? ` · GS ${media}` : ""}`);
      L.push(...(ids.length ? moldura(ids, n) : ["> _(ninguém)_"]));
    }
    if (naoVao.length) {
      sep();
      L.push(`**❌ Não vão — ${naoVao.length}**`);
      // menção custa 21 chars e aqui só serve de rótulo: a partir do nível 1 vale o nome de família
      L.push(...linhasDeNomes(naoVao.map((r) => (n === 0 || !r.familia ? `<@${r.user_id}>` : safeLink(r.familia)))));
    }
    if (pendentes.length) {
      sep();
      L.push(`**⬜ Não decididos — ${pendentes.length}**`);
      L.push(...linhasDeNomes(pendentes));
    }
    return L;
  };

  // pessoas distintas que marcaram (com marca única por rodada, = total de marcas). Só conta quem
  // o corpo DESENHA: tirar uma função do preset depois de gente ter marcado deixa marcas órfãs, e
  // o título anunciava "12 marcaram" com 9 nomes na lista.
  const idsFuncao = new Set(d.funcoes.map((f) => f.id));
  const pessoas = new Set(d.marcas.filter((m) => idsFuncao.has(m.funcao_id)).map((m) => m.user_id)).size;
  const titulo = `📢 ${d.presetNome} — ${pessoas} marcaram`.slice(0, 256);
  const topo = d.mensagem ? d.mensagem.trim().slice(0, 1500) : "";
  // o título conta no teto de 6000. custoLinhas é limite SUPERIOR: cada transbordo descarta o "\n"
  // da emenda, então o que sai é sempre ≤ o previsto. A folga é só margem defensiva (se algum dia
  // entrar footer ou author aqui, ela absorve).
  const orcamento = LIM_TOTAL - titulo.length - 40;

  const cabecalho = topo ? [topo, ""] : [];
  const custo = (L: string[]) => custoLinhas([...cabecalho, ...L]);

  // desce de nível até caber a lista INTEIRA — uniforme e completa vale mais que bonita e cortada
  let nivel = 0;
  let linhas = corpoEm(0);
  while (nivel < NIVEL_MIN && custo(linhas) > orcamento) { nivel++; linhas = corpoEm(nivel); }

  // guerra grande demais até no nível mais barato: aí sim corta o fim, avisando
  const corte = cortarAteCaber([...cabecalho, ...linhas], orcamento);

  // transborda pro embed seguinte em vez de truncar: 10 embeds por mensagem, uma descrição cada
  const usadas = empacotarDescricoes(corte.linhas);
  if (!usadas.length) usadas.push("_(sem funções configuradas)_");

  const embeds = usadas.map((desc, i) => ({
    ...(i === 0 ? { title: titulo } : {}),
    description: desc,
    color: COR, // em todos, pra barra vermelha ficar contínua e parecer um bloco só
    // imagem no ÚLTIMO embed: no primeiro ela entraria no meio da lista
    ...(d.imagem && i === usadas.length - 1 ? { image: { url: d.imagem } } : {}),
  }));

  // botões: um por função (neutro, ícone + contagem) + ❌. Sem emoji → cai pro nome curto.
  const botoes = d.funcoes.slice(0, MAX_BOTOES).map((pt) => {
    const e = emojiDiscord(pt.emoji);
    return {
      type: 2, style: 2,
      custom_id: `int:fn:${d.presetId}:${pt.id}`,
      ...(e ? { emoji: e } : {}),
      label: e ? String((marcasPorFuncao.get(pt.id) ?? []).length) : `${pt.nome.slice(0, 10)} ${(marcasPorFuncao.get(pt.id) ?? []).length}`,
    };
  });
  botoes.push({ type: 2, style: 4, custom_id: `int:nao:${d.presetId}`, label: "❌ Não vou" } as (typeof botoes)[number]);
  // NÃO existe botão de refresh aqui: redesenhar é ação de administração e fica só no site.
  // (O endpoint ainda atende `int:sync:`, exigindo staff, porque mensagens antigas têm o botão.)

  const components: { type: 1; components: typeof botoes }[] = [];
  for (let i = 0; i < botoes.length; i += 5) components.push({ type: 1, components: botoes.slice(i, i + 5) });

  return { embeds, components };
}
