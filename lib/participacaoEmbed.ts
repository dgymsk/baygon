import type { TipoCfg } from "@/lib/participacaoConfig";

/**
 * Monta o payload da mensagem do bot a partir de um TEMPLATE (PTs escolhidos + tamanho_max).
 * Staff pré-atribui os jogadores aos PTs (por tipo). Cada PT mostra seus atribuídos com status:
 * ✅ confirmado (dentro do tamanho_max) / ⏳ espera (excedeu) / ❌ não vai / ⬜ sem resposta.
 * A ESPERA é global por ordem de confirmação (can_em): os primeiros `tamanho_max` cans entram;
 * o resto fica na espera (quem sai libera vaga). PURO — usado no postar e no rebuild ao vivo.
 */
export type PtE = { id: number; nome: string; emoji: string };
export type MembroE = { chave: string; familia: string; pt_id: number };
export type RespE = { user_id: string; chave: string | null; resposta: "can" | "cant"; can_em: string | null };
export type TemplateE = { nome: string; tamanho_max: number | null; pts: { pt_id: number; limite: number | null }[] };

const COR = 0x34e06a;

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

  const statusU = (userId: string, resp: "can" | "cant") => (resp === "cant" ? "❌" : confirmados.has(userId) ? "✅" : "⏳");
  const statusCh = (chave: string) => { const r = respByChave.get(chave); return r ? statusU(r.user_id, r.resposta) : "⬜"; };
  const nomeCh = (chave: string, familia: string) => { const r = respByChave.get(chave); return r?.user_id ? `<@${r.user_id}>` : familia; };
  const ordem = { "✅": 0, "⏳": 1, "⬜": 2, "❌": 3 } as Record<string, number>;

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  for (const tp of tpl.pts) {
    const pt = ptById.get(tp.pt_id);
    if (!pt) continue;
    const mem = (membrosPorPt.get(tp.pt_id) ?? []).slice().sort((a, b) => ordem[statusCh(a.chave)] - ordem[statusCh(b.chave)]);
    const conf = mem.filter((m) => { const r = respByChave.get(m.chave); return r && r.resposta === "can" && confirmados.has(r.user_id); }).length;
    const linhas = mem.map((m) => `${statusCh(m.chave)} ${nomeCh(m.chave, m.familia)}`);
    const pref = pt.emoji ? `${pt.emoji} ` : "";
    const cap = tp.limite != null ? `/${tp.limite}` : "";
    fields.push({ name: `${pref}${pt.nome} — ${conf}${cap}`.slice(0, 256), value: (linhas.length ? linhas.join("\n") : "_(vazio)_").slice(0, 1024), inline: true });
  }

  const semPt = (r: RespE) => !r.chave || !chavesAtrib.has(r.chave);
  const semPtCan = respostas.filter((r) => r.resposta === "can" && semPt(r));
  if (semPtCan.length) fields.push({ name: `🆕 Sem PT — ${semPtCan.length}`, value: semPtCan.map((r) => `${statusU(r.user_id, "can")} <@${r.user_id}>`).join("\n").slice(0, 1024) });
  const cant = respostas.filter((r) => r.resposta === "cant" && semPt(r));
  if (cant.length) fields.push({ name: `❌ Não vão — ${cant.length}`, value: cant.map((r) => `<@${r.user_id}>`).join(" ").slice(0, 1024) });

  const capStr = tpl.tamanho_max != null ? `${confirmados.size}/${tpl.tamanho_max}` : `${confirmados.size}`;
  const esperaStr = espera.size > 0 ? ` · ⏳ ${espera.size} na espera` : "";
  const embed = { title: `${tpl.nome} — ${capStr} confirmados${esperaStr}`.slice(0, 256), description: (cfg.mensagem || undefined)?.slice(0, 4000), color: COR, fields: fields.slice(0, 25) };
  const components = [{
    type: 1,
    components: [
      { type: 2, style: 3, label: "Can", custom_id: `part:can:${templateId}` },
      { type: 2, style: 4, label: "Cant", custom_id: `part:cant:${templateId}` },
    ],
  }];
  return { embeds: [embed], components };
}
