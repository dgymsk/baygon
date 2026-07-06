import { getParticipacaoConfig, postsAtivos, getRespostas } from "@/lib/participacao";
import { listPts, listMembros, listTemplates, getTemplate } from "@/lib/participacaoPt";
import { classificar } from "@/lib/participacaoEmbed";
import { listarEmojisGuild, type EmojiGuild } from "@/lib/discordApi";
import { TIPOS, type Tipo } from "@/lib/participacaoConfig";
import { listPlayers } from "@/lib/players";
import { chaveNome } from "@/lib/nomes";
import { casarNome } from "@/lib/casarNome";
import { canEditNow } from "@/lib/requireAuth";
import ParticipacaoBoard from "./ParticipacaoBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Participação · BAYGON" };

export type { EmojiGuild };
export type PtVM = { id: number; nome: string; emoji: string };
export type MembroVM = { tipo: string; familia: string; pt_id: number };
export type TemplateVM = { id: number; nome: string; tipo: string; tamanho_max: number | null; pts: number[] };
export type StatusResp = "can" | "espera" | "cant" | null;
export type MembroSit = { familia: string; userId: string | null; status: StatusResp };
export type SitPt = { id: number; nome: string; emoji: string; confirmados: number; membros: MembroSit[] };
export type SituacaoVM = { templateNome: string; tamanhoMax: number | null; totalConfirmados: number; totalEspera: number; pts: SitPt[]; semPt: MembroSit[]; cant: MembroSit[] } | null;

export default async function ParticipacaoPage() {
  const [cfg, posts, players, pts, membros, templates, emojis, canEdit] = await Promise.all([
    getParticipacaoConfig(), postsAtivos(), listPlayers(), listPts(), listMembros(), listTemplates(), listarEmojisGuild(), canEditNow(),
  ]);
  const playersCands = players.map((p) => ({ chave: chaveNome(p.nome_familia), nome: p.nome_familia }));
  const playersAtivos = players.filter((p) => p.ativo).map((p) => p.nome_familia).sort((a, b) => a.localeCompare(b));
  const ptById = new Map(pts.map((p) => [p.id, p]));

  const situacao = {} as Record<Tipo, SituacaoVM>;
  for (const tipo of TIPOS) {
    const post = posts.find((p) => p.tipo === tipo);
    if (!post || !post.template_id) { situacao[tipo] = null; continue; }
    const tpl = templates.find((t) => t.id === post.template_id) ?? (await getTemplate(post.template_id));
    if (!tpl) { situacao[tipo] = null; continue; }
    const respostas = await getRespostas(post.message_id);
    const { confirmados, espera } = classificar(respostas, tpl.tamanho_max);
    const statusDe = (r: { user_id: string; resposta: "can" | "cant" }): StatusResp => (r.resposta === "cant" ? "cant" : confirmados.has(r.user_id) ? "can" : "espera");
    const respByChave = new Map(respostas.map((r) => [chaveNome(casarNome(r.familia || r.username, [], playersCands)), r]));
    const membrosTipo = membros.filter((m) => m.tipo === tipo);
    const membrosPorPt = new Map<number, typeof membrosTipo>();
    for (const m of membrosTipo) { const a = membrosPorPt.get(m.pt_id) ?? []; a.push(m); membrosPorPt.set(m.pt_id, a); }
    const chavesAtrib = new Set(membrosTipo.map((m) => chaveNome(m.familia)));
    const sitMembro = (familia: string): MembroSit => { const r = respByChave.get(chaveNome(familia)); return { familia, userId: r?.user_id ?? null, status: r ? statusDe(r) : null }; };
    const sitPts: SitPt[] = tpl.pts.map((pid) => {
      const pt = ptById.get(pid);
      if (!pt) return null;
      const mem = (membrosPorPt.get(pid) ?? []).map((m) => sitMembro(m.familia));
      return { id: pt.id, nome: pt.nome, emoji: pt.emoji, confirmados: mem.filter((m) => m.status === "can").length, membros: mem };
    }).filter((x): x is SitPt => x !== null);
    const semPt = respostas.filter((r) => r.resposta === "can" && !chavesAtrib.has(chaveNome(casarNome(r.familia || r.username, [], playersCands)))).map((r) => ({ familia: casarNome(r.familia || r.username, [], playersCands), userId: r.user_id, status: statusDe(r) }));
    const cant = respostas.filter((r) => r.resposta === "cant" && !chavesAtrib.has(chaveNome(casarNome(r.familia || r.username, [], playersCands)))).map((r) => ({ familia: casarNome(r.familia || r.username, [], playersCands), userId: r.user_id, status: "cant" as const }));
    situacao[tipo] = { templateNome: tpl.nome, tamanhoMax: tpl.tamanho_max, totalConfirmados: confirmados.size, totalEspera: espera.size, pts: sitPts, semPt, cant };
  }

  return <ParticipacaoBoard cfgInit={cfg} pts={pts as PtVM[]} membros={membros.map((m) => ({ tipo: m.tipo, familia: m.familia, pt_id: m.pt_id }))} templates={templates as TemplateVM[]} situacao={situacao} playersAtivos={playersAtivos} emojis={emojis} canEdit={canEdit} />;
}
