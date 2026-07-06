import { sql } from "@/lib/db";
import { botFetch, botConfigurado } from "@/lib/discordApi";
import { parseParticipacaoConfig, rotuloTipo, type ParticipacaoConfig, type Tipo } from "@/lib/participacaoConfig";
import { listPts, listMembros, getTemplate } from "@/lib/participacaoPt";
import { montarEmbed } from "@/lib/participacaoEmbed";
import { statusPorWarKey } from "@/lib/eventos";

/**
 * Bot de participação: config (singleton) + rodadas. Cada rodada nasce de um TEMPLATE
 * (PTs + tamanho_max). war_key = id da mensagem postada. Espera calculada por can_em.
 */
export type Resposta = { user_id: string; username: string; familia: string | null; chave: string | null; tipo: string; resposta: "can" | "cant"; can_em: string | null; atualizado: string };
export type PostAtivo = { tipo: string; message_id: string; channel_id: string; titulo: string | null; template_id: number | null; criado: string; evento_uuid: string | null; evento_status: string | null };

export async function getParticipacaoConfig(): Promise<ParticipacaoConfig> {
  const rows = (await sql`SELECT config FROM participacao_config WHERE id = 1`) as { config: string | null }[];
  return parseParticipacaoConfig(rows[0]?.config ?? null);
}
export async function setParticipacaoConfig(raw: unknown): Promise<ParticipacaoConfig> {
  const cfg = parseParticipacaoConfig(raw);
  await sql`INSERT INTO participacao_config (id, config) VALUES (1, ${JSON.stringify(cfg)})
    ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config`;
  return cfg;
}

/** Post mais recente de cada tipo (a rodada ativa) + o evento ligado (uuid/status). */
export async function postsAtivos(): Promise<PostAtivo[]> {
  return (await sql`
    SELECT DISTINCT ON (p.tipo) p.tipo, p.message_id, p.channel_id, p.titulo, p.template_id, p.criado::text AS criado,
           e.uuid AS evento_uuid, e.status AS evento_status
    FROM participacao_post p LEFT JOIN evento e ON e.id = p.evento_id
    ORDER BY p.tipo, p.criado DESC
  `) as PostAtivo[];
}

export async function getRespostas(warKey: string): Promise<Resposta[]> {
  return (await sql`
    SELECT user_id, username, familia, chave, tipo, resposta, can_em::text AS can_em, atualizado::text AS atualizado
    FROM participacao_resp WHERE war_key = ${warKey} ORDER BY atualizado
  `) as Resposta[];
}

export async function upsertResposta(r: { warKey: string; userId: string; username: string; familia: string | null; chave: string | null; tipo: string; resposta: "can" | "cant" }): Promise<void> {
  await sql`
    INSERT INTO participacao_resp (war_key, user_id, username, familia, chave, tipo, resposta, can_em, atualizado)
    VALUES (${r.warKey}, ${r.userId}, ${r.username}, ${r.familia}, ${r.chave}, ${r.tipo}, ${r.resposta},
            CASE WHEN ${r.resposta} = 'can' THEN now() ELSE NULL END, now())
    ON CONFLICT (war_key, user_id) DO UPDATE SET
      username = EXCLUDED.username, familia = EXCLUDED.familia, chave = EXCLUDED.chave, resposta = EXCLUDED.resposta,
      can_em = CASE WHEN EXCLUDED.resposta = 'can' AND participacao_resp.resposta = 'can' THEN participacao_resp.can_em
                    WHEN EXCLUDED.resposta = 'can' THEN now() ELSE NULL END,
      atualizado = now()`;
}

/** Posta a mensagem de uma rodada a partir de um TEMPLATE. Cria o EVENTO ligado ao post. */
export async function postarMensagem(templateId: number): Promise<{ ok: boolean; erro?: string; messageId?: string; eventoUuid?: string }> {
  if (!botConfigurado()) return { ok: false, erro: "bot não configurado" };
  const tpl = await getTemplate(templateId);
  if (!tpl) return { ok: false, erro: "template não encontrado" };
  const cfg = (await getParticipacaoConfig())[tpl.tipo as Tipo];
  if (!cfg.channelId) return { ok: false, erro: `canal do ${rotuloTipo(tpl.tipo as Tipo)} não configurado` };

  const [pts, membros] = await Promise.all([listPts(), listMembros(tpl.tipo)]);
  const payload = montarEmbed(cfg, templateId, tpl, pts, membros, []); // rodada nova
  const body = {
    content: cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : undefined,
    allowed_mentions: cfg.pingRoleId ? { roles: [cfg.pingRoleId] } : { parse: [] },
    ...payload,
  };
  const res = await botFetch(`/channels/${cfg.channelId}/messages`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { ok: false, erro: `Discord ${res.status} ${txt.slice(0, 140)}` };
  }
  const msg = (await res.json()) as { id: string };
  // evento + post na MESMA statement (CTE) → atômico no neon-http: se o INSERT do post falhar,
  // o evento também não entra (sem evento órfão). Só depois do Discord aceitar a msg.
  const rows = (await sql`
    WITH ev AS (
      INSERT INTO evento (tipo, titulo, template_id) VALUES (${tpl.tipo}, ${tpl.nome}, ${templateId}) RETURNING id, uuid
    ), p AS (
      INSERT INTO participacao_post (message_id, tipo, channel_id, titulo, template_id, evento_id, criado)
      SELECT ${msg.id}, ${tpl.tipo}, ${cfg.channelId}, ${tpl.nome}, ${templateId}, ev.id, now() FROM ev
      ON CONFLICT (message_id) DO NOTHING
    )
    SELECT uuid FROM ev`) as { uuid: string }[];
  return { ok: true, messageId: msg.id, eventoUuid: rows[0]?.uuid };
}

/** Grava o clique (resolvendo o tipo pelo template) e devolve o payload atualizado da mensagem. */
export async function registrarClique(o: { warKey: string; userId: string; username: string; familia: string; chave: string; templateId: number; resposta: "can" | "cant" }): Promise<Record<string, unknown> | null> {
  // GATE do evento: travado/finalizado → não registra participação extra (aberto ou legado sem evento → segue).
  const st = await statusPorWarKey(o.warKey);
  if (st && st !== "aberto") return null;
  const tpl = await getTemplate(o.templateId);
  if (!tpl) {
    // template foi deletado no meio da rodada: ainda grava o clique (tipo vem do post), sem perder.
    const rows = (await sql`SELECT tipo FROM participacao_post WHERE message_id = ${o.warKey}`) as { tipo: string }[];
    if (rows[0]) await upsertResposta({ warKey: o.warKey, userId: o.userId, username: o.username, familia: o.familia, chave: o.chave, tipo: rows[0].tipo, resposta: o.resposta });
    return null; // sem template não dá pra reconstruir o embed
  }
  await upsertResposta({ warKey: o.warKey, userId: o.userId, username: o.username, familia: o.familia, chave: o.chave, tipo: tpl.tipo, resposta: o.resposta });
  const cfg = (await getParticipacaoConfig())[tpl.tipo as Tipo];
  const [pts, membros, respostas] = await Promise.all([listPts(), listMembros(tpl.tipo), getRespostas(o.warKey)]);
  return montarEmbed(cfg, o.templateId, tpl, pts, membros, respostas) as unknown as Record<string, unknown>;
}
