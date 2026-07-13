import { sql } from "@/lib/db";
import { listEventos, situacaoAoVivoPorEvento } from "@/lib/eventos";
import type { Confirmados, GrupoConf, PlayerConf } from "@/lib/confirmados";
import type { SituacaoNN, MembroSit } from "@/lib/participacaoSituacao";

/**
 * MESMA visão do /confirmados (Apollo), mas a fonte é o NOSSO bot de participação:
 * pega o roster ao vivo de um evento ativo (respostas Can/Cant + PTs atribuídos) e ADAPTA
 * pro formato Confirmados — assim os boards do /confirmados (Montar PTs, Substituições,
 * Vagas, Conferência in-game) são reaproveitados sem mudança.
 */

const rotulo = (t: string) => (t === "siege" ? "Siege" : t === "nodewar" ? "Nodewar" : t);

/** Mesma codificação do /confirmados (Apollo): custom emoji → "c<id>", unicode → "u<char>", senão null.
 *  O componente Icone dos boards usa o 1º char como marcador de tipo (c/u) — NÃO pode ser chave arbitrária. */
function iconeChave(emoji: string): string | null {
  const s = (emoji || "").trim();
  const cm = s.match(/^<a?:\w+:(\d+)>/);
  if (cm) return `c${cm[1]}`;
  const um = s.match(/^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)/u);
  if (um) return `u${um[1].replace(/[️​‍]/g, "")}`;
  return null;
}

export type EventoLite = { uuid: string; titulo: string; tipo: string; data: string; status: string };
export type ConfirmadosBot = Confirmados & { eventos: EventoLite[]; eventoUuid: string | null };

/** Adapta a SituacaoNN do bot → Confirmados. iconKey = emoji real da PT (casa espera↔grupo e mostra o ícone). */
function sitParaConfirmados(sit: SituacaoNN, tagPorGuilda: Record<string, string>, warKey: string, title: string, inicioUnix?: number): Confirmados {
  const tagDe = (g?: string | null) => (g && tagPorGuilda[g]) || null;
  const player = (m: MembroSit, iconKey: string | null): PlayerConf => ({ tag: tagDe(m.guilda), nome: m.familia, nota: null, iconKey });
  const grupos: GrupoConf[] = sit.pts.map((pt) => {
    const ick = iconeChave(pt.emoji);
    return {
      nome: pt.nome,
      capacidade: pt.limite != null ? `${pt.confirmados.length}/${pt.limite}` : null,
      limite: pt.limite,
      iconKey: ick,
      players: pt.confirmados.map((m) => player(m, ick)),
    };
  });
  // Can sem PT atribuída → grupo sintético "Sem PT" (são confirmados: entram na contagem/montagem). Sem ícone.
  const semPtCan = sit.semPt.filter((m) => m.status === "can");
  if (semPtCan.length) grupos.push({ nome: "Sem PT", capacidade: null, limite: null, iconKey: null, players: semPtCan.map((m) => player(m, null)) });
  const listaEspera: PlayerConf[] = sit.pts.flatMap((pt) => { const ick = iconeChave(pt.emoji); return pt.espera.map((m) => player(m, ick)); });
  return { ok: true, title, inicioUnix, messageId: warKey, grupos, listaEspera };
}

/** Confirmados vindos do nosso bot, do evento ativo escolhido (ou o mais recente). */
export async function fetchConfirmadosDoBot(o: { eventoUuid?: string | null; tagPorGuilda: Record<string, string> }): Promise<ConfirmadosBot> {
  const ativos = await listEventos({ status: "ativos", limit: 50 });
  const eventos: EventoLite[] = ativos.map((e) => ({ uuid: e.uuid, titulo: e.titulo ?? rotulo(e.tipo), tipo: e.tipo, data: e.data, status: e.status }));
  if (!ativos.length) return { ok: false, erro: "nenhum evento ativo do bot", grupos: [], listaEspera: [], eventos, eventoUuid: null };
  const ev = (o.eventoUuid && ativos.find((e) => e.uuid === o.eventoUuid)) || ativos[0];

  const posts = (await sql`SELECT message_id FROM participacao_post WHERE evento_id = ${ev.id} ORDER BY criado DESC LIMIT 1`) as { message_id: string }[];
  const warKey = posts[0]?.message_id ?? null;
  const sit = warKey ? await situacaoAoVivoPorEvento(ev.id) : null;
  if (!sit || !warKey) return { ok: false, erro: "esse evento ainda não tem post/template do bot", grupos: [], listaEspera: [], eventos, eventoUuid: ev.uuid };

  const inicioUnix = ev.data ? Math.floor(new Date(ev.data).getTime() / 1000) : undefined;
  const base = sitParaConfirmados(sit, o.tagPorGuilda, warKey, ev.titulo ?? rotulo(ev.tipo), inicioUnix);
  return { ...base, eventos, eventoUuid: ev.uuid };
}
