import { sql } from "@/lib/db";
import { botFetch, botConfigurado } from "@/lib/discordApi";
import { getIntencaoConfig } from "@/lib/intencaoConfig";
import { getParticipacaoConfig } from "@/lib/participacao";
import { montarLista, type EscaladoL, type PartyL } from "@/lib/listaEscalacao";
import { getPreset } from "@/lib/intencaoPreset";
import { listParties, partiesDoEvento } from "@/lib/party";
import { perfilGear } from "@/lib/players";
import { getEmojiMapResolvido } from "@/lib/emojiConfig";
import { listarEmojisGuild } from "@/lib/discordApi";
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
           COALESCE(e.titulo, e.tipo) AS titulo, to_char(e.data, 'DD/MM') AS data, e.tamanho_max::int AS tamanho_max
    FROM intencao_post p JOIN evento e ON e.id = p.evento_id
    WHERE p.evento_id = ${eventoId} ORDER BY p.criado DESC LIMIT 1`) as
    { message_id: string; tipo: string; preset_id: number | null; lista_message_id: string | null; lista_channel_id: string | null; titulo: string; data: string; tamanho_max: number | null }[];
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

  const [preset, cat, perfil, emojis, meta, emojisServidor, linhas] = await Promise.all([
    post.preset_id ? getPreset(post.preset_id) : Promise.resolve(null),
    listParties(), perfilGear(), getEmojiMapResolvido(), getGuildMeta(), listarEmojisGuild(),
    // o user_id é resolvido NA LEITURA, e não só no que a convocação gravou: evento_escalacao.user_id
    // só é preenchido quando alguém clica em Convocar, então publicar antes disso deixava a lista
    // inteira sem menção. A resposta da chamada e o registro do jogador já sabem quem é.
    sql`SELECT e.chave, e.familia, e.party_id::int AS party_id, e.ordem_pt::int AS ordem_pt, e.confirmou,
               COALESCE(e.user_id, r.user_id, pl.discord_id) AS user_id
        FROM evento_escalacao e
        LEFT JOIN LATERAL (SELECT ir.user_id FROM intencao_resp ir
                           JOIN intencao_post ip ON ip.message_id = ir.message_id
                           WHERE ip.evento_id = e.evento_id AND ir.chave = e.chave LIMIT 1) r ON TRUE
        LEFT JOIN players pl ON pl.nome_familia = e.familia
        WHERE e.evento_id = ${eventoId}
        ORDER BY e.party_id NULLS LAST, e.ordem_pt NULLS LAST, e.familia` as Promise<unknown>,
  ]);
  const rows = linhas as { chave: string; familia: string; user_id: string | null; party_id: number | null; ordem_pt: number | null; confirmou: boolean | null }[];

  const pById = new Map(cat.map((p) => [p.id, p]));
  // as PTs DESTE evento (na ordem que a staff arrastou), caindo na do preset quando ele não tem
  // lista própria. Ler do preset aqui e do evento na tela faria a mensagem divergir do site — e
  // uma PT adicionada só nesta guerra sumiria da lista publicada com todo mundo dentro dela.
  const proprias = await partiesDoEvento(eventoId);
  const ordem = proprias ?? (preset?.parties ?? []).map((v) => v.party_id);
  const parties: PartyL[] = ordem.map((id) => pById.get(id))
    .filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({ id: x.id, nome: x.nome, icone: x.icone || null }));

  const presenca = (await sql`SELECT chave, familia FROM evento_presenca WHERE evento_id = ${eventoId} AND participar ORDER BY familia`) as { chave: string; familia: string }[];
  const ingame = new Set(presenca.map((p) => p.chave));
  // ordem de chegada na chamada — é o que decide prioridade dentro da PT
  const fila = await filaDaChamada(post.message_id);
  const posPorChave = new Map(fila.map((f) => [f.chave, f.posicao]));
  // filler = apareceu in-game sem ter marcado na chamada; entrou de última hora
  const marcaram = new Set(fila.map((f) => f.chave));
  const escalados: EscaladoL[] = rows.map((r) => {
    const p = perfil.get(r.chave);
    return {
      chave: r.chave, familia: r.familia, userId: r.user_id, partyId: r.party_id,
      guilda: p?.guilda ?? null, classe: p?.classe ?? null, gs: p?.gs ?? null,
      confirmouEscalacao: r.confirmou, confirmouIngame: ingame.has(r.chave), ordem: posPorChave.get(r.chave) ?? null,
      ordemPt: r.ordem_pt, filler: ingame.has(r.chave) && !marcaram.has(r.chave),
    };
  });

  const payload = montarLista({
    // o teto do EVENTO manda; sem ele, o da chamada
    titulo: post.titulo, data: post.data, tamanhoMax: post.tamanho_max ?? preset?.tamanho_max ?? null,
    parties, escalados,
    recusaram: rows.filter((r) => r.confirmou === false).map((r) => r.familia),
    emojis, tags: Object.fromEntries(meta.guildas.map((g) => [g.id, g.tag])),
    // por NOME, não por id fixo: emoji apagado ou servidor trocado cai no fallback sozinho, em vez
    // de a lista passar a mostrar o código cru
    vazio: (() => {
      const e = emojisServidor.find((x) => x.name.toLowerCase() === "vazio");
      return e ? `<${e.animated ? "a" : ""}:${e.name}:${e.id}>` : null;
    })(),
  });
  // As menções ficam DENTRO do embed, e embed não notifica ninguém no Discord — elas rendem o chip
  // (nome do servidor, avatar no hover, clicável) sem ping. É o que se quer aqui: a lista é editada
  // a cada mudança de presença ou convocação, e um ping por edição seria insuportável.
  // Se um dia quiserem avisar de fato, o caminho é uma mensagem de texto à parte, fora do embed.
  const body = JSON.stringify({ allowed_mentions: { parse: [] }, ...payload });

  // edita a mensagem existente; se ela sumiu (apagada no Discord), posta uma nova
  if (post.lista_message_id && post.lista_channel_id) {
    const r = await botFetch(`/channels/${post.lista_channel_id}/messages/${post.lista_message_id}`, { method: "PATCH", body });
    if (r.ok) return { ok: true, editou: true };
    if (r.status !== 404) return { ok: false, erro: `Discord ${r.status}` };
    // 404 = a mensagem foi apagada no Discord. No espelho automático isso ENCERRA: repostar faria a
    // escalação de uma war antiga reaparecer hoje no canal só porque alguém corrigiu o nome dela.
    // Postar de novo é decisão da staff, no botão — que chama sem `soSePublicada`.
    await sql`UPDATE intencao_post SET lista_message_id = NULL, lista_channel_id = NULL WHERE message_id = ${post.message_id}`;
    if (o.soSePublicada) return { ok: true, editou: false };
  }
  const res = await botFetch(`/channels/${canal}/messages`, { method: "POST", body });
  if (!res.ok) return { ok: false, erro: `Discord ${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}` };
  const msg = (await res.json()) as { id: string };
  await sql`UPDATE intencao_post SET lista_message_id = ${msg.id}, lista_channel_id = ${canal} WHERE message_id = ${post.message_id}`;
  return { ok: true, editou: false };
}
