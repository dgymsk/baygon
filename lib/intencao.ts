import { sql } from "@/lib/db";
import { botFetch, botConfigurado } from "@/lib/discordApi";
import { rotuloTipo, type Tipo } from "@/lib/participacaoConfig";
import { getParticipacaoConfig } from "@/lib/participacao";
import { listPts } from "@/lib/participacaoPt";
import { getPreset, listMembrosInt } from "@/lib/intencaoPreset";
import { montarEmbedIntencao, type PtI, type MarcaI, type RespI } from "@/lib/intencaoEmbed";
import { perfilGear } from "@/lib/players";
import { getEmojiMapResolvido } from "@/lib/emojiConfig";
import { getGuildMeta } from "@/lib/guildConfig";

/**
 * Bot de INTENÇÃO — rodadas em que a pessoa marca EM QUAIS PTs pretende jogar (várias),
 * sem limite de vaga. Roda lado a lado com o bot de participação antigo, em tabelas próprias
 * (intencao_*); a única coisa reaproveitada é o catálogo de PTs e a config de canal/mensagem
 * da tela /participacao, ambos só de leitura.
 */
export type PostIntencao = { message_id: string; tipo: string; channel_id: string; titulo: string | null; preset_id: number | null; evento_id: number | null; evento_uuid: string | null; evento_status: string | null; criado: string };

/** Rodada mais recente de cada tipo. */
export async function postsIntencaoAtivos(): Promise<PostIntencao[]> {
  return (await sql`
    SELECT DISTINCT ON (p.tipo) p.message_id, p.tipo, p.channel_id, p.titulo,
           p.preset_id::int AS preset_id, p.evento_id::int AS evento_id,
           e.uuid AS evento_uuid, e.status AS evento_status, p.criado::text AS criado
    FROM intencao_post p LEFT JOIN evento e ON e.id = p.evento_id
    ORDER BY p.tipo, p.criado DESC`) as PostIntencao[];
}

export async function getPostIntencao(messageId: string): Promise<PostIntencao | null> {
  const rows = (await sql`
    SELECT p.message_id, p.tipo, p.channel_id, p.titulo, p.preset_id::int AS preset_id, p.evento_id::int AS evento_id,
           e.uuid AS evento_uuid, e.status AS evento_status, p.criado::text AS criado
    FROM intencao_post p LEFT JOIN evento e ON e.id = p.evento_id
    WHERE p.message_id = ${messageId}`) as PostIntencao[];
  return rows[0] ?? null;
}

export async function getMarcas(messageId: string): Promise<(MarcaI & { chave: string | null; familia: string | null })[]> {
  return (await sql`SELECT user_id, pt_id::int AS pt_id, chave, familia FROM intencao_marca WHERE message_id = ${messageId}`) as (MarcaI & { chave: string | null; familia: string | null })[];
}
export async function getRespostasInt(messageId: string): Promise<RespI[]> {
  return (await sql`SELECT user_id, familia, chave, resposta FROM intencao_resp WHERE message_id = ${messageId} ORDER BY atualizado`) as RespI[];
}

/** PTs do preset, na ordem dele, resolvidas contra o catálogo. */
async function ptsDoPreset(presetId: number): Promise<{ pts: PtI[]; nome: string; tipo: string } | null> {
  const [preset, cat] = await Promise.all([getPreset(presetId), listPts()]);
  if (!preset) return null;
  const byId = new Map(cat.map((p) => [p.id, p]));
  const pts: PtI[] = preset.pts
    .map((v) => byId.get(v.pt_id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ id: p.id, nome: p.nome, emoji: p.emoji || null }));
  return { pts, nome: preset.nome, tipo: preset.tipo };
}

/** Reconstrói o payload da mensagem a partir do estado atual. Null se o preset sumiu. */
export async function montarPayload(messageId: string, presetId: number): Promise<Record<string, unknown> | null> {
  const info = await ptsDoPreset(presetId);
  if (!info) return null;
  const cfg = (await getParticipacaoConfig())[info.tipo as Tipo];
  const [marcas, respostas, membros, perfil, emojis, meta] = await Promise.all([
    getMarcas(messageId), getRespostasInt(messageId), listMembrosInt(info.tipo),
    perfilGear(), getEmojiMapResolvido(), getGuildMeta(),
  ]);
  return montarEmbedIntencao({
    presetId, presetNome: info.nome, mensagem: cfg.mensagem, imagem: cfg.imagem,
    pts: info.pts, marcas, respostas, membros, perfil, emojis,
    tags: Object.fromEntries(meta.guildas.map((g) => [g.id, g.tag])),
  }) as unknown as Record<string, unknown>;
}

/** Posta uma rodada nova a partir do preset. Cria o EVENTO ligado (mesma CTE = sem evento órfão). */
export async function postarIntencao(presetId: number): Promise<{ ok: boolean; erro?: string; messageId?: string; eventoUuid?: string }> {
  if (!botConfigurado()) return { ok: false, erro: "bot não configurado" };
  const info = await ptsDoPreset(presetId);
  if (!info) return { ok: false, erro: "preset não encontrado" };
  if (!info.pts.length) return { ok: false, erro: "preset sem nenhuma PT — nada pra marcar" };
  const cfg = (await getParticipacaoConfig())[info.tipo as Tipo];
  if (!cfg.channelId) return { ok: false, erro: `canal do ${rotuloTipo(info.tipo as Tipo)} não configurado` };

  const [perfil, emojis, meta, membros] = await Promise.all([perfilGear(), getEmojiMapResolvido(), getGuildMeta(), listMembrosInt(info.tipo)]);
  const payload = montarEmbedIntencao({
    presetId, presetNome: info.nome, mensagem: cfg.mensagem, imagem: cfg.imagem,
    pts: info.pts, marcas: [], respostas: [], membros, perfil, emojis,
    tags: Object.fromEntries(meta.guildas.map((g) => [g.id, g.tag])),
  });
  const res = await botFetch(`/channels/${cfg.channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : undefined,
      allowed_mentions: cfg.pingRoleId ? { roles: [cfg.pingRoleId] } : { parse: [] },
      ...payload,
    }),
  });
  if (!res.ok) return { ok: false, erro: `Discord ${res.status} ${(await res.text().catch(() => "")).slice(0, 140)}` };
  const msg = (await res.json()) as { id: string };

  const rows = (await sql`
    WITH ev AS (
      INSERT INTO evento (tipo, titulo, template_id) VALUES (${info.tipo}, ${info.nome}, NULL) RETURNING id, uuid
    ), p AS (
      INSERT INTO intencao_post (message_id, tipo, channel_id, titulo, preset_id, evento_id, criado)
      SELECT ${msg.id}, ${info.tipo}, ${cfg.channelId}, ${info.nome}, ${presetId}, ev.id, now() FROM ev
      ON CONFLICT (message_id) DO NOTHING
    )
    SELECT uuid FROM ev`) as { uuid: string }[];
  return { ok: true, messageId: msg.id, eventoUuid: rows[0]?.uuid };
}

type Quem = { messageId: string; userId: string; username: string; familia: string; chave: string; presetId: number };

/** Evento travado/finalizado não aceita mais marcação (mesmo gate do bot antigo). */
async function eventoAberto(messageId: string): Promise<boolean> {
  const rows = (await sql`SELECT e.status FROM intencao_post p LEFT JOIN evento e ON e.id = p.evento_id WHERE p.message_id = ${messageId}`) as { status: string | null }[];
  const st = rows[0]?.status ?? null;
  return !st || st === "aberto";
}

/**
 * Alterna a marca da pessoa numa PT. Marcar qualquer PT ⇒ resposta 'vai'. Desmarcar a última
 * PT APAGA a resposta — volta a "não respondeu", que é o estado que a estatística de falta
 * precisa distinguir de "recusou".
 */
export async function alternarMarca(o: Quem & { ptId: number }): Promise<Record<string, unknown> | null> {
  if (!(await eventoAberto(o.messageId))) return null;
  const ja = (await sql`SELECT 1 FROM intencao_marca WHERE message_id = ${o.messageId} AND user_id = ${o.userId} AND pt_id = ${o.ptId}`) as unknown[];
  if (ja.length) await sql`DELETE FROM intencao_marca WHERE message_id = ${o.messageId} AND user_id = ${o.userId} AND pt_id = ${o.ptId}`;
  else await sql`INSERT INTO intencao_marca (message_id, user_id, pt_id, chave, familia) VALUES (${o.messageId}, ${o.userId}, ${o.ptId}, ${o.chave}, ${o.familia})
    ON CONFLICT (message_id, user_id, pt_id) DO NOTHING`;

  const restantes = (await sql`SELECT count(*)::int AS n FROM intencao_marca WHERE message_id = ${o.messageId} AND user_id = ${o.userId}`) as { n: number }[];
  if (restantes[0]?.n) {
    await sql`INSERT INTO intencao_resp (message_id, user_id, username, familia, chave, resposta, atualizado)
      VALUES (${o.messageId}, ${o.userId}, ${o.username}, ${o.familia}, ${o.chave}, 'vai', now())
      ON CONFLICT (message_id, user_id) DO UPDATE SET username = EXCLUDED.username, familia = EXCLUDED.familia,
        chave = EXCLUDED.chave, resposta = 'vai', atualizado = now()`;
  } else {
    await sql`DELETE FROM intencao_resp WHERE message_id = ${o.messageId} AND user_id = ${o.userId}`;
  }
  return montarPayload(o.messageId, o.presetId);
}

/** "❌ Não vou": registra a recusa e limpa as marcas. Clicar de novo desfaz (volta a sem resposta). */
export async function marcarNaoVou(o: Quem): Promise<Record<string, unknown> | null> {
  if (!(await eventoAberto(o.messageId))) return null;
  const ja = (await sql`SELECT resposta FROM intencao_resp WHERE message_id = ${o.messageId} AND user_id = ${o.userId}`) as { resposta: string }[];
  if (ja[0]?.resposta === "nao") {
    await sql`DELETE FROM intencao_resp WHERE message_id = ${o.messageId} AND user_id = ${o.userId}`;
  } else {
    await sql.transaction([
      sql`DELETE FROM intencao_marca WHERE message_id = ${o.messageId} AND user_id = ${o.userId}`,
      sql`INSERT INTO intencao_resp (message_id, user_id, username, familia, chave, resposta, atualizado)
          VALUES (${o.messageId}, ${o.userId}, ${o.username}, ${o.familia}, ${o.chave}, 'nao', now())
          ON CONFLICT (message_id, user_id) DO UPDATE SET username = EXCLUDED.username, familia = EXCLUDED.familia,
            chave = EXCLUDED.chave, resposta = 'nao', atualizado = now()`,
    ]);
  }
  return montarPayload(o.messageId, o.presetId);
}
