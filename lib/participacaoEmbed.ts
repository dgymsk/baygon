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

const COR = 0x34e06a; // cor "brand" do cabeçalho/rodapé
// paleta de fallback: PTs sem cor definida recebem uma cor distinta por posição
const PALETA = [0xe0344e, 0x34e06a, 0x3aa0ff, 0xe0b634, 0xa06bff, 0xff7a3a, 0x34d1e0, 0xe0349e];
const corHexInt = (hex: string | undefined) => { const m = /^#([0-9a-fA-F]{6})$/.exec((hex ?? "").trim()); return m ? parseInt(m[1], 16) : null; };
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

export function montarEmbed(cfg: TipoCfg, templateId: number, tpl: TemplateE, ptsCat: PtE[], membros: MembroE[], respostas: RespE[]) {
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

  type Embed = { title?: string; description?: string; color: number; fields?: { name: string; value: string; inline?: boolean }[]; image?: { url: string } };

  // 1 card (embed) por PT — a barra colorida do card usa a cor do PT (ou a paleta por posição).
  const naoDecididos: MembroE[] = [];
  const ptEmbeds: Embed[] = [];
  tpl.pts.forEach((tp, i) => {
    const pt = ptById.get(tp.pt_id);
    if (!pt) return;
    const conf: MembroE[] = [];
    const esp: MembroE[] = [];
    for (const m of membrosPorPt.get(tp.pt_id) ?? []) {
      const r = respByChave.get(m.chave);
      if (!r) { naoDecididos.push(m); continue; } // ⬜ sem resposta → lista no rodapé
      if (r.resposta === "cant") continue;          // ❌ → lista "Não vão"
      (confirmados.has(r.user_id) ? conf : esp).push(m);
    }
    const linhas = conf.map((m) => `✅ ${nomeCh(m.chave, m.familia)}`);
    if (esp.length) { linhas.push("**⏳ Espera**"); for (const m of esp) linhas.push(`⏳ ${nomeCh(m.chave, m.familia)}`); }
    const cap = tp.limite != null ? `/${tp.limite}` : "";
    ptEmbeds.push({
      title: `${pt.emoji ? pt.emoji + " " : ""}${pt.nome} — ${conf.length}${cap}`.slice(0, 256),
      description: (linhas.length ? linhas.join("\n") : "_(ninguém)_").slice(0, 4096),
      color: corHexInt(pt.cor) ?? PALETA[i % PALETA.length],
    });
  });

  // cabeçalho (título + totais + mensagem)
  const capStr = tpl.tamanho_max != null ? `${confirmados.size}/${tpl.tamanho_max}` : `${confirmados.size}`;
  const esperaStr = espera.size > 0 ? ` · ⏳ ${espera.size} espera` : "";
  const header: Embed = { title: `📢 ${tpl.nome} — ${capStr} confirmados${esperaStr}`.slice(0, 256), color: COR };
  if (cfg.mensagem) header.description = cfg.mensagem.slice(0, 2000);

  // rodapé: listas globais (Sem PT / Não decididos / Não vão) + imagem no final
  const semPtCan = respostas.filter((r) => r.resposta === "can" && (!r.chave || !chavesAtrib.has(r.chave)));
  const cant = respostas.filter((r) => r.resposta === "cant");
  const footFields: { name: string; value: string; inline?: boolean }[] = [];
  if (semPtCan.length) footFields.push({ name: `🆕 Sem PT — ${semPtCan.length}`, value: semPtCan.map((r) => `${espera.has(r.user_id) ? "⏳" : "✅"} <@${r.user_id}>`).join("  ").slice(0, 1024) });
  if (naoDecididos.length) footFields.push({ name: `⬜ Não decididos — ${naoDecididos.length}`, value: naoDecididos.map((m) => nomeCh(m.chave, m.familia)).join(", ").slice(0, 1024) });
  if (cant.length) footFields.push({ name: `❌ Não vão — ${cant.length}`, value: cant.map((r) => `<@${r.user_id}>`).join(", ").slice(0, 1024) });
  const footer: Embed | null = footFields.length || cfg.imagem
    ? { color: COR, ...(footFields.length ? { fields: footFields } : {}), ...(cfg.imagem ? { image: { url: cfg.imagem } } : {}) }
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
