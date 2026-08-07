import { sql } from "@/lib/db";
import { botFetch, botConfigurado } from "@/lib/discordApi";
import { motivoDaFalha, registrarEnvio, rotuloMotivo, SEM_DISCORD, type FalhaDM } from "@/lib/entregaDM";

/**
 * Envio de DM em LOTE — o mesmo desenho do Buzinador, aplicado à convocação da escalação.
 *
 * O motivo é tempo: cada pessoa custa DUAS chamadas ao Discord (abrir a DM e postar), então uma
 * escalação de 50 é ~100 idas e voltas em sequência. Numa requisição só isso estoura o tempo da
 * função na Vercel no meio do caminho: parte das DMs sai, nenhum relatório é gerado e não há como
 * saber onde parou. Fatiado, cada requisição manda poucos e devolve o placar.
 *
 * O estado de cada destinatário mora no BANCO (dm_lote_alvo), não na memória de quem clicou. É o
 * que faz o processo ser retomável: recarregar a página ou cair a internet não reenvia pra quem já
 * recebeu, e o relatório final tem a lista completa de quem ficou de fora.
 *
 * A composição da mensagem é por TIPO (ver `montarDM`), porque convocar e cobrar o participar
 * in-game são cobranças diferentes — e mandar as duas juntas confundiria quem já respondeu.
 */
export type TipoLote = "convocacao" | "ingame";

export type ProgressoLote = {
  ok: boolean; erro?: string;
  loteId: number; tipo: TipoLote; titulo: string;
  total: number; enviados: number; falhas: number; pendentes: number;
  concluido: boolean;
  falhasDetalhe: FalhaDM[];
  log?: { postou: boolean; erro?: string };
};

type Alvo = { chave: string; familia: string; user_id: string | null; party: string | null };

const ROTULO: Record<TipoLote, string> = {
  convocacao: "Convocação",
  ingame: "Pedido de participar in-game",
};

/** Nome do evento lido do banco — o título é editável, e a tela que disparou pode estar atrasada. */
async function tituloDoEvento(eventoId: number): Promise<string> {
  const rows = (await sql`SELECT COALESCE(titulo, tipo) AS titulo FROM evento WHERE id = ${eventoId}`) as { titulo: string }[];
  return rows[0]?.titulo ?? "Node War";
}

/**
 * Quem recebe, por tipo.
 *  - convocacao: escalado que ainda não respondeu a DM (ou TODOS, no reenvio);
 *  - ingame: escalado que não recusou e ainda não apareceu na conferência in-game.
 */
async function alvosDoTipo(tipo: TipoLote, eventoId: number, soNovos: boolean): Promise<Alvo[]> {
  if (tipo === "convocacao") {
    return (await sql`
      SELECT e.chave, e.familia, e.user_id, p.nome AS party
      FROM evento_escalacao e
      LEFT JOIN party p ON p.id = e.party_id
      WHERE e.evento_id = ${eventoId} AND e.party_id IS NOT NULL
        ${soNovos ? sql`AND e.confirmou IS NULL` : sql``}
      ORDER BY e.familia`) as Alvo[];
  }
  return (await sql`
    SELECT e.chave, e.familia, e.user_id, p.nome AS party
    FROM evento_escalacao e
    LEFT JOIN party p ON p.id = e.party_id
    WHERE e.evento_id = ${eventoId} AND e.party_id IS NOT NULL
      AND e.confirmou IS NOT FALSE                       -- quem recusou já saiu da conta
      AND NOT EXISTS (SELECT 1 FROM evento_presenca ep
                      WHERE ep.evento_id = e.evento_id AND ep.chave = e.chave AND ep.participar)
    ORDER BY e.familia`) as Alvo[];
}

/**
 * Resolve o Discord de cada escalado. Duas fontes: a resposta dele na chamada (o vínculo mais
 * fresco) e o registro do jogador. A segunda existe porque num evento criado à mão não há chamada,
 * e quem foi escalado na unha caía todo em "sem Discord vinculado".
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

/** Abre o lote: resolve os alvos e grava um por linha, todos pendentes. */
export async function criarLoteDM(o: { tipo: TipoLote; eventoId: number; soNovos?: boolean; porQuem?: string | null }):
  Promise<{ ok: boolean; erro?: string; loteId?: number; total?: number }> {
  if (!botConfigurado()) return { ok: false, erro: "bot não configurado" };
  const titulo = await tituloDoEvento(o.eventoId);
  await resolverUserIds(o.eventoId);
  const alvos = await alvosDoTipo(o.tipo, o.eventoId, o.soNovos !== false);
  if (!alvos.length) return { ok: false, erro: o.tipo === "convocacao" ? "ninguém pra convocar — escale alguém antes" : "todos os escalados já apareceram in-game" };

  const rows = (await sql`
    INSERT INTO dm_lote (tipo, evento_id, titulo, criado_por, total)
    VALUES (${o.tipo}, ${o.eventoId}, ${titulo}, ${o.porQuem ?? null}, ${alvos.length})
    RETURNING id::int AS id`) as { id: number }[];
  const loteId = rows[0].id;
  for (const a of alvos) {
    await sql`INSERT INTO dm_lote_alvo (lote_id, chave, familia, user_id, party)
      VALUES (${loteId}, ${a.chave}, ${a.familia}, ${a.user_id}, ${a.party})
      ON CONFLICT (lote_id, chave) DO NOTHING`;
  }
  return { ok: true, loteId, total: alvos.length };
}

/** O corpo da DM, por tipo. Convocar tem botões (a resposta volta pro banco); cobrar in-game não —
 *  o site não tem como saber que a pessoa marcou no jogo, e um botão aqui fingiria resolver. */
function montarDM(tipo: TipoLote, eventoId: number, titulo: string, party: string | null): Record<string, unknown> {
  if (tipo === "convocacao") {
    return {
      allowed_mentions: { parse: [] },
      embeds: [{
        title: `⚔️ Você foi escalado — ${titulo}`.slice(0, 256),
        description: `Sua PT: **${party ?? "—"}**\n\nConfirma que vai jogar? Se não puder, avise agora — a staff remaneja a vaga.`,
        color: 0xcc0000,
      }],
      components: [{
        type: 1,
        components: [
          { type: 2, style: 3, label: "✅ Confirmo", custom_id: `int:esc:${eventoId}:sim` },
          { type: 2, style: 4, label: "❌ Não vou", custom_id: `int:esc:${eventoId}:nao` },
        ],
      }],
    };
  }
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `🎮 Marque participar in-game — ${titulo}`.slice(0, 256),
      description: `Você está escalado${party ? ` na **${party}**` : ""}, mas ainda não apareceu na lista de participantes do jogo.\n\nAbra o Black Desert e marque **participar** na guerra. Quem não marca não entra na conta.`,
      color: 0xd6b22a,
    }],
  };
}

/**
 * Histórico de chamadas do evento — cada disparo com o placar e a lista de quem recebeu ou não.
 *
 * O relatório do canal de log é bom pra staff inteira ver na hora, mas some no meio das outras
 * mensagens. Aqui fica preso ao evento: dá pra abrir a guerra de semana passada e responder "essa
 * pessoa foi chamada?" e "quando?" sem depender de rolar canal.
 */
/** Sem user_id de propósito: a tela não usa, e mandar o Discord de todo escalado pro navegador de
 *  qualquer membro logado é vazamento gratuito. */
export type AlvoLote = { familia: string; status: string; motivo: string | null; tentado: string | null };
export type LoteResumo = {
  id: number; tipo: TipoLote; rotulo: string; criadoPor: string | null;
  criado: string; concluido: string | null; status: string;
  total: number; enviados: number; falhas: number; pendentes: number;
  logOk: boolean | null; logErro: string | null;
  alvos: AlvoLote[];
};

export async function historicoLotes(eventoId: number): Promise<LoteResumo[]> {
  const lotes = (await sql`
    SELECT l.id::int AS id, l.tipo, l.criado_por, l.status, l.total::int AS total,
           l.criado::text AS criado, l.concluido::text AS concluido, l.log_ok, l.log_erro,
           count(a.*) FILTER (WHERE a.status = 'ok')::int AS enviados,
           count(a.*) FILTER (WHERE a.status = 'falha')::int AS falhas,
           count(a.*) FILTER (WHERE a.status NOT IN ('ok', 'falha'))::int AS pendentes
    FROM dm_lote l LEFT JOIN dm_lote_alvo a ON a.lote_id = l.id
    WHERE l.evento_id = ${eventoId}
    GROUP BY l.id ORDER BY l.criado DESC`) as {
      id: number; tipo: TipoLote; criado_por: string | null; status: string; total: number;
      criado: string; concluido: string | null; log_ok: boolean | null; log_erro: string | null;
      enviados: number; falhas: number; pendentes: number;
    }[];
  if (!lotes.length) return [];

  // uma consulta só pros alvos de todos os lotes — um SELECT por lote seria N+1 numa tela que
  // recarrega sozinha a cada 20 segundos
  const ids = lotes.map((l) => l.id);
  const alvos = (await sql`
    SELECT lote_id::int AS lote_id, familia, status, erro, tentado::text AS tentado
    FROM dm_lote_alvo WHERE lote_id = ANY(${ids as unknown as number[]})
    ORDER BY familia`) as { lote_id: number; familia: string; status: string; erro: string | null; tentado: string | null }[];
  const porLote = new Map<number, AlvoLote[]>();
  for (const a of alvos) {
    const item: AlvoLote = { familia: a.familia, status: a.status, motivo: a.status === "falha" ? rotuloMotivo(a.erro) : null, tentado: a.tentado };
    const lista = porLote.get(a.lote_id);
    if (lista) lista.push(item); else porLote.set(a.lote_id, [item]);
  }

  return lotes.map((l) => ({
    id: l.id, tipo: l.tipo, rotulo: ROTULO[l.tipo] ?? l.tipo, criadoPor: l.criado_por,
    criado: l.criado, concluido: l.concluido, status: l.status,
    total: l.total, enviados: l.enviados, falhas: l.falhas, pendentes: l.pendentes,
    logOk: l.log_ok, logErro: l.log_erro, alvos: porLote.get(l.id) ?? [],
  }));
}

/** Placar atual do lote. */
async function contar(loteId: number): Promise<{ total: number; ok: number; falha: number; pend: number }> {
  const rows = (await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status = 'ok')::int AS ok,
           count(*) FILTER (WHERE status = 'falha')::int AS falha,
           -- 'enviando' conta como pendente: um lote que morreu no meio não pode fechar o envio
           count(*) FILTER (WHERE status NOT IN ('ok', 'falha'))::int AS pend
    FROM dm_lote_alvo WHERE lote_id = ${loteId}`) as { total: number; ok: number; falha: number; pend: number }[];
  return rows[0] ?? { total: 0, ok: 0, falha: 0, pend: 0 };
}

async function falhasDoLote(loteId: number): Promise<FalhaDM[]> {
  const rows = (await sql`
    SELECT familia, user_id, erro FROM dm_lote_alvo
    WHERE lote_id = ${loteId} AND status = 'falha' ORDER BY familia`) as { familia: string; user_id: string | null; erro: string | null }[];
  return rows.map((r) => ({ familia: r.familia, userId: r.user_id, motivo: rotuloMotivo(r.erro) }));
}

/**
 * Manda o próximo lote. `tamanho` é conservador de propósito: cada alvo são duas chamadas ao
 * Discord, e o objetivo é caber com folga no tempo da função mesmo com a rede lenta.
 *
 * O `FOR UPDATE SKIP LOCKED` no claim é o que impede que duas abas processando o mesmo lote mandem
 * a mesma DM duas vezes.
 */
export async function processarLoteDM(loteId: number, tamanho = 8): Promise<ProgressoLote> {
  const lotes = (await sql`SELECT id::int AS id, tipo, evento_id::int AS evento_id, titulo, criado_por, status FROM dm_lote WHERE id = ${loteId}`) as
    { id: number; tipo: TipoLote; evento_id: number; titulo: string; criado_por: string | null; status: string }[];
  const lote = lotes[0];
  if (!lote) return { ok: false, erro: "lote não encontrado", loteId, tipo: "convocacao", titulo: "", total: 0, enviados: 0, falhas: 0, pendentes: 0, concluido: true, falhasDetalhe: [] };

  // recupera alvo preso em 'enviando' de um lote que morreu no meio — um lote dura poucos segundos,
  // então 2 minutos parado é órfão, e sem isto o envio nunca fecharia
  await sql`UPDATE dm_lote_alvo SET status = 'pendente' WHERE lote_id = ${loteId} AND status = 'enviando' AND (tentado IS NULL OR tentado < now() - interval '2 minutes')`;
  const pend = (await sql`
    UPDATE dm_lote_alvo SET status = 'enviando', tentado = now()
    WHERE id IN (SELECT id FROM dm_lote_alvo WHERE lote_id = ${loteId} AND status = 'pendente' ORDER BY id LIMIT ${tamanho} FOR UPDATE SKIP LOCKED)
    RETURNING id::int AS id, chave, familia, user_id, party`) as { id: number; chave: string; familia: string; user_id: string | null; party: string | null }[];

  for (const a of pend) {
    let erro: string | null = null;
    if (!a.user_id) erro = SEM_DISCORD;
    else {
      try {
        const dm = await botFetch(`/users/@me/channels`, { method: "POST", body: JSON.stringify({ recipient_id: a.user_id }) });
        if (!dm.ok) erro = await motivoDaFalha(dm, "abrir");
        else {
          const ch = (await dm.json()) as { id: string };
          const res = await botFetch(`/channels/${ch.id}/messages`, { method: "POST", body: JSON.stringify(montarDM(lote.tipo, lote.evento_id, lote.titulo, a.party)) });
          if (!res.ok) erro = await motivoDaFalha(res, "enviar");
        }
      } catch (e) { erro = (e as Error).message; }
    }
    await sql`UPDATE dm_lote_alvo SET status = ${erro ? "falha" : "ok"}, erro = ${erro}, tentado = now() WHERE id = ${a.id}`;
    // o carimbo de convocado é o que a tela usa pra separar "não chamado" de "chamado e calado"
    if (!erro && lote.tipo === "convocacao") {
      await sql`UPDATE evento_escalacao SET convidado_em = now() WHERE evento_id = ${lote.evento_id} AND chave = ${a.chave}`;
    }
    await new Promise((r) => setTimeout(r, 150)); // respiro entre DMs, como no Buzinador: 429 em rajada custa mais
  }

  const c = await contar(loteId);
  let log: { postou: boolean; erro?: string } | undefined;
  if (c.pend === 0) {
    // claim atômico: só uma chamada fecha o lote e posta o relatório, mesmo com duas abas abertas
    const claim = (await sql`
      UPDATE dm_lote SET status = 'concluido', concluido = now()
      WHERE id = ${loteId} AND status <> 'concluido' RETURNING id::int AS id`) as { id: number }[];
    if (claim.length) {
      log = await registrarEnvio({
        acao: ROTULO[lote.tipo], evento: lote.titulo, porQuem: lote.criado_por,
        enviados: c.ok, falhas: await falhasDoLote(loteId),
      });
      await sql`UPDATE dm_lote SET log_ok = ${log.postou}, log_erro = ${log.erro ?? null} WHERE id = ${loteId}`;
    } else {
      const r = (await sql`SELECT log_ok, log_erro FROM dm_lote WHERE id = ${loteId}`) as { log_ok: boolean | null; log_erro: string | null }[];
      if (r[0]?.log_ok != null) log = { postou: r[0].log_ok, erro: r[0].log_erro ?? undefined };
    }
  }

  return {
    ok: true, loteId, tipo: lote.tipo, titulo: lote.titulo,
    total: c.total, enviados: c.ok, falhas: c.falha, pendentes: c.pend,
    concluido: c.pend === 0, falhasDetalhe: c.pend === 0 ? await falhasDoLote(loteId) : [], log,
  };
}
