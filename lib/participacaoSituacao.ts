import { classificarPorPt } from "@/lib/participacaoEmbed";
import { chaveNome } from "@/lib/nomes";
import { casarNome } from "@/lib/casarNome";

/**
 * Cálculo do ROSTER (situação de uma rodada) — PURO, sem I/O. É a MESMA função usada ao vivo
 * (app/participacao/page.tsx) e no SNAPSHOT do evento (lib/eventos.finalizarEvento), pra o histórico
 * nunca divergir da tela ao vivo. Os tipos VM moram aqui e são re-exportados por page.tsx.
 */
export type StatusResp = "can" | "espera" | "cant" | null;
export type MembroSit = { familia: string; userId: string | null; status: StatusResp };
export type SitPt = { id: number; nome: string; emoji: string; cor: string; limite: number | null; confirmados: MembroSit[]; espera: MembroSit[] };
export type SituacaoNN = { templateNome: string; tamanhoMax: number | null; totalConfirmados: number; totalEspera: number; pts: SitPt[]; semPt: MembroSit[]; naoDecididos: MembroSit[]; cant: MembroSit[] };
export type SituacaoVM = SituacaoNN | null;

type SitTpl = { nome: string; tamanho_max: number | null; pts: { pt_id: number; limite: number | null }[] };
type SitMembro = { chave: string; familia: string; pt_id: number };
type SitResp = { user_id: string; username: string; familia: string | null; chave: string | null; resposta: "can" | "cant"; can_em: string | null };
type SitPtCat = { id: number; nome: string; emoji: string; cor: string };

export function montarSituacao(tpl: SitTpl, membros: SitMembro[], respostas: SitResp[], ptById: Map<number, SitPtCat>, playersCands: { chave: string; nome: string }[]): SituacaoNN {
  const { confirmados, espera } = classificarPorPt(tpl.pts, membros, respostas); // espera POR PT
  const statusDe = (r: { user_id: string; resposta: "can" | "cant" }): StatusResp => (r.resposta === "cant" ? "cant" : confirmados.has(r.user_id) ? "can" : "espera");
  const respByChave = new Map(respostas.map((r) => [chaveNome(casarNome(r.familia || r.username, [], playersCands)), r]));
  const membrosPorPt = new Map<number, SitMembro[]>();
  for (const m of membros) { const a = membrosPorPt.get(m.pt_id) ?? []; a.push(m); membrosPorPt.set(m.pt_id, a); }
  const ptsTpl = new Set(tpl.pts.map((tp) => tp.pt_id));
  const chavesAtrib = new Set(membros.filter((m) => ptsTpl.has(m.pt_id)).map((m) => chaveNome(m.familia)));
  const sitMembro = (familia: string): MembroSit => { const r = respByChave.get(chaveNome(familia)); return { familia, userId: r?.user_id ?? null, status: r ? statusDe(r) : null }; };
  const naoDecididos: MembroSit[] = [];
  const pts: SitPt[] = tpl.pts.map((tp) => {
    const pt = ptById.get(tp.pt_id);
    if (!pt) return null;
    const confM: MembroSit[] = [], espM: MembroSit[] = [];
    for (const m of membrosPorPt.get(tp.pt_id) ?? []) {
      const sm = sitMembro(m.familia);
      if (sm.status === "can") confM.push(sm);
      else if (sm.status === "espera") espM.push(sm);
      else if (sm.status === null) naoDecididos.push(sm); // ⬜ (cant vai pra lista global)
    }
    return { id: pt.id, nome: pt.nome, emoji: pt.emoji, cor: pt.cor, limite: tp.limite, confirmados: confM, espera: espM };
  }).filter((x): x is SitPt => x !== null);
  const semPt = respostas.filter((r) => r.resposta === "can" && !chavesAtrib.has(chaveNome(casarNome(r.familia || r.username, [], playersCands)))).map((r) => ({ familia: casarNome(r.familia || r.username, [], playersCands), userId: r.user_id, status: statusDe(r) }));
  const cant = respostas.filter((r) => r.resposta === "cant").map((r) => ({ familia: casarNome(r.familia || r.username, [], playersCands), userId: r.user_id, status: "cant" as const }));
  return { templateNome: tpl.nome, tamanhoMax: tpl.tamanho_max, totalConfirmados: confirmados.size, totalEspera: espera.size, pts, semPt, naoDecididos, cant };
}
