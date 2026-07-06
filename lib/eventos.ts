import { sql } from "@/lib/db";
import { getTemplate, listPts, listMembros } from "@/lib/participacaoPt";
import { listPlayers } from "@/lib/players";
import { chaveNome } from "@/lib/nomes";
import { montarSituacao, type SituacaoNN } from "@/lib/participacaoSituacao";

/**
 * HUB de EVENTOS. Cada disparo cria 1 evento; a rodada de participação (participacao_post) é a 1ª
 * FACETA (post.evento_id → evento.id). Confirmados e resultado penduram DEPOIS como satélites que
 * apontam evento_id — o hub NÃO conhece as facetas (regra hub-and-spoke). Ciclo: aberto → travado →
 * finalizado (transições monotônicas). Finalizar congela o roster no snapshot (o "bot final").
 * Self-contained (query participacao_resp inline) p/ NÃO criar ciclo com lib/participacao.ts.
 */
export type EventoStatus = "aberto" | "travado" | "finalizado";
export type Evento = { id: number; uuid: string; data: string; tipo: string; titulo: string | null; status: EventoStatus; templateId: number | null; criado: string; travadoEm: string | null; finalizadoEm: string | null };
export type EventoSnapshot = SituacaoNN & { versao: 1; capturadoEm: string; warKey: string };
export type EventoDetalhe = Evento & { snapshot: EventoSnapshot | null; messageId: string | null; channelId: string | null };

type Row = { id: number; uuid: string; data: string; tipo: string; titulo: string | null; status: EventoStatus; template_id: number | null; criado: string; travado_em: string | null; finalizado_em: string | null };
const map = (r: Row): Evento => ({ id: r.id, uuid: r.uuid, data: r.data, tipo: r.tipo, titulo: r.titulo, status: r.status, templateId: r.template_id, criado: r.criado, travadoEm: r.travado_em, finalizadoEm: r.finalizado_em });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cria o evento (status 'aberto'). Chamado por postarMensagem DEPOIS do Discord aceitar a mensagem. */
export async function criarEvento(o: { tipo: string; titulo: string | null; templateId: number | null }): Promise<Evento> {
  const rows = (await sql`
    INSERT INTO evento (tipo, titulo, template_id) VALUES (${o.tipo}, ${o.titulo}, ${o.templateId})
    RETURNING id::int AS id, uuid, data::text AS data, tipo, titulo, status, template_id::int AS template_id, criado::text AS criado, travado_em::text AS travado_em, finalizado_em::text AS finalizado_em`) as Row[];
  return map(rows[0]);
}

/** Status do evento a partir do war_key (=message_id do post). GATE do registrarClique.
 *  null = post sem evento (legado) → o caller trata como 'aberto' (não trava cliques antigos). */
export async function statusPorWarKey(warKey: string): Promise<EventoStatus | null> {
  const rows = (await sql`SELECT e.status FROM participacao_post p JOIN evento e ON e.id = p.evento_id WHERE p.message_id = ${warKey}`) as { status: EventoStatus }[];
  return rows[0]?.status ?? null;
}

/** Trava (nenhuma participação extra registrada). Idempotente: já travado/finalizado → ok.
 *  Devolve o post ligado p/ o caller tirar os botões da mensagem (evita botão morto). */
export async function travarEvento(id: number): Promise<{ ok: boolean; erro?: string; messageId?: string | null; channelId?: string | null }> {
  const cur = (await sql`SELECT status FROM evento WHERE id = ${id}`) as { status: EventoStatus }[];
  if (!cur[0]) return { ok: false, erro: "evento não encontrado" };
  if (cur[0].status === "aberto") await sql`UPDATE evento SET status='travado', travado_em=now() WHERE id = ${id} AND status='aberto'`;
  const posts = (await sql`SELECT message_id, channel_id FROM participacao_post WHERE evento_id = ${id} ORDER BY criado DESC LIMIT 1`) as { message_id: string; channel_id: string }[];
  return { ok: true, messageId: posts[0]?.message_id ?? null, channelId: posts[0]?.channel_id ?? null };
}

/** Recalcula o roster (SituacaoNN) do post ligado ao evento, do estado ATUAL das respostas. */
async function computeSituacao(post: { message_id: string; tipo: string; template_id: number | null }): Promise<SituacaoNN | null> {
  if (!post.template_id) return null;
  const tpl = await getTemplate(post.template_id);
  if (!tpl) return null;
  const [pts, membros, players] = await Promise.all([listPts(), listMembros(post.tipo), listPlayers()]);
  const respostas = (await sql`
    SELECT user_id, username, familia, chave, tipo, resposta, can_em::text AS can_em, atualizado::text AS atualizado
    FROM participacao_resp WHERE war_key = ${post.message_id} ORDER BY atualizado`) as { user_id: string; username: string; familia: string | null; chave: string | null; tipo: string; resposta: "can" | "cant"; can_em: string | null; atualizado: string }[];
  const ptById = new Map(pts.map((p) => [p.id, p]));
  const playersCands = players.map((p) => ({ chave: chaveNome(p.nome_familia), nome: p.nome_familia }));
  return montarSituacao(tpl, membros, respostas, ptById, playersCands);
}

/** Snapshot do roster (o "bot final") — congela o computeSituacao + metadados. */
async function montarSnapshot(post: { message_id: string; tipo: string; template_id: number | null }): Promise<EventoSnapshot | null> {
  const sit = await computeSituacao(post);
  return sit ? { ...sit, versao: 1, capturadoEm: new Date().toISOString(), warKey: post.message_id } : null;
}

/** Situação AO VIVO de um evento (pro acompanhamento na aba Ativos). Recalcula do estado atual. */
export async function situacaoAoVivoPorEvento(eventoId: number): Promise<SituacaoNN | null> {
  const posts = (await sql`SELECT message_id, tipo, template_id::int AS template_id FROM participacao_post WHERE evento_id = ${eventoId} ORDER BY criado DESC LIMIT 1`) as { message_id: string; tipo: string; template_id: number | null }[];
  return posts[0] ? computeSituacao(posts[0]) : null;
}

/** Finaliza: congela o snapshot + status='finalizado'. IDEMPOTENTE (2ª chamada não reescreve o snapshot).
 *  Retorna o detalhe (com messageId/channelId) p/ o caller editar a mensagem do Discord. */
export async function finalizarEvento(id: number): Promise<EventoDetalhe | null> {
  const evs = (await sql`
    SELECT id::int AS id, uuid, data::text AS data, tipo, titulo, status, template_id::int AS template_id, snapshot, criado::text AS criado, travado_em::text AS travado_em, finalizado_em::text AS finalizado_em
    FROM evento WHERE id = ${id}`) as (Row & { snapshot: EventoSnapshot | null })[];
  const ev = evs[0];
  if (!ev) return null;
  const posts = (await sql`SELECT message_id, channel_id, tipo, template_id::int AS template_id FROM participacao_post WHERE evento_id = ${id} ORDER BY criado DESC LIMIT 1`) as { message_id: string; channel_id: string; tipo: string; template_id: number | null }[];
  const post = posts[0] ?? null;

  if (ev.status === "finalizado") { // idempotente: devolve o já congelado
    return { ...map(ev), snapshot: ev.snapshot, messageId: post?.message_id ?? null, channelId: post?.channel_id ?? null };
  }

  const snapshot = post ? await montarSnapshot(post) : null;
  const upd = (await sql`
    UPDATE evento SET status='finalizado', finalizado_em=now(), travado_em=COALESCE(travado_em, now()),
      snapshot = ${snapshot ? JSON.stringify(snapshot) : null}::jsonb
    WHERE id = ${id} AND status <> 'finalizado'
    RETURNING id::int AS id, uuid, data::text AS data, tipo, titulo, status, template_id::int AS template_id, criado::text AS criado, travado_em::text AS travado_em, finalizado_em::text AS finalizado_em`) as Row[];
  if (upd[0]) return { ...map(upd[0]), snapshot, messageId: post?.message_id ?? null, channelId: post?.channel_id ?? null };
  // corrida: outra chamada finalizou 1º → relê o estado PERSISTIDO (não devolve snapshot local não gravado)
  const done = (await sql`SELECT id::int AS id, uuid, data::text AS data, tipo, titulo, status, template_id::int AS template_id, snapshot, criado::text AS criado, travado_em::text AS travado_em, finalizado_em::text AS finalizado_em FROM evento WHERE id = ${id}`) as (Row & { snapshot: EventoSnapshot | null })[];
  const d = done[0] ?? ev;
  return { ...map(d), snapshot: d.snapshot, messageId: post?.message_id ?? null, channelId: post?.channel_id ?? null };
}

/** Lista com filtros opcionais. status: 'ativos' (aberto+travado) | 'historico' (finalizado). */
export async function listEventos(o: { status?: "ativos" | "historico"; tipo?: string; q?: string; de?: string; ate?: string; limit?: number } = {}): Promise<Evento[]> {
  const st = o.status ?? null;
  const tipo = o.tipo || null;
  const q = o.q && o.q.trim() ? `%${o.q.trim()}%` : null;
  const iso = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null); // valida ANTES do ::date (senão 500)
  const de = iso(o.de);
  const ate = iso(o.ate);
  const limit = Math.min(Math.max(o.limit ?? 100, 1), 500);
  const rows = (await sql`
    SELECT id::int AS id, uuid, data::text AS data, tipo, titulo, status, template_id::int AS template_id, criado::text AS criado, travado_em::text AS travado_em, finalizado_em::text AS finalizado_em
    FROM evento
    WHERE (${st}::text IS NULL
           OR (${st} = 'ativos' AND status IN ('aberto','travado'))
           OR (${st} = 'historico' AND status = 'finalizado'))
      AND (${tipo}::text IS NULL OR tipo = ${tipo})
      AND (${q}::text IS NULL OR titulo ILIKE ${q} OR uuid::text ILIKE ${q})
      AND (${de}::date IS NULL OR data >= ${de}::date)
      AND (${ate}::date IS NULL OR data <= ${ate}::date)
    ORDER BY data DESC, criado DESC
    LIMIT ${limit}`) as Row[];
  return rows.map(map);
}

export async function getEventoByUuid(uuid: string): Promise<EventoDetalhe | null> {
  if (!UUID_RE.test(uuid)) return null;
  const evs = (await sql`
    SELECT id::int AS id, uuid, data::text AS data, tipo, titulo, status, template_id::int AS template_id, snapshot, criado::text AS criado, travado_em::text AS travado_em, finalizado_em::text AS finalizado_em
    FROM evento WHERE uuid = ${uuid}::uuid`) as (Row & { snapshot: EventoSnapshot | null })[];
  const ev = evs[0];
  if (!ev) return null;
  const posts = (await sql`SELECT message_id, channel_id FROM participacao_post WHERE evento_id = ${ev.id} ORDER BY criado DESC LIMIT 1`) as { message_id: string; channel_id: string }[];
  return { ...map(ev), snapshot: ev.snapshot, messageId: posts[0]?.message_id ?? null, channelId: posts[0]?.channel_id ?? null };
}

export async function getEventoById(id: number): Promise<Evento | null> {
  const rows = (await sql`
    SELECT id::int AS id, uuid, data::text AS data, tipo, titulo, status, template_id::int AS template_id, criado::text AS criado, travado_em::text AS travado_em, finalizado_em::text AS finalizado_em
    FROM evento WHERE id = ${id}`) as Row[];
  return rows[0] ? map(rows[0]) : null;
}

/** Retenção ~30 dias. Chamar por GitHub Actions ou lazy — NUNCA cron sub-diário no Vercel Hobby.
 *  Apaga o evento (e o snapshot congelado). participacao_post.evento_id vira NULL (post/respostas
 *  permanecem, órfãos de evento). Satélites futuros DEVEM declarar ON DELETE CASCADE p/ sumirem junto. */
export async function purgeEventosAntigos(): Promise<number> {
  const rows = (await sql`DELETE FROM evento WHERE status='finalizado' AND finalizado_em < now() - interval '30 days' RETURNING id`) as { id: number }[];
  return rows.length;
}
