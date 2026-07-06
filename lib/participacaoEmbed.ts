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
export type TemplateE = { nome: string; tamanho_max: number | null; pts: number[] };

const COR = 0x34e06a;

/** Classifica os Can em confirmados (primeiros tamanho_max por can_em) vs espera. Chaveado por user_id. */
export function classificar(respostas: { user_id: string; resposta: "can" | "cant"; can_em: string | null }[], max: number | null): { confirmados: Set<string>; espera: Set<string> } {
  const cans = respostas.filter((r) => r.resposta === "can").sort((a, b) => (a.can_em ?? "").localeCompare(b.can_em ?? ""));
  const confirmados = new Set<string>();
  const espera = new Set<string>();
  cans.forEach((r, i) => (max == null || i < max ? confirmados : espera).add(r.user_id));
  return { confirmados, espera };
}

export function montarEmbed(cfg: TipoCfg, templateId: number, tpl: TemplateE, ptsCat: PtE[], membros: MembroE[], respostas: RespE[]) {
  const { confirmados, espera } = classificar(respostas, tpl.tamanho_max);
  const respByChave = new Map<string, RespE>();
  for (const r of respostas) if (r.chave) respByChave.set(r.chave, r);
  const ptById = new Map(ptsCat.map((p) => [p.id, p]));
  const membrosPorPt = new Map<number, MembroE[]>();
  for (const m of membros) { const a = membrosPorPt.get(m.pt_id) ?? []; a.push(m); membrosPorPt.set(m.pt_id, a); }
  const chavesAtrib = new Set(membros.map((m) => m.chave));

  const statusU = (userId: string, resp: "can" | "cant") => (resp === "cant" ? "❌" : confirmados.has(userId) ? "✅" : "⏳");
  const statusCh = (chave: string) => { const r = respByChave.get(chave); return r ? statusU(r.user_id, r.resposta) : "⬜"; };
  const nomeCh = (chave: string, familia: string) => { const r = respByChave.get(chave); return r?.user_id ? `<@${r.user_id}>` : familia; };
  const ordem = { "✅": 0, "⏳": 1, "⬜": 2, "❌": 3 } as Record<string, number>;

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  for (const pid of tpl.pts) {
    const pt = ptById.get(pid);
    if (!pt) continue;
    const mem = (membrosPorPt.get(pid) ?? []).slice().sort((a, b) => ordem[statusCh(a.chave)] - ordem[statusCh(b.chave)]);
    const conf = mem.filter((m) => { const r = respByChave.get(m.chave); return r && r.resposta === "can" && confirmados.has(r.user_id); }).length;
    const linhas = mem.map((m) => `${statusCh(m.chave)} ${nomeCh(m.chave, m.familia)}`);
    const pref = pt.emoji ? `${pt.emoji} ` : "";
    fields.push({ name: `${pref}${pt.nome} — ${conf}`.slice(0, 256), value: (linhas.length ? linhas.join("\n") : "_(vazio)_").slice(0, 1024), inline: true });
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
