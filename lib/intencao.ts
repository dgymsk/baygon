import { sql } from "@/lib/db";
import { botFetch, botConfigurado } from "@/lib/discordApi";
import { rotuloTipo, type Tipo } from "@/lib/participacaoConfig";
import { getParticipacaoConfig } from "@/lib/participacao";
import { listFuncoes } from "@/lib/funcao";
import { getPreset, listMembrosInt } from "@/lib/intencaoPreset";
import { montarEmbedIntencao, type FuncaoI, type MarcaI, type RespI } from "@/lib/intencaoEmbed";
import { perfilGear } from "@/lib/players";
import { getEmojiMapResolvido } from "@/lib/emojiConfig";
import { getGuildMeta } from "@/lib/guildConfig";

/**
 * Bot de INTENÇÃO — rodadas em que a pessoa marca EM QUAIS FUNÇÕES pretende jogar (várias),
 * sem limite de vaga. As funções vêm de lib/funcao.ts; onde a pessoa fica de fato in-game é
 * a PARTY, decidida depois na escalação.
 *
 * Roda lado a lado com o bot de participação antigo, em tabelas próprias (intencao_*). Da stack
 * antiga só reaproveita a config de canal/mensagem da tela /participacao, de leitura.
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
  return (await sql`SELECT user_id, funcao_id::int AS funcao_id, chave, familia FROM intencao_marca WHERE message_id = ${messageId}`) as (MarcaI & { chave: string | null; familia: string | null })[];
}
export async function getRespostasInt(messageId: string): Promise<RespI[]> {
  return (await sql`SELECT user_id, familia, chave, resposta FROM intencao_resp WHERE message_id = ${messageId} ORDER BY atualizado`) as RespI[];
}

/** Funções do preset, na ordem dele, resolvidas contra o catálogo de funções. */
async function funcoesDoPreset(presetId: number): Promise<{ funcoes: FuncaoI[]; nome: string; tipo: string } | null> {
  const [preset, cat] = await Promise.all([getPreset(presetId), listFuncoes()]);
  if (!preset) return null;
  const byId = new Map(cat.map((p) => [p.id, p]));
  const funcoes: FuncaoI[] = preset.funcoes
    .map((v) => byId.get(v.funcao_id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ id: p.id, nome: p.nome, emoji: p.emoji || null }));
  return { funcoes, nome: preset.nome, tipo: preset.tipo };
}

/** Reconstrói o payload da mensagem a partir do estado atual. Null se o preset sumiu. */
export async function montarPayload(messageId: string, presetId: number): Promise<Record<string, unknown> | null> {
  const info = await funcoesDoPreset(presetId);
  if (!info) return null;
  const cfg = (await getParticipacaoConfig())[info.tipo as Tipo];
  const [marcas, respostas, membros, perfil, emojis, meta] = await Promise.all([
    getMarcas(messageId), getRespostasInt(messageId), listMembrosInt(info.tipo),
    perfilGear(), getEmojiMapResolvido(), getGuildMeta(),
  ]);
  return montarEmbedIntencao({
    presetId, presetNome: info.nome, mensagem: cfg.mensagem, imagem: cfg.imagem,
    funcoes: info.funcoes, marcas, respostas, membros, perfil, emojis,
    tags: Object.fromEntries(meta.guildas.map((g) => [g.id, g.tag])),
  }) as unknown as Record<string, unknown>;
}

/** Posta uma rodada nova a partir do preset. Cria o EVENTO ligado (mesma CTE = sem evento órfão). */
export async function postarIntencao(presetId: number): Promise<{ ok: boolean; erro?: string; messageId?: string; eventoUuid?: string }> {
  if (!botConfigurado()) return { ok: false, erro: "bot não configurado" };
  const info = await funcoesDoPreset(presetId);
  if (!info) return { ok: false, erro: "preset não encontrado" };
  if (!info.funcoes.length) return { ok: false, erro: "preset sem nenhuma função — nada pra marcar" };
  const cfg = (await getParticipacaoConfig())[info.tipo as Tipo];
  if (!cfg.channelId) return { ok: false, erro: `canal do ${rotuloTipo(info.tipo as Tipo)} não configurado` };

  const [perfil, emojis, meta, membros] = await Promise.all([perfilGear(), getEmojiMapResolvido(), getGuildMeta(), listMembrosInt(info.tipo)]);
  const payload = montarEmbedIntencao({
    presetId, presetNome: info.nome, mensagem: cfg.mensagem, imagem: cfg.imagem,
    funcoes: info.funcoes, marcas: [], respostas: [], membros, perfil, emojis,
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
 * Alterna a marca da pessoa numa FUNÇÃO. Marcar qualquer função ⇒ resposta 'vai'. Desmarcar a
 * última APAGA a resposta — volta a "não respondeu", que é o estado que a estatística de falta
 * precisa distinguir de "recusou".
 */
export async function alternarMarca(o: Quem & { funcaoId: number }): Promise<Record<string, unknown> | null> {
  if (!(await eventoAberto(o.messageId))) return null;
  const ja = (await sql`SELECT 1 FROM intencao_marca WHERE message_id = ${o.messageId} AND user_id = ${o.userId} AND funcao_id = ${o.funcaoId}`) as unknown[];
  if (ja.length) await sql`DELETE FROM intencao_marca WHERE message_id = ${o.messageId} AND user_id = ${o.userId} AND funcao_id = ${o.funcaoId}`;
  else await sql`INSERT INTO intencao_marca (message_id, user_id, funcao_id, chave, familia) VALUES (${o.messageId}, ${o.userId}, ${o.funcaoId}, ${o.chave}, ${o.familia})
    ON CONFLICT (message_id, user_id, funcao_id) DO NOTHING`;

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
