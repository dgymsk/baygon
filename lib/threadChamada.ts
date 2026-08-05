import { sql } from "@/lib/db";
import { botFetch, botConfigurado } from "@/lib/discordApi";

/**
 * Thread da chamada — o log vivo de quem marcou, na ordem em que marcou.
 *
 * O embed da mensagem principal é reescrito a cada clique e por isso não guarda história: quem olha
 * depois não sabe quem chegou primeiro. A thread guarda, porque é append-only — uma mensagem por
 * pessoa, na ordem de chegada, com o horário.
 *
 * Regra que sustenta tudo: a ordem NÃO vem de quando a mensagem foi postada (isso dependeria da
 * rede e de duas pessoas clicando junto), vem de `intencao_resp.vai_em`, carimbado na transação do
 * clique. A thread é só o espelho legível disso.
 *
 * Nada aqui pode derrubar a marcação: é tudo chamado depois da resposta da interação, e qualquer
 * falha do Discord vira log e segue.
 */

/** Cria a thread a partir da mensagem da chamada (ou devolve a que já existe). */
async function garantirThread(messageId: string, canalId: string, titulo: string): Promise<string | null> {
  const rows = (await sql`SELECT thread_id FROM intencao_post WHERE message_id = ${messageId}`) as { thread_id: string | null }[];
  if (rows[0]?.thread_id) return rows[0].thread_id;

  const res = await botFetch(`/channels/${canalId}/messages/${messageId}/threads`, {
    method: "POST",
    body: JSON.stringify({ name: `Ordem — ${titulo}`.slice(0, 100), auto_archive_duration: 1440 }),
  });
  if (!res.ok) {
    // 400 aqui costuma ser "já existe thread nessa mensagem" — sem id pra recuperar, desiste calado
    console.error("thread da chamada não criada:", res.status, (await res.text().catch(() => "")).slice(0, 140));
    return null;
  }
  const t = (await res.json()) as { id: string };
  // condição de corrida: dois cliques simultâneos criariam duas threads. O UPDATE condicional faz a
  // segunda perder — e a thread órfã fica no canal, o que é bem melhor que gravar o id errado.
  const upd = (await sql`
    UPDATE intencao_post SET thread_id = ${t.id} WHERE message_id = ${messageId} AND thread_id IS NULL
    RETURNING thread_id`) as { thread_id: string }[];
  return upd[0]?.thread_id ?? (await sql`SELECT thread_id FROM intencao_post WHERE message_id = ${messageId}`)[0]?.thread_id ?? null;
}

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * Anuncia na thread que alguém entrou, com a posição na fila. Só na PRIMEIRA vez: trocar de função
 * não gera mensagem nova (o `thread_msg_id` já gravado é o que barra), senão a ordem viraria um
 * histórico de edições em vez de uma fila.
 */
export async function anunciarNaThread(o: { messageId: string; userId: string }): Promise<void> {
  if (!botConfigurado()) return;
  try {
    const linhas = (await sql`
      SELECT r.familia, r.vai_em::text AS vai_em, r.thread_msg_id, p.channel_id, p.titulo, p.thread_id,
             f.nome AS funcao,
             -- desempate por user_id junto do carimbo: dois cliques no mesmo instante têm que
             -- receber posições diferentes, e a mesma ordem que filaDaChamada usa
             (SELECT count(*)::int FROM intencao_resp x
              WHERE x.message_id = r.message_id AND x.resposta = 'vai' AND x.vai_em IS NOT NULL
                AND (x.vai_em, x.user_id) <= (r.vai_em, r.user_id)) AS posicao
      FROM intencao_resp r
      JOIN intencao_post p ON p.message_id = r.message_id
      LEFT JOIN intencao_marca m ON m.message_id = r.message_id AND m.user_id = r.user_id
      LEFT JOIN funcao f ON f.id = m.funcao_id
      WHERE r.message_id = ${o.messageId} AND r.user_id = ${o.userId} AND r.resposta = 'vai'
    `) as { familia: string | null; vai_em: string | null; thread_msg_id: string | null; channel_id: string; titulo: string | null; thread_id: string | null; posicao: number; funcao: string | null }[];
    const l = linhas[0];
    if (!l || !l.vai_em || l.thread_msg_id) return; // não marcou, ou já foi anunciado

    const threadId = l.thread_id ?? (await garantirThread(o.messageId, l.channel_id, l.titulo ?? "chamada"));
    if (!threadId) return;

    const nome = l.familia || `<@${o.userId}>`;
    const texto = `\`#${String(l.posicao).padStart(2, "0")}\` **${nome}**${l.funcao ? ` · ${l.funcao}` : ""} — ${hora(l.vai_em)}`;
    const res = await botFetch(`/channels/${threadId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: texto.slice(0, 1900), allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) { console.error("thread: mensagem não postada", res.status); return; }
    const msg = (await res.json()) as { id: string };
    // grava só se ainda estiver vazio: dois cliques quase simultâneos não podem duplicar o anúncio
    await sql`UPDATE intencao_resp SET thread_msg_id = ${msg.id}
              WHERE message_id = ${o.messageId} AND user_id = ${o.userId} AND thread_msg_id IS NULL`;
  } catch (e) {
    console.error("anunciarNaThread erro", e); // nunca derruba a marcação
  }
}

/** Fila da chamada em ordem de chegada — o que a lista e a escalação usam pra priorizar. */
export type NaFila = { chave: string; familia: string | null; userId: string; vaiEm: string; posicao: number };
export async function filaDaChamada(messageId: string): Promise<NaFila[]> {
  return (await sql`
    SELECT chave, familia, user_id AS "userId", vai_em::text AS "vaiEm",
           row_number() OVER (ORDER BY vai_em, user_id)::int AS posicao
    FROM intencao_resp
    WHERE message_id = ${messageId} AND resposta = 'vai' AND vai_em IS NOT NULL
    ORDER BY vai_em, user_id`) as NaFila[];
}
