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

const COR = 0xcc0000; // carmesim (tema Manicômio) — barra do embed único

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

  // A LINHA TODA vira o texto de UM link (fica clicável e numa cor só). Dentro do link não pode ter
  // colchete (fecharia o link cedo) → classe entre parênteses, tag sem colchete.
  const linhaMembro = (m: MembroE): string => {
    const p = perfil?.get(m.chave);
    const r = respByChave.get(m.chave);
    const t = tag3(p?.guilda);
    const texto = [t, safeLink(m.familia), p?.gs != null ? String(p.gs) : null, p?.classe ? `(${safeLink(p.classe)})` : null].filter(Boolean).join(" ");
    return r?.user_id ? `[${texto}](https://discord.com/users/${r.user_id})` : texto;
  };

  // UMA mensagem só: cada PT é uma SEÇÃO no mesmo embed (sem cards separados). Espera/undecided/can't idem.
  const naoDecididos: MembroE[] = [];
  const esperaGlobal: MembroE[] = [];
  const secoes: string[] = [];
  tpl.pts.forEach((tp) => {
    const pt = ptById.get(tp.pt_id);
    if (!pt) return;
    const conf: MembroE[] = [];
    for (const m of membrosPorPt.get(tp.pt_id) ?? []) {
      const r = respByChave.get(m.chave);
      if (!r) { naoDecididos.push(m); continue; } // ⬜ sem resposta
      if (r.resposta === "cant") continue;          // ❌ não vão
      if (confirmados.has(r.user_id)) conf.push(m); else esperaGlobal.push(m); // ⏳ espera → seção separada
    }
    const gss = conf.map((m) => perfil?.get(m.chave)?.gs).filter((x): x is number => x != null);
    const media = gss.length ? Math.round(gss.reduce((a, b) => a + b, 0) / gss.length) : null;
    const cap = tp.limite != null ? `/${tp.limite}` : "";
    const cab = `${pt.emoji ? pt.emoji + " " : ""}**${pt.nome}** — ${conf.length}${cap}${media != null ? ` · GS ${media}` : ""}`;
    secoes.push(`${cab}\n${conf.length ? conf.map(linhaMembro).join("\n") : "_(ninguém)_"}`);
  });

  const semPtCan = respostas.filter((r) => r.resposta === "can" && (!r.chave || !chavesAtrib.has(r.chave)));
  const cant = respostas.filter((r) => r.resposta === "cant");
  if (esperaGlobal.length) secoes.push(`**⏳ Espera — ${esperaGlobal.length}**\n${esperaGlobal.map(linhaMembro).join("\n")}`);
  if (semPtCan.length) secoes.push(`**🆕 Sem PT — ${semPtCan.length}**\n${semPtCan.map((r) => `${espera.has(r.user_id) ? "⏳ " : ""}<@${r.user_id}>`).join(" ")}`);
  if (naoDecididos.length) secoes.push(`**⬜ Não decididos — ${naoDecididos.length}**\n${naoDecididos.map((m) => m.familia).join(", ")}`);
  if (cant.length) secoes.push(`**❌ Não vão — ${cant.length}**\n${cant.map((r) => `<@${r.user_id}>`).join(", ")}`);

  // description única, respeitando 4096 (corta seções do fim + avisa)
  const capStr = tpl.tamanho_max != null ? `${confirmados.size}/${tpl.tamanho_max}` : `${confirmados.size}`;
  const esperaStr = espera.size > 0 ? ` · ⏳ ${espera.size} espera` : "";
  const topo = cfg.mensagem ? cfg.mensagem.trim().slice(0, 1500) + "\n\n" : "";
  let corpo = "";
  let cortou = false;
  for (const s of secoes) {
    if ((topo + corpo + (corpo ? "\n\n" : "") + s).length > 3980) { cortou = true; break; }
    corpo += (corpo ? "\n\n" : "") + s;
  }
  const desc = (topo + corpo + (cortou ? "\n\n⚠ +itens não exibidos (limite do Discord)." : "")).slice(0, 4096);

  const embed = {
    title: `📢 ${tpl.nome} — ${capStr} confirmados${esperaStr}`.slice(0, 256),
    description: desc,
    color: COR,
    ...(cfg.imagem ? { image: { url: cfg.imagem } } : {}),
  };
  const components = [{
    type: 1,
    components: [
      { type: 2, style: 3, label: "Can", custom_id: `part:can:${templateId}` },
      { type: 2, style: 4, label: "Cant", custom_id: `part:cant:${templateId}` },
    ],
  }];
  return { embeds: [embed], components };
}
