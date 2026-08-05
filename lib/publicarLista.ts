import { sql } from "@/lib/db";
import { botFetch, botConfigurado } from "@/lib/discordApi";
import { getIntencaoConfig } from "@/lib/intencaoConfig";
import { getParticipacaoConfig } from "@/lib/participacao";
import { montarLista, type EscaladoL, type PartyL } from "@/lib/listaEscalacao";
import { getPreset } from "@/lib/intencaoPreset";
import { listParties } from "@/lib/party";
import { perfilGear } from "@/lib/players";
import { getEmojiMapResolvido } from "@/lib/emojiConfig";
import { getGuildMeta } from "@/lib/guildConfig";
import { filaDaChamada } from "@/lib/threadChamada";
import { type Tipo } from "@/lib/participacaoConfig";

/**
 * Publica a escalação no canal da LISTA (separado do canal da chamada). É UMA mensagem por
 * evento, EDITADA — republicar a cada mudança encheria o canal e a versão velha continuaria
 * visível dando informação errada.
 */
export async function publicarLista(eventoId: number, o: { soSePublicada?: boolean } = {}): Promise<{ ok: boolean; erro?: string; editou?: boolean }> {
  if (!botConfigurado()) return { ok: false, erro: "bot não configurado" };

  const posts = (await sql`
    SELECT p.message_id, p.tipo, p.preset_id::int AS preset_id, p.lista_message_id, p.lista_channel_id,
           COALESCE(e.titulo, e.tipo) AS titulo, to_char(e.data, 'DD/MM') AS data
    FROM intencao_post p JOIN evento e ON e.id = p.evento_id
    WHERE p.evento_id = ${eventoId} ORDER BY p.criado DESC LIMIT 1`) as
    { message_id: string; tipo: string; preset_id: number | null; lista_message_id: string | null; lista_channel_id: string | null; titulo: string; data: string }[];
  const post = posts[0];
  if (!post) return { ok: false, erro: "evento sem chamada de intenção" };
  // atualização automática só EDITA o que já existe: marcar presença não pode fazer aparecer uma
  // lista no canal do nada — publicar é decisão da staff, no botão
  if (o.soSePublicada && !(post.lista_message_id && post.lista_channel_id)) return { ok: true, editou: false };

  const cfg = await getIntencaoConfig();
  // canal da lista vazio → cai no canal da chamada, senão o botão não faria nada em silêncio
  const canal = cfg[post.tipo as Tipo]?.canalLista
    || cfg[post.tipo as Tipo]?.canalChamada
    || (await getParticipacaoConfig())[post.tipo as Tipo]?.channelId;
  if (!canal) return { ok: false, erro: "nenhum canal configurado para a lista" };

  const [preset, cat, perfil, emojis, meta, linhas] = await Promise.all([
    post.preset_id ? getPreset(post.preset_id) : Promise.resolve(null),
    listParties(), perfilGear(), getEmojiMapResolvido(), getGuildMeta(),
    sql`SELECT chave, familia, user_id, party_id::int AS party_id, ordem_pt::int AS ordem_pt, confirmou
        FROM evento_escalacao WHERE evento_id = ${eventoId} ORDER BY party_id NULLS LAST, ordem_pt NULLS LAST, familia` as Promise<unknown>,
  ]);
  const rows = linhas as { chave: string; familia: string; user_id: string | null; party_id: number | null; ordem_pt: number | null; confirmou: boolean | null }[];

  const pById = new Map(cat.map((p) => [p.id, p]));
  // só as PTs DO PRESET, na ordem dele (mesma coisa que a escalação mostra)
  const parties: PartyL[] = (preset?.parties ?? []).map((v) => pById.get(v.party_id))
    .filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({ id: x.id, nome: x.nome, icone: x.icone || null }));

  const presenca = (await sql`SELECT chave, familia FROM evento_presenca WHERE evento_id = ${eventoId} AND participar ORDER BY familia`) as { chave: string; familia: string }[];
  const ingame = new Set(presenca.map((p) => p.chave));
  // ordem de chegada na chamada — é o que decide prioridade dentro da PT
  const posPorChave = new Map((await filaDaChamada(post.message_id)).map((f) => [f.chave, f.posicao]));
  const escalados: EscaladoL[] = rows.map((r) => {
    const p = perfil.get(r.chave);
    return {
      chave: r.chave, familia: r.familia, userId: r.user_id, partyId: r.party_id,
      guilda: p?.guilda ?? null, classe: p?.classe ?? null, gs: p?.gs ?? null,
      confirmouEscalacao: r.confirmou, confirmouIngame: ingame.has(r.chave), ordem: posPorChave.get(r.chave) ?? null,
      ordemPt: r.ordem_pt,
    };
  });

  const payload = montarLista({
    titulo: post.titulo, data: post.data, tamanhoMax: preset?.tamanho_max ?? null,
    parties, escalados,
    recusaram: rows.filter((r) => r.confirmou === false).map((r) => r.familia),
    foraDaEscalacao: presenca.filter((p) => !rows.some((r) => r.chave === p.chave && r.party_id != null)).map((p) => p.familia),
    emojis, tags: Object.fromEntries(meta.guildas.map((g) => [g.id, g.tag])),
  });
  const body = JSON.stringify({ allowed_mentions: { parse: [] }, ...payload });

  // edita a mensagem existente; se ela sumiu (apagada no Discord), posta uma nova
  if (post.lista_message_id && post.lista_channel_id) {
    const r = await botFetch(`/channels/${post.lista_channel_id}/messages/${post.lista_message_id}`, { method: "PATCH", body });
    if (r.ok) return { ok: true, editou: true };
    if (r.status !== 404) return { ok: false, erro: `Discord ${r.status}` };
  }
  const res = await botFetch(`/channels/${canal}/messages`, { method: "POST", body });
  if (!res.ok) return { ok: false, erro: `Discord ${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}` };
  const msg = (await res.json()) as { id: string };
  await sql`UPDATE intencao_post SET lista_message_id = ${msg.id}, lista_channel_id = ${canal} WHERE message_id = ${post.message_id}`;
  return { ok: true, editou: false };
}
