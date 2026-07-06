import { sql } from "@/lib/db";
import { botFetch, botConfigurado } from "@/lib/discordApi";
import { parseParticipacaoConfig, rotuloTipo, type ParticipacaoConfig, type Tipo } from "@/lib/participacaoConfig";
import { listPts, listMembros, getTemplate } from "@/lib/participacaoPt";
import { montarEmbed } from "@/lib/participacaoEmbed";

/**
 * Bot de participação: config (singleton) + rodadas. Cada rodada nasce de um TEMPLATE
 * (PTs + tamanho_max). war_key = id da mensagem postada. Espera calculada por can_em.
 */
export type Resposta = { user_id: string; username: string; familia: string | null; chave: string | null; tipo: string; resposta: "can" | "cant"; can_em: string | null; atualizado: string };
export type PostAtivo = { tipo: string; message_id: string; channel_id: string; titulo: string | null; template_id: number | null; criado: string };

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

/** Post mais recente de cada tipo (a rodada ativa). */
export async function postsAtivos(): Promise<PostAtivo[]> {
  return (await sql`
    SELECT DISTINCT ON (tipo) tipo, message_id, channel_id, titulo, template_id, criado::text AS criado
    FROM participacao_post ORDER BY tipo, criado DESC
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

/** Posta a mensagem de uma rodada a partir de um TEMPLATE. */
export async function postarMensagem(templateId: number): Promise<{ ok: boolean; erro?: string; messageId?: string }> {
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
  await sql`INSERT INTO participacao_post (message_id, tipo, channel_id, titulo, template_id, criado)
    VALUES (${msg.id}, ${tpl.tipo}, ${cfg.channelId}, ${tpl.nome}, ${templateId}, now()) ON CONFLICT (message_id) DO NOTHING`;
  return { ok: true, messageId: msg.id };
}

/** Grava o clique (resolvendo o tipo pelo template) e devolve o payload atualizado da mensagem. */
export async function registrarClique(o: { warKey: string; userId: string; username: string; familia: string; chave: string; templateId: number; resposta: "can" | "cant" }): Promise<Record<string, unknown> | null> {
  const tpl = await getTemplate(o.templateId);
  if (!tpl) return null;
  await upsertResposta({ warKey: o.warKey, userId: o.userId, username: o.username, familia: o.familia, chave: o.chave, tipo: tpl.tipo, resposta: o.resposta });
  const cfg = (await getParticipacaoConfig())[tpl.tipo as Tipo];
  const [pts, membros, respostas] = await Promise.all([listPts(), listMembros(tpl.tipo), getRespostas(o.warKey)]);
  return montarEmbed(cfg, o.templateId, tpl, pts, membros, respostas) as unknown as Record<string, unknown>;
}
