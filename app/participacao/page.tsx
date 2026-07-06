import { getParticipacaoConfig, postsAtivos, getRespostas } from "@/lib/participacao";
import { listPts, listMembros, listTemplates, getTemplate } from "@/lib/participacaoPt";
import { montarSituacao } from "@/lib/participacaoSituacao";
import { listarEmojisGuild, listarRolesGuild, type EmojiGuild } from "@/lib/discordApi";
import { listImagens } from "@/lib/blob";
import { TIPOS, type Tipo } from "@/lib/participacaoConfig";
import { listPlayers } from "@/lib/players";
import { chaveNome } from "@/lib/nomes";
import { canEditNow } from "@/lib/requireAuth";
import { getDiscordConfig } from "@/lib/discordConfig";
import ParticipacaoBoard from "./ParticipacaoBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Participação · BAYGON" };

export type { EmojiGuild };
export type { StatusResp, MembroSit, SitPt, SituacaoVM } from "@/lib/participacaoSituacao"; // roster mora no lib (reuso no snapshot)
export type PtVM = { id: number; nome: string; emoji: string; cor: string };
export type MembroVM = { tipo: string; familia: string; pt_id: number };
export type TemplatePtVM = { pt_id: number; limite: number | null };
export type TemplateVM = { id: number; nome: string; tipo: string; tamanho_max: number | null; pts: TemplatePtVM[] };
export type EventoRef = { uuid: string | null; status: string | null } | null;

export default async function ParticipacaoPage() {
  const [cfg, posts, players, pts, membros, templates, emojis, roles, imagens, dcfg, canEdit] = await Promise.all([
    getParticipacaoConfig(), postsAtivos(), listPlayers(), listPts(), listMembros(), listTemplates(), listarEmojisGuild(), listarRolesGuild(), listImagens(), getDiscordConfig(), canEditNow(),
  ]);
  const playersCands = players.map((p) => ({ chave: chaveNome(p.nome_familia), nome: p.nome_familia }));
  const playersAtivos = players.filter((p) => p.ativo).map((p) => p.nome_familia).sort((a, b) => a.localeCompare(b));
  const ptById = new Map(pts.map((p) => [p.id, p]));

  const situacao = {} as Record<Tipo, import("@/lib/participacaoSituacao").SituacaoVM>;
  const eventos = {} as Record<Tipo, EventoRef>;
  for (const tipo of TIPOS) {
    const post = posts.find((p) => p.tipo === tipo);
    eventos[tipo] = post ? { uuid: post.evento_uuid, status: post.evento_status } : null;
    // evento finalizado → esconde a situação ao-vivo (o histórico é a fonte de verdade)
    if (!post || !post.template_id || post.evento_status === "finalizado") { situacao[tipo] = null; continue; }
    const tpl = templates.find((t) => t.id === post.template_id) ?? (await getTemplate(post.template_id));
    if (!tpl) { situacao[tipo] = null; continue; }
    const respostas = await getRespostas(post.message_id);
    const membrosTipo = membros.filter((m) => m.tipo === tipo);
    situacao[tipo] = montarSituacao(tpl, membrosTipo, respostas, ptById, playersCands);
  }

  return <ParticipacaoBoard cfgInit={cfg} pts={pts as PtVM[]} membros={membros.map((m) => ({ tipo: m.tipo, familia: m.familia, pt_id: m.pt_id }))} templates={templates as TemplateVM[]} situacao={situacao} eventos={eventos} playersAtivos={playersAtivos} emojis={emojis} roles={roles} imagens={imagens} reportChannel={dcfg.reportChannel} canEdit={canEdit} />;
}
