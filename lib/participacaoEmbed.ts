import type { TipoCfg } from "@/lib/participacaoConfig";

/**
 * Monta o payload da mensagem do bot a partir de um TEMPLATE (PTs escolhidos + tamanho_max).
 * Staff pré-atribui os jogadores aos PTs (por tipo). Cada PT mostra seus atribuídos com status:
 * ✅ confirmado (dentro do tamanho_max) / ⏳ espera (excedeu) / ❌ não vai / ⬜ sem resposta.
 * A ESPERA é global por ordem de confirmação (can_em): os primeiros `tamanho_max` cans entram;
 * o resto fica na espera (quem sai libera vaga). PURO — usado no postar e no rebuild ao vivo.
 */
export type PtE = { id: number; nome: string; emoji: string; cor: string };
export type MembroE = { chave: string; familia: string; pt_id: number };
export type RespE = { user_id: string; chave: string | null; resposta: "can" | "cant"; can_em: string | null };
export type TemplateE = { nome: string; tamanho_max: number | null; pts: { pt_id: number; limite: number | null }[] };

// tema Manicômio: couro/grafite, sangue/carmesim, aço/cinza, giz. Barras dos cards no carmesim/aço.
const COR = 0xcc0000; // carmesim — brand do cabeçalho
const ACO = 0x737373; // aço — rodapé
const PALETA = [0xcc0000, 0x737373, 0x990000, 0xa6a6a6]; // carmesim / aço / sangue / prata (rotativo por PT)
// custo em caracteres de um embed (title+description+fields+footer) — pro teto AGREGADO de 6000/mensagem
const custoEmbed = (e: { title?: string; description?: string; fields?: { name: string; value: string }[]; footer?: { text: string } }) =>
  (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.fields?.reduce((s, f) => s + f.name.length + f.value.length, 0) ?? 0) + (e.footer?.text?.length ?? 0);

/**
 * Espera POR PT: em cada PT, os primeiros `limite` a confirmar (ordem can_em) entram (✅);
 * o resto fica na espera daquele PT (⏳). PTs sem limite → todos entram. Quem deu Can e não
 * está em nenhum PT do template → confirmado (sem limite). Chaveado por user_id.
 */
export function classificarPorPt(
  tplPts: { pt_id: number; limite: number | null }[],
  membros: { chave: string; pt_id: number }[],
  respostas: { user_id: string; chave: string | null; resposta: "can" | "cant"; can_em: string | null }[],
): { confirmados: Set<string>; espera: Set<string> } {
  const respByChave = new Map<string, { user_id: string; can_em: string | null }>();
  for (const r of respostas) if (r.chave && r.resposta === "can") respByChave.set(r.chave, r);
  const chavesPorPt = new Map<number, string[]>();
  for (const m of membros) { const a = chavesPorPt.get(m.pt_id) ?? []; a.push(m.chave); chavesPorPt.set(m.pt_id, a); }
  const confirmados = new Set<string>();
  const espera = new Set<string>();
  const chavesNoTpl = new Set<string>();
  for (const tp of tplPts) {
    const chaves = chavesPorPt.get(tp.pt_id) ?? [];
    for (const ch of chaves) chavesNoTpl.add(ch);
    const cans = chaves.map((ch) => respByChave.get(ch)).filter((r): r is { user_id: string; can_em: string | null } => !!r)
      .sort((a, b) => { const c = (a.can_em ?? "").localeCompare(b.can_em ?? ""); return c !== 0 ? c : a.user_id.localeCompare(b.user_id); });
    cans.forEach((r, i) => (tp.limite == null || i < tp.limite ? confirmados : espera).add(r.user_id));
  }
  // deu Can mas não está em PT do template → confirmado (sem limite de PT)
  for (const r of respostas) if (r.resposta === "can" && (!r.chave || !chavesNoTpl.has(r.chave))) confirmados.add(r.user_id);
  return { confirmados, espera };
}

export type PerfilE = { guilda: string; classe: string | null; gs: number | null };
const tag3 = (g?: string | null) => (g === "RESO" ? "RES" : g === "MANI" ? "MAN" : null); // null = guilda desconhecida → sem tag
const safeLink = (s: string) => (s || "?").replace(/[`[\]()\n]/g, "").trim() || "?"; // texto seguro p/ [texto](url)

export function montarEmbed(cfg: TipoCfg, templateId: number, tpl: TemplateE, ptsCat: PtE[], membros: MembroE[], respostas: RespE[], perfil?: Map<string, PerfilE>) {
  const { confirmados, espera } = classificarPorPt(tpl.pts, membros, respostas);
  const respByChave = new Map<string, RespE>();
  for (const r of respostas) if (r.chave) respByChave.set(r.chave, r);
  const ptById = new Map(ptsCat.map((p) => [p.id, p]));
  const membrosPorPt = new Map<number, MembroE[]>();
  for (const m of membros) { const a = membrosPorPt.get(m.pt_id) ?? []; a.push(m); membrosPorPt.set(m.pt_id, a); }
  // só quem está num PT DO TEMPLATE conta como atribuído; atribuído a PT fora do template → "Sem PT"
  const ptsTpl = new Set(tpl.pts.map((tp) => tp.pt_id));
  const chavesAtrib = new Set(membros.filter((m) => ptsTpl.has(m.pt_id)).map((m) => m.chave));

  const nomeCh = (chave: string, familia: string) => { const r = respByChave.get(chave); return r?.user_id ? `<@${r.user_id}>` : familia; };
  // nick de família CLICÁVEL (link pro perfil, como antes) + [TAG] GS [Classe] em texto puro (sem caixas monospace).
  const linhaMembro = (m: MembroE): string => {
    const p = perfil?.get(m.chave);
    const r = respByChave.get(m.chave);
    const nick = r?.user_id ? `[${safeLink(m.familia)}](https://discord.com/users/${r.user_id})` : safeLink(m.familia);
    const t = tag3(p?.guilda);
    return `${t ? `[${t}] ` : ""}${nick}${p?.gs != null ? ` ${p.gs}` : ""}${p?.classe ? ` [${p.classe}]` : ""}`;
  };

  type Embed = { title?: string; description?: string; color: number; fields?: { name: string; value: string; inline?: boolean }[]; image?: { url: string } };

  // 1 card (embed) por PT com SÓ os confirmados; barra no tema (carmesim/aço, rotativo). Espera vai separada no rodapé.
  const naoDecididos: MembroE[] = [];
  const esperaGlobal: MembroE[] = [];
  const ptEmbeds: Embed[] = [];
  tpl.pts.forEach((tp, i) => {
    const pt = ptById.get(tp.pt_id);
    if (!pt) return;
    const conf: MembroE[] = [];
    for (const m of membrosPorPt.get(tp.pt_id) ?? []) {
      const r = respByChave.get(m.chave);
      if (!r) { naoDecididos.push(m); continue; } // ⬜ sem resposta → lista no rodapé
      if (r.resposta === "cant") continue;          // ❌ → lista "Não vão"
      if (confirmados.has(r.user_id)) conf.push(m); else esperaGlobal.push(m); // ⏳ espera → seção separada
    }
    const gss = conf.map((m) => perfil?.get(m.chave)?.gs).filter((x): x is number => x != null);
    const media = gss.length ? Math.round(gss.reduce((a, b) => a + b, 0) / gss.length) : null;
    const cap = tp.limite != null ? `/${tp.limite}` : "";
    ptEmbeds.push({
      title: `${pt.emoji ? pt.emoji + " " : ""}${pt.nome} — ${conf.length}${cap}${media != null ? ` · GS ${media}` : ""}`.slice(0, 256),
      description: (conf.length ? conf.map(linhaMembro).join("\n") : "_(ninguém)_").slice(0, 4096),
      color: PALETA[i % PALETA.length],
    });
  });

  // cabeçalho (título + totais + mensagem)
  const capStr = tpl.tamanho_max != null ? `${confirmados.size}/${tpl.tamanho_max}` : `${confirmados.size}`;
  const esperaStr = espera.size > 0 ? ` · ⏳ ${espera.size} espera` : "";
  const header: Embed = { title: `📢 ${tpl.nome} — ${capStr} confirmados${esperaStr}`.slice(0, 256), color: COR };
  if (cfg.mensagem) header.description = cfg.mensagem.slice(0, 2000);

  // rodapé: seções SEPARADAS (Espera / Sem PT / Não decididos / Não vão) + imagem no final
  const semPtCan = respostas.filter((r) => r.resposta === "can" && (!r.chave || !chavesAtrib.has(r.chave)));
  const cant = respostas.filter((r) => r.resposta === "cant");
  const footFields: { name: string; value: string; inline?: boolean }[] = [];
  if (esperaGlobal.length) footFields.push({ name: `⏳ Espera — ${esperaGlobal.length}`, value: esperaGlobal.map(linhaMembro).join("\n").slice(0, 1024) });
  if (semPtCan.length) footFields.push({ name: `🆕 Sem PT — ${semPtCan.length}`, value: semPtCan.map((r) => `${espera.has(r.user_id) ? "⏳" : "✅"} <@${r.user_id}>`).join("  ").slice(0, 1024) });
  if (naoDecididos.length) footFields.push({ name: `⬜ Não decididos — ${naoDecididos.length}`, value: naoDecididos.map((m) => nomeCh(m.chave, m.familia)).join(", ").slice(0, 1024) });
  if (cant.length) footFields.push({ name: `❌ Não vão — ${cant.length}`, value: cant.map((r) => `<@${r.user_id}>`).join(", ").slice(0, 1024) });
  const footer: Embed | null = footFields.length || cfg.imagem
    ? { color: ACO, ...(footFields.length ? { fields: footFields } : {}), ...(cfg.imagem ? { image: { url: cfg.imagem } } : {}) }
    : null;

  // Limites do Discord por MENSAGEM: no máx 10 embeds E a soma de todos os textos <= 6000 chars.
  // Corta PT embeds do fim até caber nos dois; avisa no header (PREFIXADO, pra o aviso não ser truncado).
  const footerArr = footer ? [footer] : [];
  let nPts = ptEmbeds.length;
  const totalChars = () => custoEmbed(header) + ptEmbeds.slice(0, nPts).reduce((s, x) => s + custoEmbed(x), 0) + footerArr.reduce((s, x) => s + custoEmbed(x), 0);
  while (nPts > 0 && (1 + nPts + footerArr.length > 10 || totalChars() > 5900)) nPts--; // 5900: margem pro aviso
  const cortados = ptEmbeds.length - nPts;
  if (cortados > 0) header.description = `⚠ +${cortados} PT(s) não exibidos (limite do Discord).${header.description ? "\n" + header.description : ""}`.slice(0, 2000);
  const embedsFinal: Embed[] = [header, ...ptEmbeds.slice(0, nPts), ...footerArr];
  const components = [{
    type: 1,
    components: [
      { type: 2, style: 3, label: "Can", custom_id: `part:can:${templateId}` },
      { type: 2, style: 4, label: "Cant", custom_id: `part:cant:${templateId}` },
    ],
  }];
  return { embeds: embedsFinal, components };
}
