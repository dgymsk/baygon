import { sql } from "@/lib/db";
import { botFetch, botConfigurado } from "@/lib/discordApi";
import { parseParticipacaoConfig, rotuloTipo, type ParticipacaoConfig, type Tipo } from "@/lib/participacaoConfig";

/**
 * Dados do bot de participação próprio (área isolada). Espelha o padrão pt_meta/ptStatus:
 * singleton de config + upsert por rodada. war_key = id da mensagem postada com os botões.
 */
export type Resposta = { user_id: string; username: string; familia: string | null; chave: string | null; tipo: string; resposta: "can" | "cant"; atualizado: string };
export type PostAtivo = { tipo: string; message_id: string; channel_id: string; titulo: string | null; criado: string };

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

/** Post mais recente de cada tipo (nodewar/siege) — a "rodada" ativa. */
export async function postsAtivos(): Promise<PostAtivo[]> {
  return (await sql`
    SELECT DISTINCT ON (tipo) tipo, message_id, channel_id, titulo, criado::text AS criado
    FROM participacao_post ORDER BY tipo, criado DESC
  `) as PostAtivo[];
}

export async function getRespostas(warKey: string): Promise<Resposta[]> {
  return (await sql`
    SELECT user_id, username, familia, chave, tipo, resposta, atualizado::text AS atualizado
    FROM participacao_resp WHERE war_key = ${warKey} ORDER BY atualizado
  `) as Resposta[];
}

export async function upsertResposta(r: { warKey: string; userId: string; username: string; familia: string | null; chave: string | null; tipo: string; resposta: "can" | "cant" }): Promise<void> {
  await sql`
    INSERT INTO participacao_resp (war_key, user_id, username, familia, chave, tipo, resposta, atualizado)
    VALUES (${r.warKey}, ${r.userId}, ${r.username}, ${r.familia}, ${r.chave}, ${r.tipo}, ${r.resposta}, now())
    ON CONFLICT (war_key, user_id) DO UPDATE SET username = EXCLUDED.username, familia = EXCLUDED.familia,
      chave = EXCLUDED.chave, resposta = EXCLUDED.resposta, atualizado = now()`;
}

/** Monta e posta a mensagem com botões Can/Cant no canal configurado do tipo. */
export async function postarMensagem(tipo: Tipo): Promise<{ ok: boolean; erro?: string; messageId?: string }> {
  if (!botConfigurado()) return { ok: false, erro: "bot não configurado" };
  const cfg = (await getParticipacaoConfig())[tipo];
  if (!cfg.channelId) return { ok: false, erro: `canal do ${rotuloTipo(tipo)} não configurado` };

  const body = {
    content: cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : undefined,
    allowed_mentions: cfg.pingRoleId ? { roles: [cfg.pingRoleId] } : { parse: [] },
    embeds: [{ title: cfg.titulo, description: cfg.mensagem || undefined, color: 0x34e06a }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 3, label: "Can", custom_id: `part:can:${tipo}` },   // verde
        { type: 2, style: 4, label: "Cant", custom_id: `part:cant:${tipo}` }, // vermelho
      ],
    }],
  };
  const res = await botFetch(`/channels/${cfg.channelId}/messages`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { ok: false, erro: `Discord ${res.status} ${txt.slice(0, 140)}` };
  }
  const msg = (await res.json()) as { id: string };
  await sql`INSERT INTO participacao_post (message_id, tipo, channel_id, titulo, criado)
    VALUES (${msg.id}, ${tipo}, ${cfg.channelId}, ${cfg.titulo}, now()) ON CONFLICT (message_id) DO NOTHING`;
  return { ok: true, messageId: msg.id };
}
