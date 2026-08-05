import { botFetch, botConfigurado } from "@/lib/discordApi";
import type { MensagensOrfas } from "@/lib/eventos";

/**
 * Cala as mensagens que o Discord continua mostrando depois que o evento é apagado.
 *
 * Apagar o evento no banco não apaga nada no Discord: a chamada segue no canal, com botões, e um
 * clique gravaria marcação num post que não pertence mais a evento nenhum — invisível no site e
 * impossível de rastrear. Tirar os componentes é o que encerra de verdade.
 *
 * Best-effort de propósito: se o Discord recusar (mensagem apagada à mão, canal sumiu, permissão),
 * o evento JÁ foi apagado e não há como desfazer. Falhar aqui não pode virar erro pro usuário —
 * vira aviso do que ficou pra trás.
 */
export async function silenciarOrfas(orfas: MensagensOrfas, motivo = "Evento apagado."): Promise<string[]> {
  if (!botConfigurado()) return ["bot não configurado — as mensagens seguem no Discord"];
  const restos: string[] = [];

  const tirarBotoes = async (m: { messageId: string; channelId: string }, rot: string) => {
    try {
      const res = await botFetch(`/channels/${m.channelId}/messages/${m.messageId}`, {
        method: "PATCH",
        body: JSON.stringify({ components: [], allowed_mentions: { parse: [] } }),
      });
      if (!res.ok) restos.push(`${rot}: Discord ${res.status}`);
    } catch (e) { restos.push(`${rot}: ${(e as Error).message}`); }
  };

  if (orfas.legado) await tirarBotoes(orfas.legado, "mensagem do bot antigo");
  if (orfas.chamada) await tirarBotoes(orfas.chamada, "chamada");
  // a lista é só embed, sem botão: limpar `components` nela não faria nada. O que engana é o
  // conteúdo — ela continua mostrando a escalação inteira como se valesse —, então o embed é
  // substituído pelo aviso.
  if (orfas.lista) {
    try {
      const res = await botFetch(`/channels/${orfas.lista.channelId}/messages/${orfas.lista.messageId}`, {
        method: "PATCH",
        body: JSON.stringify({
          embeds: [{ title: "🗑️ Escalação cancelada", description: motivo, color: 0x8f8f8f }],
          components: [], allowed_mentions: { parse: [] },
        }),
      });
      if (!res.ok) restos.push(`lista publicada: Discord ${res.status}`);
    } catch (e) { restos.push(`lista publicada: ${(e as Error).message}`); }
  }

  // a thread não some sozinha: arquivada e trancada ela para de aceitar mensagem e sai da barra
  // lateral, sem apagar o histórico de quem marcou primeiro (que é o valor dela)
  if (orfas.threadId) {
    try {
      // botFetch não lança em 4xx — sem checar res.ok, um 403 por falta de MANAGE_THREADS passaria
      // como sucesso e a thread continuaria viva sem ninguém saber
      const res = await botFetch(`/channels/${orfas.threadId}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: true, locked: true }),
      });
      if (!res.ok) restos.push(`thread da ordem: Discord ${res.status}`);
    } catch (e) { restos.push(`thread da ordem: ${(e as Error).message}`); }
  }

  // um aviso onde a chamada estava, senão a mensagem sem botão parece só quebrada
  if (orfas.chamada) {
    try {
      await botFetch(`/channels/${orfas.chamada.channelId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          message_reference: { message_id: orfas.chamada.messageId, fail_if_not_exists: false },
          allowed_mentions: { parse: [] },
          content: `🗑️ ${motivo} Esta chamada foi encerrada e não aceita mais marcação.`.slice(0, 1900),
        }),
      });
    } catch { /* best-effort */ }
  }

  return restos;
}
