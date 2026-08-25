import { sql } from "@/lib/db";
import { botFetch, botConfigurado } from "@/lib/discordApi";

/**
 * DESDIZER o aviso de saída de quem VOLTOU pra escalação.
 *
 * O aviso é a única DM do app que precisa poder ser retirada. As outras envelhecem sem estragar nada
 * — uma convocação velha diz "você está escalado", e no pior caso a pessoa confirma algo que já
 * mudou. Esta manda AGIR DENTRO DO JOGO ("tire o participar"), e quem a lê depois de ter sido
 * reescalado sai de uma guerra em que está escalado, deixando a PT com um a menos sem ninguém
 * perceber. A mensagem no privado dura pra sempre; a escalação muda em dez minutos.
 *
 * EDITA, não apaga. Apagar em silêncio resolveria o texto errado e criaria um problema pior: quem já
 * tinha tirado o participar obedecendo o aviso nunca saberia que precisa marcar de novo. A edição
 * carrega justamente esse pedido.
 *
 * Roda depois de cada gravação da escalação (app/api/hub, ação `escalar`), e é barata: uma consulta
 * indexada que quase sempre volta vazia. O `retratado_em` é carimbado DEPOIS do PATCH dar certo,
 * então falha de rede não perde o conserto — o próximo arraste tenta de novo — e sucesso não vira
 * loop de edição a cada arraste, que é como se toma limite do Discord.
 */
type AlvoRetratar = {
  id: number; dm_channel_id: string | null; dm_message_id: string | null; user_id: string | null;
  familia: string; party: string | null; titulo: string;
};

/** O começo do título do aviso (ver `montarDM` em lib/loteDM) — é por ele que a mensagem é
 *  reconhecida quando o id não foi guardado. */
const TITULO_AVISO = "Você não está mais escalado";

/**
 * Reencontra a mensagem do aviso no privado da pessoa, quando o envio não guardou o id.
 *
 * Vale só pros avisos disparados ANTES de `dm_message_id` existir. Abrir a DM devolve sempre o mesmo
 * canal, e lá dentro só há duas vozes: a do bot e a da pessoa — que não posta embed. Devolve
 * `{ achou: false }` quando a leitura funcionou e não havia nada (a pessoa apagou, ou o aviso é
 * antigo demais pras últimas 25 mensagens), e `null` quando o DISCORD falhou: um é fim de linha, o
 * outro é pra tentar de novo, e tratá-los igual perderia o conserto ou repetiria pra sempre.
 */
async function acharAviso(userId: string): Promise<{ canal: string; mensagem: string } | { achou: false } | null> {
  try {
    const dm = await botFetch(`/users/@me/channels`, { method: "POST", body: JSON.stringify({ recipient_id: userId }) }, 2);
    if (!dm.ok) return null;
    const canal = ((await dm.json()) as { id: string }).id;
    const lista = await botFetch(`/channels/${canal}/messages?limit=25`, { method: "GET" }, 2);
    if (!lista.ok) return null;
    const msgs = (await lista.json()) as { id: string; author?: { id?: string }; embeds?: { title?: string }[] }[];
    const eu = await botFetch(`/users/@me`, { method: "GET" }, 2);
    const meuId = eu.ok ? ((await eu.json()) as { id?: string }).id : null;
    const achada = msgs.find((m) => (!meuId || m.author?.id === meuId) && (m.embeds?.[0]?.title ?? "").includes(TITULO_AVISO));
    return achada ? { canal, mensagem: achada.id } : { achou: false };
  } catch { return null; }
}

export async function retratarAvisosDeQuemVoltou(eventoId: number): Promise<{ retratadas: number; falhas: number }> {
  if (!botConfigurado() || !Number.isFinite(eventoId)) return { retratadas: 0, falhas: 0 };

  const alvos = (await sql`
    SELECT a.id::int AS id, a.dm_channel_id, a.dm_message_id, a.user_id, a.familia,
           p.nome AS party, COALESCE(ev.titulo, ev.tipo) AS titulo
    FROM dm_lote_alvo a
    JOIN dm_lote l ON l.id = a.lote_id AND l.tipo = 'desescalado' AND l.evento_id = ${eventoId}
    JOIN evento_escalacao e ON e.evento_id = ${eventoId} AND e.chave = a.chave AND e.party_id IS NOT NULL
    JOIN evento ev ON ev.id = ${eventoId}
    LEFT JOIN party p ON p.id = e.party_id
    WHERE a.status = 'ok' AND a.retratado_em IS NULL
      AND ((a.dm_channel_id IS NOT NULL AND a.dm_message_id IS NOT NULL) OR a.user_id IS NOT NULL)`) as AlvoRetratar[];
  if (!alvos.length) return { retratadas: 0, falhas: 0 };

  let retratadas = 0, falhas = 0;
  for (const a of alvos) {
    // envio antigo, sem id guardado: procura a mensagem no privado antes de desistir dela
    let canal = a.dm_channel_id, mensagem = a.dm_message_id;
    if (!canal || !mensagem) {
      const achado = a.user_id ? await acharAviso(a.user_id) : { achou: false as const };
      if (achado === null) { falhas++; continue; }                       // Discord falhou: tenta depois
      if ("achou" in achado) {                                          // leu e não há mensagem: fim
        await sql`UPDATE dm_lote_alvo SET retratado_em = now() WHERE id = ${a.id}`;
        falhas++; continue;
      }
      canal = achado.canal; mensagem = achado.mensagem;
      await sql`UPDATE dm_lote_alvo SET dm_channel_id = ${canal}, dm_message_id = ${mensagem} WHERE id = ${a.id}`;
    }
    const body = JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [{
        title: `✅ Você voltou pra escalação — ${a.titulo}`.slice(0, 256),
        description: [
          `O aviso acima não vale mais: você **está** escalado${a.party ? ` na **${a.party}**` : ""}.`,
          "",
          "Se você chegou a tirar o *participar* dentro do jogo, **marque de novo**.",
        ].join("\n"),
        color: 0x2f9e44,
      }],
    });
    try {
      const r = await botFetch(`/channels/${canal}/messages/${mensagem}`, { method: "PATCH", body }, 2);
      if (r.ok) {
        await sql`UPDATE dm_lote_alvo SET retratado_em = now() WHERE id = ${a.id}`;
        retratadas++;
      } else if (r.status === 404) {
        // a pessoa apagou a DM (ou o canal sumiu): não há o que editar, e insistir a cada arraste
        // seria bater no Discord pra sempre por causa de uma mensagem que não existe mais
        await sql`UPDATE dm_lote_alvo SET retratado_em = now() WHERE id = ${a.id}`;
        falhas++;
      } else falhas++;
    } catch { falhas++; }
  }
  return { retratadas, falhas };
}
