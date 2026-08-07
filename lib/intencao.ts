import { sql } from "@/lib/db";
import { botFetch, botConfigurado } from "@/lib/discordApi";
import { rotuloTipo, type Tipo } from "@/lib/participacaoConfig";
import { getParticipacaoConfig } from "@/lib/participacao";
import { listFuncoes } from "@/lib/funcao";
import { getPreset, listElencoEsperado } from "@/lib/intencaoPreset";
import { montarEmbedIntencao, type FuncaoI, type MarcaI, type RespI } from "@/lib/intencaoEmbed";
import { perfilGear } from "@/lib/players";
import { getEmojiMapResolvido } from "@/lib/emojiConfig";
import { getGuildMeta } from "@/lib/guildConfig";
import { getIntencaoConfig } from "@/lib/intencaoConfig";
import { nomeDoEvento } from "@/lib/datas";

/**
 * Bot de INTENÇÃO — rodadas em que a pessoa marca EM QUAL FUNÇÃO pretende jogar (uma; marcar
 * outra troca), sem limite de vaga. As funções vêm de lib/funcao.ts; onde a pessoa fica de fato in-game é
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

/** O bot mostra TODAS as funções do catálogo (o preset não as filtra — ele define PTs e teto).
 *  Do preset vêm só o nome da rodada e o tipo. */
async function funcoesDoPreset(presetId: number): Promise<{ funcoes: FuncaoI[]; nome: string; tipo: string; tier: string | null; exigeRegistro: boolean; canalId: string | null } | null> {
  const [preset, cat] = await Promise.all([getPreset(presetId), listFuncoes()]);
  if (!preset) return null;
  // botões DO PRESET, na ordem dele. Preset sem função configurada cai no catálogo inteiro: é o
  // comportamento de antes, e evita que um preset recém-criado dispare uma chamada sem botão nenhum.
  const porId = new Map(cat.map((f) => [f.id, f]));
  const doPreset = preset.funcoes.map((v) => porId.get(v.funcao_id)).filter((x): x is NonNullable<typeof x> => !!x);
  const escolhidas = doPreset.length ? doPreset : cat;
  const funcoes: FuncaoI[] = escolhidas.map((p) => ({ id: p.id, nome: p.nome, emoji: p.emoji || null }));
  return { funcoes, nome: preset.nome, tipo: preset.tipo, tier: preset.tier, exigeRegistro: preset.exige_registro, canalId: preset.canal_id ?? null };
}

/** Reconstrói o payload da mensagem a partir do estado atual. Null se o preset sumiu. */
export async function montarPayload(messageId: string, presetId: number): Promise<Record<string, unknown> | null> {
  const info = await funcoesDoPreset(presetId);
  if (!info) return null;
  const cfg = (await getParticipacaoConfig())[info.tipo as Tipo];
  const [marcas, respostas, membros, perfil, emojis, meta] = await Promise.all([
    getMarcas(messageId), getRespostasInt(messageId), listElencoEsperado(),
    perfilGear(), getEmojiMapResolvido(), getGuildMeta(),
  ]);
  return montarEmbedIntencao({
    presetId, presetNome: info.nome, mensagem: cfg.mensagem, imagem: cfg.imagem,
    funcoes: info.funcoes, marcas, respostas, membros, perfil, emojis,
    tags: Object.fromEntries(meta.guildas.map((g) => [g.id, g.tag])),
  }) as unknown as Record<string, unknown>;
}

/** Posta uma rodada nova a partir do preset. Cria o EVENTO ligado (mesma CTE = sem evento órfão). */
export async function postarIntencao(presetId: number, o: { titulo?: string | null; data?: string | null } = {}): Promise<{ ok: boolean; erro?: string; messageId?: string; eventoUuid?: string }> {
  if (!botConfigurado()) return { ok: false, erro: "bot não configurado" };
  const info = await funcoesDoPreset(presetId);
  if (!info) return { ok: false, erro: "preset não encontrado" };
  if (!info.funcoes.length) return { ok: false, erro: "nenhuma função cadastrada — crie ao menos uma em Definições" };
  const cfg = (await getParticipacaoConfig())[info.tipo as Tipo];
  // canal da CHAMADA vem da config do hub; cai no da tela /participacao pra não quebrar o legado
  // prioridade: canal do PRESET → canal da chamada do tipo → canal antigo de /participacao
  const canal = info.canalId || (await getIntencaoConfig())[info.tipo as Tipo]?.canalChamada || cfg.channelId;
  if (!canal) return { ok: false, erro: `canal da chamada de ${rotuloTipo(info.tipo as Tipo)} não configurado` };

  // nome do evento: o que a staff digitou (ou o modelo da agenda já resolvido). Sem nada, o padrão
  // é a DATA do disparo — é como a staff nomeia, e é o que faz os três caminhos (botão do hub,
  // agenda e o slash /intencao-nodewar) baterem o mesmo nome em vez de um cair no nome do preset.
  const tituloEvento = (typeof o.titulo === "string" && o.titulo.trim()
    ? o.titulo.trim().slice(0, 200)
    : nomeDoEvento("{data}")) ?? info.nome;
  const dataEvento = typeof o.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.data) ? o.data : null;

  const [perfil, emojis, meta, membros] = await Promise.all([perfilGear(), getEmojiMapResolvido(), getGuildMeta(), listElencoEsperado()]);
  const payload = montarEmbedIntencao({
    presetId, presetNome: info.nome, mensagem: cfg.mensagem, imagem: cfg.imagem,
    funcoes: info.funcoes, marcas: [], respostas: [], membros, perfil, emojis,
    tags: Object.fromEntries(meta.guildas.map((g) => [g.id, g.tag])),
  });
  const res = await botFetch(`/channels/${canal}/messages`, {
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
      INSERT INTO evento (tipo, titulo, template_id, preset_id, tier, exige_registro, data)
      VALUES (${info.tipo}, ${tituloEvento}, NULL, ${presetId}, ${info.tier}, ${info.exigeRegistro},
              COALESCE(${dataEvento}::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date))
      RETURNING id, uuid
    ), p AS (
      INSERT INTO intencao_post (message_id, tipo, channel_id, titulo, preset_id, evento_id, criado)
      SELECT ${msg.id}, ${info.tipo}, ${canal}, ${info.nome}, ${presetId}, ev.id, now() FROM ev
      ON CONFLICT (message_id) DO NOTHING
    )
    SELECT uuid FROM ev`) as { uuid: string }[];
  return { ok: true, messageId: msg.id, eventoUuid: rows[0]?.uuid };
}

/**
 * Reescreve a mensagem no canal com o estado atual do banco. Usado pelo botão 🔄 do site —
 * o do Discord já se resolve pelo token da interação, sem precisar do bot token.
 */
export async function sincronizarMensagem(messageId: string): Promise<{ ok: boolean; erro?: string }> {
  if (!botConfigurado()) return { ok: false, erro: "bot não configurado" };
  const post = await getPostIntencao(messageId);
  if (!post) return { ok: false, erro: "mensagem não encontrada" };
  if (!post.preset_id) return { ok: false, erro: "rodada sem preset — não dá pra remontar" };
  const payload = await montarPayload(messageId, post.preset_id);
  if (!payload) return { ok: false, erro: "preset foi excluído" };
  const res = await botFetch(`/channels/${post.channel_id}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }), // nunca re-pinga ao editar
  });
  return res.ok ? { ok: true } : { ok: false, erro: `Discord ${res.status} ${(await res.text().catch(() => "")).slice(0, 140)}` };
}

type Quem = { messageId: string; userId: string; username: string; familia: string; chave: string; presetId: number };

/** Evento travado/finalizado não aceita mais marcação (mesmo gate do bot antigo). */
/**
 * A chamada exige registro? E quem clicou já se registrou?
 *
 * Uma consulta só, antes do ACK: depois dele não há como avisar quem clicou, e um botão que não
 * responde parece quebrado. Devolve o canal de registro junto pra mensagem poder dizer ONDE fazer.
 */
export async function podeMarcar(messageId: string, userId: string): Promise<{ ok: true } | { ok: false; motivo: "sem-registro" }> {
  const rows = (await sql`
    SELECT e.exige_registro,
           EXISTS (SELECT 1 FROM players p WHERE p.discord_id = ${userId} AND p.registro) AS registrado
    FROM intencao_post ip JOIN evento e ON e.id = ip.evento_id
    WHERE ip.message_id = ${messageId}`) as { exige_registro: boolean; registrado: boolean }[];
  if (!rows[0] || !rows[0].exige_registro) return { ok: true };   // sem trava, segue como sempre
  return rows[0].registrado ? { ok: true } : { ok: false, motivo: "sem-registro" };
}

export async function eventoAberto(messageId: string): Promise<boolean> {
  const rows = (await sql`SELECT p.evento_id, e.status FROM intencao_post p LEFT JOIN evento e ON e.id = p.evento_id WHERE p.message_id = ${messageId}`) as { evento_id: number | null; status: string | null }[];
  if (!rows[0]) return true;                    // mensagem desconhecida → segue (comportamento antigo)
  // post ÓRFÃO (evento apagado) trava, igual ao statusPorWarKey do bot antigo: senão a mensagem
  // viva de um evento deletado seguiria registrando marcação que não aparece em lugar nenhum
  if (rows[0].evento_id === null) return false;
  return rows[0].status === "aberto";
}

/**
 * Marca a pessoa numa FUNÇÃO — UMA por rodada. Clicar noutra função TROCA (não acumula): numa
 * war você joga numa posição só. Clicar na mesma desmarca e APAGA a resposta, voltando a "não
 * respondeu" — estado que a estatística de falta precisa distinguir de "recusou".
 *
 * Isto não conflita com a função de casa (intencao_membro), que segue múltipla: lá é a
 * capacidade (quais papéis a pessoa sabe fazer), aqui é a intenção desta war.
 */
export async function alternarMarca(o: Quem & { funcaoId: number }): Promise<Record<string, unknown> | null> {
  if (!(await eventoAberto(o.messageId))) return null;
  const ja = (await sql`SELECT funcao_id::int AS funcao_id FROM intencao_marca WHERE message_id = ${o.messageId} AND user_id = ${o.userId}`) as { funcao_id: number }[];
  const mesma = ja.some((m) => m.funcao_id === o.funcaoId);
  // troca = apaga a anterior e grava a nova, na mesma transação (nunca fica sem marca no meio)
  if (mesma) await sql`DELETE FROM intencao_marca WHERE message_id = ${o.messageId} AND user_id = ${o.userId}`;
  else await sql.transaction([
    sql`DELETE FROM intencao_marca WHERE message_id = ${o.messageId} AND user_id = ${o.userId}`,
    sql`INSERT INTO intencao_marca (message_id, user_id, funcao_id, chave, familia)
        VALUES (${o.messageId}, ${o.userId}, ${o.funcaoId}, ${o.chave}, ${o.familia})`,
  ]);

  const restantes = (await sql`SELECT count(*)::int AS n FROM intencao_marca WHERE message_id = ${o.messageId} AND user_id = ${o.userId}`) as { n: number }[];
  if (restantes[0]?.n) {
    // vai_em = carimbo do PRIMEIRO "vai". Trocar de função mantém o carimbo (e o lugar na fila);
    // vir de um "não vou" carimba agora, porque aí a pessoa acabou de entrar.
    await sql`INSERT INTO intencao_resp (message_id, user_id, username, familia, chave, resposta, vai_em, atualizado)
      VALUES (${o.messageId}, ${o.userId}, ${o.username}, ${o.familia}, ${o.chave}, 'vai', now(), now())
      ON CONFLICT (message_id, user_id) DO UPDATE SET username = EXCLUDED.username, familia = EXCLUDED.familia,
        chave = EXCLUDED.chave, resposta = 'vai',
        vai_em = CASE WHEN intencao_resp.resposta = 'vai' THEN COALESCE(intencao_resp.vai_em, now()) ELSE now() END,
        atualizado = now()`;
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
            chave = EXCLUDED.chave, resposta = 'nao', vai_em = NULL, thread_msg_id = NULL, atualizado = now()`,
    ]);
  }
  return montarPayload(o.messageId, o.presetId);
}
