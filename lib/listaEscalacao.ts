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
 */
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

  const linha = (e: EscaladoL, i: number): string => {
    const gEmoji = (e.guilda && d.emojis?.guildas[e.guilda]) || (e.guilda && tags[e.guilda]) || "";
    const cEmoji = (e.classe && d.emojis?.classes[e.classe]) || (e.classe ? `(${safeLink(e.classe)})` : "");
    // menção de verdade (<@id>) em vez de link mascarado: vira o chip do Discord, com avatar no
    // hover, e a pessoa se acha na lista pelo próprio nome do servidor. Sem user_id vinculado
    // (escalado à mão, sem registro) sobra o nome de família em texto.
    const nome = e.userId ? `<@${e.userId}>` : safeLink(e.familia);
    // um sinal só, e o IN-GAME tem prioridade: quem já apareceu no jogo respondeu na prática a
    // pergunta que o ⏳ fazia. "Aguardando resposta" ao lado de "está no jogo" era contradição na
    // mesma linha.
    const sinal = e.confirmouIngame ? "🎮"
      : e.confirmouEscalacao === true ? "✅"
      : e.confirmouEscalacao === false ? "❌" : "⏳";
    // 👑 = líder (quem a staff pôs em primeiro). Quem não é líder recebe o espaço no lugar da
    // coroa: sem isso a linha de baixo começava deslocada, e o olho perde a coluna do nome.
    // O Discord usa fonte proporcional fora de code block, então isso aproxima — não casa ao pixel.
    const marca = i === 0 ? "👑" : (d.vazio || VAZIO_FALLBACK);
    // 🔴 filler: entrou na PT sem ter marcado na chamada. Fica na própria linha, junto de quem
    // ele está jogando — separá-lo numa seção dizia "tem alguém sobrando" sem dizer onde.
    return [marca, sinal, gEmoji, nome, e.gs != null ? String(e.gs) : null, cEmoji, e.filler ? "🔴" : null].filter(Boolean).join(" · ");
  };
  // índice explícito: `es.map(linha)` passaria o índice como 2º argumento por acidente, e aqui ele
  // decide quem leva a coroa — melhor deixar à vista
  const moldura = (es: EscaladoL[]) => "> " + es.map((e, i) => linha(e, i)).join("\n> ");

  const secoes: string[] = [];
  for (const p of d.parties) {
    const dentro = porParty.get(p.id) ?? [];
    const gss = dentro.map((e) => e.gs).filter((x): x is number => x != null);
    const media = gss.length ? Math.round(gss.reduce((a, b) => a + b, 0) / gss.length) : null;
    const cab = `${p.icone ? p.icone + " " : ""}**${p.nome}** — ${dentro.length}${media != null ? ` · GS ${media}` : ""}`;
    secoes.push(`${cab}\n${dentro.length ? moldura(dentro) : "> _(vazia)_"}`);
  }
  if (d.recusaram?.length) secoes.push(`**❌ Não vão — ${d.recusaram.length}**\n${d.recusaram.join(", ")}`);

  const total = d.escalados.filter((e) => e.partyId != null).length;
  const ok = d.escalados.filter((e) => e.partyId != null && e.confirmouEscalacao === true).length;
  const topo = d.nota ? d.nota.trim().slice(0, 1000) + "\n\n" : "";
  let corpo = "", cortou = false;
  for (const s of secoes) {
    if ((topo + corpo + (corpo ? "\n\n" : "") + s).length > 3900) { cortou = true; break; }
    corpo += (corpo ? "\n\n" : "") + s;
  }
  const rodape = "\n\n👑 líder da PT · 🔴 filler · 🎮 está no jogo · ✅ confirmou na DM · ⏳ aguardando · ❌ recusou";
  const desc = (topo + corpo + (cortou ? "\n\n⚠ +itens não exibidos (limite do Discord)." : "") + rodape).slice(0, 4096);

  return {
    embeds: [{
      title: `📋 Escalação — ${d.titulo}${d.data ? ` · ${d.data}` : ""}`.slice(0, 256),
      description: desc,
      color: COR,
      footer: { text: `${ok}/${total} confirmados${d.tamanhoMax ? ` · meta ${d.tamanhoMax}` : ""}` },
    }],
  };
}
