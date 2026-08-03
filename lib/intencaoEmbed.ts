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
 */

export type FuncaoI = { id: number; nome: string; emoji: string | null };
export type MarcaI = { user_id: string; funcao_id: number };
export type RespI = { user_id: string; familia: string | null; chave: string | null; resposta: "vai" | "nao" };
export type MembroI = { chave: string; familia: string; funcao_id: number };
export type PerfilI = { guilda: string; classe: string | null; gs: number | null };
export type EmojiMapI = { classes: Record<string, string>; guildas: Record<string, string> };

const COR = 0xcc0000; // carmesim (tema da aliança) — barra do embed
const MAX_BOTOES = 24; // 5 linhas x 5 = 25, menos o ❌

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
  membros?: MembroI[];        // função de casa (intencao_membro) — vira a lista de não decididos
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

  // linha de uma pessoa: {emoji guilda} · Nome(clicável) · GS · {emoji classe}. Emoji FORA do link
  // (custom não renderiza dentro de link mascarado); blockquote mantém o link clicável.
  const linha = (userId: string): string => {
    const r = respPorUser.get(userId);
    const nomeFam = r?.familia ?? d.nomePorUser?.get(userId) ?? null;
    const p = r?.chave ? d.perfil?.get(r.chave) : undefined;
    const gEmoji = (p?.guilda && d.emojis?.guildas[p.guilda]) || (p?.guilda && tags[p.guilda]) || "";
    const cEmoji = (p?.classe && d.emojis?.classes[p.classe]) || (p?.classe ? `(${safeLink(p.classe)})` : "");
    const nome = nomeFam ? `[${safeLink(nomeFam)}](https://discord.com/users/${userId})` : `<@${userId}>`;
    return [gEmoji, nome, p?.gs != null ? String(p.gs) : null, cEmoji].filter(Boolean).join(" · ");
  };
  const moldura = (ids: string[]) => "> " + ids.map(linha).join("\n> ");

  const secoes: string[] = [];
  for (const pt of d.funcoes) {
    const ids = marcasPorFuncao.get(pt.id) ?? [];
    const gss = ids.map((u) => { const r = respPorUser.get(u); return r?.chave ? d.perfil?.get(r.chave)?.gs : null; })
      .filter((x): x is number => x != null);
    const media = gss.length ? Math.round(gss.reduce((a, b) => a + b, 0) / gss.length) : null;
    const cab = `${pt.emoji ? pt.emoji + " " : ""}**${pt.nome}** — ${ids.length}${media != null ? ` · GS ${media}` : ""}`;
    secoes.push(`${cab}\n${ids.length ? moldura(ids) : "> _(ninguém)_"}`);
  }

  const naoVao = d.respostas.filter((r) => r.resposta === "nao");
  if (naoVao.length) secoes.push(`**❌ Não vão — ${naoVao.length}**\n${naoVao.map((r) => `<@${r.user_id}>`).join(", ")}`);

  // não decididos = quem tem função de casa e não respondeu nada (nem marca, nem ❌)
  if (d.membros?.length) {
    const respondeuChave = new Set(d.respostas.map((r) => r.chave).filter(Boolean) as string[]);
    const vistos = new Set<string>();
    const pendentes: string[] = [];
    for (const m of d.membros) {
      if (vistos.has(m.chave) || respondeuChave.has(m.chave)) continue; // membro aparece 1x por função
      vistos.add(m.chave);
      pendentes.push(m.familia);
    }
    if (pendentes.length) secoes.push(`**⬜ Não decididos — ${pendentes.length}**\n${pendentes.join(", ")}`);
  }

  // pessoas distintas que marcaram (com marca única por rodada, = total de marcas)
  const pessoas = new Set(d.marcas.map((m) => m.user_id)).size;
  const topo = d.mensagem ? d.mensagem.trim().slice(0, 1500) + "\n\n" : "";
  let corpo = "", cortou = false;
  for (const s of secoes) {
    if ((topo + corpo + (corpo ? "\n\n" : "") + s).length > 3980) { cortou = true; break; }
    corpo += (corpo ? "\n\n" : "") + s;
  }
  const desc = (topo + corpo + (cortou ? "\n\n⚠ +itens não exibidos (limite do Discord)." : "")).slice(0, 4096);

  const embed = {
    title: `📢 ${d.presetNome} — ${pessoas} marcaram`.slice(0, 256),
    description: desc,
    color: COR,
    ...(d.imagem ? { image: { url: d.imagem } } : {}),
  };

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

  return { embeds: [embed], components };
}
