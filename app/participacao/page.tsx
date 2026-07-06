import { getParticipacaoConfig } from "@/lib/participacao";
import { listPts, listMembros, listTemplates } from "@/lib/participacaoPt";
import { listEventos, situacaoAoVivoPorEvento, type CatalogosRoster } from "@/lib/eventos";
import { listarEmojisGuild, listarRolesGuild, type EmojiGuild } from "@/lib/discordApi";
import { listImagens } from "@/lib/blob";
import { TIPOS, type Tipo } from "@/lib/participacaoConfig";
import { listPlayers } from "@/lib/players";
import { chaveNome } from "@/lib/nomes";
import { canEditNow } from "@/lib/requireAuth";
import { getDiscordConfig } from "@/lib/discordConfig";
import type { SituacaoVM } from "@/lib/participacaoSituacao";
import ParticipacaoBoard from "./ParticipacaoBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Participação · BAYGON" };

export type { EmojiGuild };
export type { StatusResp, MembroSit, SitPt, SituacaoVM } from "@/lib/participacaoSituacao"; // roster mora no lib (reuso no snapshot)
export type PtVM = { id: number; nome: string; emoji: string; cor: string };
export type MembroVM = { tipo: string; familia: string; pt_id: number };
export type TemplatePtVM = { pt_id: number; limite: number | null };
export type TemplateVM = { id: number; nome: string; tipo: string; tamanho_max: number | null; pts: TemplatePtVM[] };
// evento ATIVO (aberto/travado) de um tipo + o roster ao vivo — pro acompanhamento na aba Disparo/Situação
export type EventoAtivoVM = { id: number; uuid: string; tipo: string; status: string; titulo: string | null; data: string; sit: SituacaoVM };

export default async function ParticipacaoPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const { aba: abaInicial } = await searchParams;
  const [cfg, players, pts, membros, templates, emojis, roles, imagens, dcfg, ativos, canEdit] = await Promise.all([
    getParticipacaoConfig(), listPlayers(), listPts(), listMembros(), listTemplates(), listarEmojisGuild(), listarRolesGuild(), listImagens(), getDiscordConfig(), listEventos({ status: "ativos", limit: 100 }), canEditNow(),
  ]);
  const playersAtivos = players.filter((p) => p.ativo).map((p) => p.nome_familia).sort((a, b) => a.localeCompare(b));

  // roster AO VIVO de cada evento ativo. Reaproveita os catálogos já buscados (pts/membros/players) →
  // evita re-fetch por evento. (listEventos vem por data/criado DESC → 1º de cada tipo é o mais recente.)
  const cat: CatalogosRoster = { ptById: new Map(pts.map((p) => [p.id, p])), membros, playersCands: players.map((p) => ({ chave: chaveNome(p.nome_familia), nome: p.nome_familia })), perfil: new Map(players.map((p) => [chaveNome(p.nome_familia), { guilda: p.guilda, classe: p.classe_bdo, gs: p.garmoth?.gs ?? null }])) };
  const ativosComSit: EventoAtivoVM[] = await Promise.all(ativos.map(async (e) => ({ id: e.id, uuid: e.uuid, tipo: e.tipo, status: e.status, titulo: e.titulo, data: e.data, sit: await situacaoAoVivoPorEvento(e.id, cat) })));
  const eventosPorTipo = {} as Record<Tipo, EventoAtivoVM[]>;
  for (const tipo of TIPOS) eventosPorTipo[tipo] = ativosComSit.filter((e) => e.tipo === tipo);

  return <ParticipacaoBoard cfgInit={cfg} pts={pts as PtVM[]} membros={membros.map((m) => ({ tipo: m.tipo, familia: m.familia, pt_id: m.pt_id }))} templates={templates as TemplateVM[]} eventosPorTipo={eventosPorTipo} playersAtivos={playersAtivos} emojis={emojis} roles={roles} imagens={imagens} reportChannel={dcfg.reportChannel} abaInicial={abaInicial} canEdit={canEdit} />;
}
