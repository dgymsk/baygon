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
  ordem: number | null;   // posição na fila da chamada (1 = marcou primeiro); null = entrou sem marcar
};
export type PerfilEmojis = { classes: Record<string, string>; guildas: Record<string, string> };

const COR = 0xcc0000;
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
  // dentro da PT, quem marcou primeiro vem primeiro — é o critério que a staff usa pra priorizar.
  // Quem entrou sem passar pela chamada (ordem null) vai pro fim, não pro começo.
  for (const a of porParty.values()) {
    a.sort((x, y) => (x.ordem ?? 1e9) - (y.ordem ?? 1e9) || x.familia.localeCompare(y.familia, "pt-BR"));
  }

  const linha = (e: EscaladoL): string => {
    const gEmoji = (e.guilda && d.emojis?.guildas[e.guilda]) || (e.guilda && tags[e.guilda]) || "";
    const cEmoji = (e.classe && d.emojis?.classes[e.classe]) || (e.classe ? `(${safeLink(e.classe)})` : "");
    const nome = e.userId ? `[${safeLink(e.familia)}](https://discord.com/users/${e.userId})` : safeLink(e.familia);
    // ✅ confirmou a escalação · ⏳ ainda não respondeu — o mesmo sinal que a staff vê no site
    const sinal = e.confirmouEscalacao === true ? "✅" : e.confirmouEscalacao === false ? "❌" : "⏳";
    // posição na fila em largura fixa pra as linhas alinharem; 🎮 = já apareceu na conferência
    // in-game, e é a ausência dele que a cobrança de "participar" vai atrás
    const pos = "`#" + (e.ordem != null ? String(e.ordem).padStart(2, "0") : "--") + "`";
    return [pos, sinal, e.confirmouIngame ? "🎮" : null, gEmoji, nome, e.gs != null ? String(e.gs) : null, cEmoji].filter(Boolean).join(" · ");
  };
  const moldura = (es: EscaladoL[]) => "> " + es.map(linha).join("\n> ");

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
  const rodape = "\n\n✅ confirmou · ⏳ aguardando resposta";
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
