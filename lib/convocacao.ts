import { sql } from "@/lib/db";
import { botFetch, botConfigurado } from "@/lib/discordApi";

/**
 * CONVOCAÇÃO — a confirmação DA ESCALAÇÃO, por DM. É o passo do meio do funil:
 *
 *   marcou no bot  →  staff escala  →  [CONVOCAÇÃO: aceita ou recusa por DM]  →  aparece in-game
 *
 * Recusar tira a pessoa da PT na hora (party_id = NULL) mas mantém a linha com confirmou=false —
 * é o que separa "avisou que não vinha" de "sumiu", e a vaga já abre pra staff remanejar.
 */
export type AlvoConvocacao = { chave: string; familia: string; userId: string | null; party: string | null };

/** Quem está escalado e ainda não respondeu (ou todos, se `sonovos` for false). */
export async function alvosConvocacao(eventoId: number, soNovos = true): Promise<AlvoConvocacao[]> {
  const rows = (await sql`
    SELECT e.chave, e.familia, e.user_id, p.nome AS party
    FROM evento_escalacao e
    LEFT JOIN party p ON p.id = e.party_id
    WHERE e.evento_id = ${eventoId} AND e.party_id IS NOT NULL
      ${soNovos ? sql`AND e.confirmou IS NULL` : sql``}
    ORDER BY e.familia`) as { chave: string; familia: string; user_id: string | null; party: string | null }[];
  return rows.map((r) => ({ chave: r.chave, familia: r.familia, userId: r.user_id, party: r.party }));
}

/**
 * Resolve o Discord de cada escalado. Duas fontes, nesta ordem:
 * 1. a resposta dele na chamada — o vínculo mais fresco, e o único que existia até aqui;
 * 2. o registro do jogador (`players.discord_id`).
 *
 * A segunda existe porque a primeira só funciona pra quem clicou no bot: num evento criado à mão
 * não há chamada nenhuma, e quem foi escalado na unha sem ter respondido caía todo em "sem Discord
 * vinculado" — a convocação inteira falhava sem ter como dar certo.
 */
async function resolverUserIds(eventoId: number): Promise<void> {
  await sql`
    UPDATE evento_escalacao e SET user_id = r.user_id
    FROM intencao_resp r
    JOIN intencao_post p ON p.message_id = r.message_id
    WHERE p.evento_id = ${eventoId} AND e.evento_id = ${eventoId}
      AND r.chave = e.chave AND e.user_id IS NULL`;
  await sql`
    UPDATE evento_escalacao e SET user_id = pl.discord_id
    FROM players pl
    WHERE e.evento_id = ${eventoId} AND e.user_id IS NULL
      AND pl.nome_familia = e.familia AND pl.discord_id IS NOT NULL`;
}

const linha = (comps: object[]) => ({ type: 1, components: comps });

/**
 * Dispara a DM de convocação. Devolve o que foi enviado e o que falhou — DM fechada é o caso
 * comum e não pode derrubar o lote.
 */
export async function convocar(eventoId: number, titulo: string, soNovos = true): Promise<{ ok: boolean; erro?: string; enviados: number; falhas: { familia: string; motivo: string }[] }> {
  if (!botConfigurado()) return { ok: false, erro: "bot não configurado", enviados: 0, falhas: [] };
  await resolverUserIds(eventoId);
  const alvos = await alvosConvocacao(eventoId, soNovos);
  if (!alvos.length) return { ok: true, enviados: 0, falhas: [] };

  const falhas: { familia: string; motivo: string }[] = [];
  let enviados = 0;
  for (const a of alvos) {
    if (!a.userId) { falhas.push({ familia: a.familia, motivo: "sem Discord vinculado" }); continue; }
    try {
      const dm = await botFetch(`/users/@me/channels`, { method: "POST", body: JSON.stringify({ recipient_id: a.userId }) });
      if (!dm.ok) { falhas.push({ familia: a.familia, motivo: `DM ${dm.status}` }); continue; }
      const ch = (await dm.json()) as { id: string };
      const res = await botFetch(`/channels/${ch.id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          allowed_mentions: { parse: [] },
          embeds: [{
            title: `⚔️ Você foi escalado — ${titulo}`.slice(0, 256),
            description: `Sua PT: **${a.party ?? "—"}**\n\nConfirma que vai jogar? Se não puder, avise agora — a staff remaneja a vaga.`,
            color: 0xcc0000,
          }],
          components: [linha([
            { type: 2, style: 3, label: "✅ Confirmo", custom_id: `int:esc:${eventoId}:sim` },
            { type: 2, style: 4, label: "❌ Não vou", custom_id: `int:esc:${eventoId}:nao` },
          ])],
        }),
      });
      if (!res.ok) { falhas.push({ familia: a.familia, motivo: `msg ${res.status}` }); continue; }
      await sql`UPDATE evento_escalacao SET convidado_em = now() WHERE evento_id = ${eventoId} AND chave = ${a.chave}`;
      enviados++;
    } catch (e) { falhas.push({ familia: a.familia, motivo: (e as Error).message }); }
  }
  return { ok: true, enviados, falhas };
}

/**
 * Registra a resposta da DM. Recusar TIRA da PT na mesma statement — a vaga abre imediatamente,
 * sem depender de a staff perceber.
 */
export async function responderConvocacao(eventoId: number, userId: string, aceita: boolean): Promise<{ ok: boolean; familia?: string }> {
  const rows = (await sql`
    UPDATE evento_escalacao
    SET confirmou = ${aceita}, respondeu_em = now(),
        party_id = CASE WHEN ${aceita} THEN party_id ELSE NULL END
    WHERE evento_id = ${eventoId} AND user_id = ${userId}
    RETURNING familia`) as { familia: string }[];
  return rows[0] ? { ok: true, familia: rows[0].familia } : { ok: false };
}

/**
 * Cobra o "participar" IN-GAME de quem já está escalado e ainda não apareceu na conferência.
 *
 * É uma cobrança diferente da convocação: lá a pergunta é "você vai?", aqui a pessoa já disse que
 * vai e só falta apertar o botão dentro do jogo. Mandar as duas juntas confundiria — quem já
 * confirmou na DM ia achar que precisava confirmar de novo.
 *
 * Sem botão de propósito: o site não tem como saber que a pessoa marcou no jogo, isso só chega pelo
 * print da conferência. Um botão aqui daria a impressão de resolver e não resolveria nada.
 */
export async function pedirParticiparIngame(eventoId: number, titulo: string): Promise<{ ok: boolean; erro?: string; enviados: number; falhas: { familia: string; motivo: string }[] }> {
  if (!botConfigurado()) return { ok: false, erro: "bot não configurado", enviados: 0, falhas: [] };
  await resolverUserIds(eventoId);

  const alvos = (await sql`
    SELECT e.chave, e.familia, e.user_id, p.nome AS party
    FROM evento_escalacao e
    LEFT JOIN party p ON p.id = e.party_id
    WHERE e.evento_id = ${eventoId} AND e.party_id IS NOT NULL
      AND e.confirmou IS NOT FALSE                       -- quem recusou já saiu da conta
      AND NOT EXISTS (SELECT 1 FROM evento_presenca ep
                      WHERE ep.evento_id = e.evento_id AND ep.chave = e.chave AND ep.participar)
    ORDER BY e.familia`) as { chave: string; familia: string; user_id: string | null; party: string | null }[];
  if (!alvos.length) return { ok: true, enviados: 0, falhas: [] };

  const falhas: { familia: string; motivo: string }[] = [];
  let enviados = 0;
  for (const a of alvos) {
    if (!a.user_id) { falhas.push({ familia: a.familia, motivo: "sem Discord vinculado" }); continue; }
    try {
      const dm = await botFetch(`/users/@me/channels`, { method: "POST", body: JSON.stringify({ recipient_id: a.user_id }) });
      if (!dm.ok) { falhas.push({ familia: a.familia, motivo: `DM ${dm.status}` }); continue; }
      const ch = (await dm.json()) as { id: string };
      const res = await botFetch(`/channels/${ch.id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          allowed_mentions: { parse: [] },
          embeds: [{
            title: `🎮 Marque participar in-game — ${titulo}`.slice(0, 256),
            description: `Você está escalado${a.party ? ` na **${a.party}**` : ""}, mas ainda não apareceu na lista de participantes do jogo.\n\nAbra o Black Desert e marque **participar** na guerra. Quem não marca não entra na conta.`,
            color: 0xd6b22a,
          }],
        }),
      });
      if (!res.ok) { falhas.push({ familia: a.familia, motivo: `msg ${res.status}` }); continue; }
      enviados++;
    } catch (e) { falhas.push({ familia: a.familia, motivo: (e as Error).message }); }
  }
  return { ok: true, enviados, falhas };
}
