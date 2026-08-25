import { sql } from "@/lib/db";
import { botFetch, botConfigurado } from "@/lib/discordApi";
import { motivoDaFalha, registrarEnvio, rotuloMotivo, SEM_DISCORD, type FalhaDM } from "@/lib/entregaDM";
import { getDiscordConfig } from "@/lib/discordConfig";
import { servidoresDoEvento, textoServidores } from "@/lib/servidorGuerra";
import { chaveNome } from "@/lib/nomes";
import { SAIU, JA_AVISADO, SEM_CONVITE_VALIDO } from "@/lib/desescalado";

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
export type TipoLote = "convocacao" | "ingame" | "intencao" | "desescalado";

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
  intencao: "Lembrete de intenção",
  desescalado: "Aviso de saída da escalação",
};

/**
 * Link direto pra mensagem da chamada no Discord (`/channels/guild/canal/mensagem`).
 *
 * É o que transforma o lembrete de recado em ação: sem ele a DM diz "vai lá marcar" e a pessoa
 * precisa caçar a mensagem no meio do canal. Null quando falta guild, canal ou mensagem — aí a DM
 * sai sem o botão, em vez de com um link quebrado.
 */
async function linkDaChamada(eventoId: number): Promise<string | null> {
  const [cfg, posts] = await Promise.all([
    getDiscordConfig(),
    sql`SELECT message_id, channel_id FROM intencao_post WHERE evento_id = ${eventoId} ORDER BY criado DESC LIMIT 1` as Promise<unknown>,
  ]);
  const p = (posts as { message_id: string; channel_id: string }[])[0];
  if (!cfg.guildId || !p?.channel_id || !p?.message_id) return null;
  return `https://discord.com/channels/${cfg.guildId}/${p.channel_id}/${p.message_id}`;
}

/** Nome do evento lido do banco — o título é editável, e a tela que disparou pode estar atrasada. */
async function tituloDoEvento(eventoId: number): Promise<string> {
  const rows = (await sql`SELECT COALESCE(titulo, tipo) AS titulo FROM evento WHERE id = ${eventoId}`) as { titulo: string }[];
  return rows[0]?.titulo ?? "Node War";
}

/**
 * Público-alvo do disparo. A distinção que importa é entre NÃO RESPONDEU e NÃO RECEBEU: quem
 * recebeu a DM e ficou calado já foi cobrado, e reenviar pra ele é spam — o caso vira comum quando
 * o Discord limita o bot e o lote sai pela metade.
 */
export type PublicoLote =
  | "nao_receberam"      // convocação: escalado que nunca recebeu a DM desta chamada
  | "sem_resposta"       // convocação: escalado que não respondeu (recebendo ou não)
  | "todos"              // convocação: todo escalado
  | "confirmou_nao_recebeu" // in-game: disse SIM e ainda não recebeu a cobrança
  | "confirmou"          // in-game: todo mundo que disse SIM
  | "faltam_ingame"      // in-game: não recusou e não apareceu na conferência
  | "calados_nao_receberam" // intenção: não respondeu a chamada e ainda não recebeu o lembrete
  | "calados"            // intenção: todo mundo que não respondeu a chamada
  | "saiu_nao_avisado"   // saída: foi tirado da escalação e ainda não foi avisado disso
  | "saiu_todos";        // saída: todo mundo que está fora depois de ter sido convocado

export const ROTULO_PUBLICO: Record<PublicoLote, string> = {
  nao_receberam: "quem ainda não recebeu",
  sem_resposta: "quem não respondeu",
  todos: "todos os escalados",
  confirmou_nao_recebeu: "confirmou e não recebeu",
  confirmou: "quem confirmou o SIM",
  faltam_ingame: "quem falta aparecer in-game",
  calados_nao_receberam: "calados que não receberam",
  calados: "todos os calados",
  saiu_nao_avisado: "quem saiu e não foi avisado",
  saiu_todos: "todos que saíram",
};

const PADRAO: Record<TipoLote, PublicoLote> = { convocacao: "nao_receberam", ingame: "confirmou_nao_recebeu", intencao: "calados_nao_receberam", desescalado: "saiu_nao_avisado" };
export const publicoOk = (v: unknown, tipo: TipoLote): PublicoLote =>
  (typeof v === "string" && v in ROTULO_PUBLICO ? (v as PublicoLote) : PADRAO[tipo]);

/**
 * Quem recebe. "Não recebeu" é medido pelo HISTÓRICO de lotes deste evento (um alvo com status
 * 'ok' do mesmo tipo), e não por um carimbo na escalação: `convidado_em` só existe pra convocação,
 * e a cobrança in-game precisava da mesma conta. Pra convocação o carimbo entra junto, porque as
 * DMs disparadas antes do sistema de lotes existir só aparecem lá.
 */
async function alvosDoTipo(tipo: TipoLote, eventoId: number, publico: PublicoLote): Promise<Alvo[]> {
  const naoRecebeu = sql`
    AND NOT EXISTS (SELECT 1 FROM dm_lote_alvo a JOIN dm_lote l ON l.id = a.lote_id
                    WHERE l.evento_id = ${eventoId} AND l.tipo = ${tipo} AND a.chave = e.chave AND a.status = 'ok')`;

  /**
   * LEMBRETE DE INTENÇÃO — os únicos alvos que NÃO saem da escalação: a chamada ainda está aberta e
   * ninguém foi escalado. A base é o elenco esperado (o mesmo `listElencoEsperado` que alimenta os
   * "não decididos" da mensagem), menos quem já respondeu qualquer coisa.
   *
   * Só entra quem tem Discord vinculado: sem isso não há pra onde mandar, e a linha viraria uma
   * falha garantida no relatório todo santo dia.
   */
  if (tipo === "intencao") {
    // a chave é calculada em JS, com o MESMO `chaveNome` do resto do app. Reescrever a normalização
    // de acentos em SQL criaria duas definições de identidade — e a divergência só apareceria no dia
    // em que alguém com acento no nome recebesse DM à toa
    const [elenco, responderam, receberam] = (await Promise.all([
      sql`SELECT p.nome_familia AS familia, p.discord_id AS user_id
          FROM players p
          WHERE p.ativo AND p.discord_id IS NOT NULL
            AND (p.registro OR EXISTS (SELECT 1 FROM player_funcao pf WHERE pf.familia = p.nome_familia))
          ORDER BY p.nome_familia`,
      sql`SELECT ir.chave FROM intencao_resp ir JOIN intencao_post ip ON ip.message_id = ir.message_id
          WHERE ip.evento_id = ${eventoId}`,
      sql`SELECT a.chave FROM dm_lote_alvo a JOIN dm_lote l ON l.id = a.lote_id
          WHERE l.evento_id = ${eventoId} AND l.tipo = 'intencao' AND a.status = 'ok'`,
    ])) as [{ familia: string; user_id: string }[], { chave: string }[], { chave: string }[]];

    const jaRespondeu = new Set(responderam.map((r) => r.chave));
    const jaRecebeu = new Set(receberam.map((r) => r.chave));
    return elenco
      .map((p) => ({ chave: chaveNome(p.familia), familia: p.familia, user_id: p.user_id, party: null }))
      .filter((a) => !jaRespondeu.has(a.chave) && (publico === "calados" || !jaRecebeu.has(a.chave)));
  }

  if (tipo === "convocacao") {
    const filtro = publico === "todos" ? sql``
      : publico === "sem_resposta" ? sql`AND e.confirmou IS NULL`
      // "não recebeu" mora em lib/desescalado.ts porque a TELA conta o mesmo número (ver alvosConv)
      : sql`AND ${SEM_CONVITE_VALIDO}`;
    return (await sql`
      SELECT e.chave, e.familia, e.user_id, p.nome AS party
      FROM evento_escalacao e
      LEFT JOIN party p ON p.id = e.party_id
      WHERE e.evento_id = ${eventoId} AND e.party_id IS NOT NULL
        ${filtro}
      ORDER BY e.familia`) as Alvo[];
  }

  /**
   * SAÍDA DA ESCALAÇÃO — o inverso de todos os outros: o único público que NÃO tem `party_id IS NOT
   * NULL`. São exatamente os que estão FORA agora depois de terem sido chamados pra dentro (a regra
   * inteira, com os porquês, mora em lib/desescalado.ts — a mesma que pinta o card de amarelo).
   *
   * `party` vai NULL de propósito: a DM não diz PT nenhuma. Ele não tem mais uma.
   */
  if (tipo === "desescalado") {
    const filtro = publico === "saiu_todos" ? sql`AND ${SAIU}` : sql`AND ${SAIU} AND NOT ${JA_AVISADO}`;
    return (await sql`
      SELECT e.chave, e.familia, e.user_id, NULL::text AS party
      FROM evento_escalacao e
      WHERE e.evento_id = ${eventoId} ${filtro}
      ORDER BY e.familia`) as Alvo[];
  }

  // in-game: quem recusou a convocação nunca entra — ele já avisou que não vem
  const filtro = publico === "faltam_ingame"
    ? sql`AND e.confirmou IS NOT FALSE
          AND NOT EXISTS (SELECT 1 FROM evento_presenca ep
                          WHERE ep.evento_id = e.evento_id AND ep.chave = e.chave AND ep.participar)`
    : publico === "confirmou" ? sql`AND e.confirmou IS TRUE`
    : sql`AND e.confirmou IS TRUE ${naoRecebeu}`;
  return (await sql`
    SELECT e.chave, e.familia, e.user_id, p.nome AS party
    FROM evento_escalacao e
    LEFT JOIN party p ON p.id = e.party_id
    WHERE e.evento_id = ${eventoId} AND e.party_id IS NOT NULL
      ${filtro}
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

/**
 * Abre o lote: resolve os alvos e grava um por linha, todos pendentes.
 *
 * Se já existe um lote NÃO concluído do mesmo tipo neste evento, ele é RETOMADO em vez de um novo
 * ser criado. É o que faz "clicar de novo" depois de um erro de rede continuar de onde parou — sem
 * isso, um lote que morreu no meio viraria um segundo lote com a lista inteira, e quem já tinha
 * recebido a DM receberia outra.
 */
export async function criarLoteDM(o: { tipo: TipoLote; eventoId: number; publico?: unknown; porQuem?: string | null }):
  Promise<{ ok: boolean; erro?: string; loteId?: number; total?: number; retomado?: boolean; publico?: PublicoLote }> {
  if (!botConfigurado()) return { ok: false, erro: "bot não configurado" };
  const publico = publicoOk(o.publico, o.tipo);

  // a retomada exige o MESMO público: reaproveitar um lote de outra audiência ignoraria em silêncio
  // o que a staff escolheu na tela
  const aberto = (await sql`
    SELECT l.id::int AS id, l.total::int AS total,
           (SELECT count(*)::int FROM dm_lote_alvo a WHERE a.lote_id = l.id AND a.status NOT IN ('ok','falha')) AS pendentes
    FROM dm_lote l
    WHERE l.evento_id = ${o.eventoId} AND l.tipo = ${o.tipo} AND l.status <> 'concluido'
      AND COALESCE(l.publico, '') = ${publico}
    ORDER BY l.criado DESC LIMIT 1`) as { id: number; total: number; pendentes: number }[];
  if (aberto[0]?.pendentes) return { ok: true, loteId: aberto[0].id, total: aberto[0].total, retomado: true, publico };

  const titulo = await tituloDoEvento(o.eventoId);
  await resolverUserIds(o.eventoId);
  const alvos = await alvosDoTipo(o.tipo, o.eventoId, publico);
  if (!alvos.length) return { ok: false, erro: `ninguém em "${ROTULO_PUBLICO[publico]}" — nada a enviar` };

  const rows = (await sql`
    INSERT INTO dm_lote (tipo, evento_id, titulo, criado_por, total, publico)
    VALUES (${o.tipo}, ${o.eventoId}, ${titulo}, ${o.porQuem ?? null}, ${alvos.length}, ${publico})
    RETURNING id::int AS id`) as { id: number }[];
  const loteId = rows[0].id;
  for (const a of alvos) {
    await sql`INSERT INTO dm_lote_alvo (lote_id, chave, familia, user_id, party)
      VALUES (${loteId}, ${a.chave}, ${a.familia}, ${a.user_id}, ${a.party})
      ON CONFLICT (lote_id, chave) DO NOTHING`;
  }
  return { ok: true, loteId, total: alvos.length, publico };
}

/** O corpo da DM, por tipo. Convocar tem botões (a resposta volta pro banco); cobrar in-game não —
 *  o site não tem como saber que a pessoa marcou no jogo, e um botão aqui fingiria resolver. */
function montarDM(tipo: TipoLote, eventoId: number, titulo: string, party: string | null, link: string | null, servidor: string | null = null): Record<string, unknown> {
  if (tipo === "intencao") {
    return {
      allowed_mentions: { parse: [] },
      embeds: [{
        title: `⏳ Você ainda não respondeu — ${titulo}`.slice(0, 256),
        description: "A chamada está aberta e a sua resposta ainda não chegou. Marque a função que você pretende jogar, ou diga que não vai — as duas ajudam: a staff monta a escalação com o que sabe, e quem não responde fica de fora dela."
          + (link ? `\n\n**[→ Abrir a chamada e marcar](${link})**` : "\n\nA chamada está no canal de sempre."),
        color: 0xd6b22a,
      }],
      // botão-link em vez de custom_id: quem responde é a MENSAGEM do canal, e um botão aqui teria
      // que duplicar toda a lógica de função/cargo/registro que já vive lá
      ...(link ? { components: [{ type: 1, components: [{ type: 2, style: 5, label: "Ir para a chamada", url: link }] }] } : {}),
    };
  }
  /**
   * O AVISO DE SAÍDA. Sem botões: não há o que responder — é um comunicado, e um botão aqui fingiria
   * que a decisão ainda está em aberto. O pedido concreto (tirar o participar dentro do jogo) vem
   * antes do motivo, porque é o que precisa ser FEITO; o motivo é contexto.
   *
   * A lista de motivos é genérica de propósito, palavra por palavra como a staff pediu: a DM sai em
   * lote pra várias pessoas de uma vez, e escrever um motivo específico exigiria uma mensagem por
   * pessoa — o que ninguém faria, e o campo acabaria mentindo pra todos.
   */
  if (tipo === "desescalado") {
    return {
      allowed_mentions: { parse: [] },
      embeds: [{
        title: `⇄ Você não está mais escalado — ${titulo}`.slice(0, 256),
        description: [
          "Você **NÃO** está mais escalado! Retirar o *participar* dentro do jogo.",
          "",
          "Motivo: Demora pra responder a escalação, desistência própria, adequação de comp, erro na chamada, etc...",
        ].join("\n"),
        color: 0xd6b22a,
      }],
    };
  }
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
  // in-game: o SERVIDOR vem antes da instrução, porque é o dado que falta pra pessoa agir — "abra o
  // jogo e marque participar" sem dizer ONDE deixa a pessoa adivinhando. Sem padrão configurado nem
  // override, a linha some inteira em vez de sair "Servidor: —".
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `🎮 Marque participar in-game — ${titulo}`.slice(0, 256),
      description: `Você está escalado${party ? ` na **${party}**` : ""}, mas ainda não apareceu na lista de participantes do jogo.`
        + (servidor ? `\n\n🌐 Servidor da guerra: **${servidor}**` : "")
        + "\n\nAbra o Black Desert e marque **participar** na guerra. Quem não marca não entra na conta.",
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
  id: number; tipo: TipoLote; rotulo: string; publico: string | null; criadoPor: string | null;
  criado: string; concluido: string | null; status: string;
  total: number; enviados: number; falhas: number; pendentes: number;
  logOk: boolean | null; logErro: string | null;
  alvos: AlvoLote[];
};

type LoteRow = {
  id: number; tipo: TipoLote; publico: string | null; criado_por: string | null; status: string; total: number;
  criado: string; concluido: string | null; log_ok: boolean | null; log_erro: string | null;
  enviados: number; falhas: number; pendentes: number;
};
const montar = (l: LoteRow, alvos: AlvoLote[]): LoteResumo => ({
  id: l.id, tipo: l.tipo, rotulo: ROTULO[l.tipo] ?? l.tipo, criadoPor: l.criado_por,
  publico: l.publico ? ROTULO_PUBLICO[l.publico as PublicoLote] ?? l.publico : null,
  criado: l.criado, concluido: l.concluido, status: l.status,
  total: l.total, enviados: l.enviados, falhas: l.falhas, pendentes: l.pendentes,
  logOk: l.log_ok, logErro: l.log_erro, alvos,
});

export async function historicoLotes(eventoId: number, o: { comAlvos?: boolean } = {}): Promise<LoteResumo[]> {
  const lotes = (await sql`
    SELECT l.id::int AS id, l.tipo, l.publico, l.criado_por, l.status, l.total::int AS total,
           l.criado::text AS criado, l.concluido::text AS concluido, l.log_ok, l.log_erro,
           count(a.*) FILTER (WHERE a.status = 'ok')::int AS enviados,
           count(a.*) FILTER (WHERE a.status = 'falha')::int AS falhas,
           count(a.*) FILTER (WHERE a.status NOT IN ('ok', 'falha'))::int AS pendentes
    FROM dm_lote l LEFT JOIN dm_lote_alvo a ON a.lote_id = l.id
    WHERE l.evento_id = ${eventoId}
    GROUP BY l.id ORDER BY l.criado DESC`) as {
      id: number; tipo: TipoLote; publico: string | null; criado_por: string | null; status: string; total: number;
      criado: string; concluido: string | null; log_ok: boolean | null; log_erro: string | null;
      enviados: number; falhas: number; pendentes: number;
    }[];
  if (!lotes.length) return [];

  // quem só quer o PLACAR (o resumo do evento) para aqui: a lista nominal de todos os alvos de
  // todos os lotes são centenas de linhas indo pro cliente sem ninguém usar
  if (o.comAlvos === false) return lotes.map((l) => montar(l, []));

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

  return lotes.map((l) => montar(l, porLote.get(l.id) ?? []));
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
export async function processarLoteDM(loteId: number, tamanho = 5, msLimite = 15000): Promise<ProgressoLote> {
  const t0 = Date.now();
  const lotes = (await sql`SELECT id::int AS id, tipo, evento_id::int AS evento_id, titulo, criado_por, status FROM dm_lote WHERE id = ${loteId}`) as
    { id: number; tipo: TipoLote; evento_id: number; titulo: string; criado_por: string | null; status: string }[];
  const lote = lotes[0];
  if (!lote) return { ok: false, erro: "lote não encontrado", loteId, tipo: "convocacao", titulo: "", total: 0, enviados: 0, falhas: 0, pendentes: 0, concluido: true, falhasDetalhe: [] };

  // recupera alvo preso em 'enviando' de um lote que morreu no meio — um lote dura poucos segundos,
  // então 2 minutos parado é órfão, e sem isto o envio nunca fecharia
  await sql`UPDATE dm_lote_alvo SET status = 'pendente' WHERE lote_id = ${loteId} AND status = 'enviando' AND (tentado IS NULL OR tentado < now() - interval '2 minutes')`;
  // link direto pra mensagem da chamada — é o que faz o lembrete ser acionável em vez de recado
  const link = lote.tipo === "intencao" ? await linkDaChamada(lote.evento_id) : null;
  // SERVIDOR da guerra — sem ele o pedido de marcar in-game manda a pessoa abrir o jogo e adivinhar
  // pra onde ir. Lido uma vez por lote, e não por destinatário. Só o pedido de in-game precisa.
  const servidor = lote.tipo === "ingame" ? textoServidores(await servidoresDoEvento(lote.evento_id)) : null;

  /**
   * QUEM JÁ VOLTOU PRA UMA PT não pode receber "você não está mais escalado".
   *
   * O lote resolve os alvos na hora em que é aberto, e o envio é fatiado — entre abrir e a última
   * fatia sair cabe a staff mudar de ideia e arrastar a pessoa de volta. Nos outros tipos isso rende
   * uma DM redundante; aqui renderia uma MENTIRA, e da pior espécie: a pessoa vai lá e tira o
   * participar de uma guerra em que está escalada. Relido a cada fatia, e não uma vez por lote.
   */
  const voltaram = lote.tipo === "desescalado"
    ? new Set(((await sql`SELECT chave FROM evento_escalacao
                          WHERE evento_id = ${lote.evento_id} AND party_id IS NOT NULL`) as { chave: string }[]).map((r) => r.chave))
    : null;

  const pend = (await sql`
    UPDATE dm_lote_alvo SET status = 'enviando', tentado = now()
    WHERE id IN (SELECT id FROM dm_lote_alvo WHERE lote_id = ${loteId} AND status = 'pendente' ORDER BY id LIMIT ${tamanho} FOR UPDATE SKIP LOCKED)
    RETURNING id::int AS id, chave, familia, user_id, party`) as { id: number; chave: string; familia: string; user_id: string | null; party: string | null }[];

  // ORÇAMENTO DE TEMPO: o Discord limita a criação de DM com força, e `botFetch` espera o
  // retry-after de um 429 — com azar, poucos destinatários consomem a requisição inteira e o
  // gateway devolve 504 sem ter enviado nada. Passado o orçamento, o que sobrou volta pra fila e a
  // tela chama de novo; o progresso já gravado permanece.
  const devolver: number[] = [];
  for (const a of pend) {
    if (Date.now() - t0 > msLimite) { devolver.push(a.id); continue; }
    let erro: string | null = null;
    // ONDE a mensagem foi parar. Guardado porque uma DM disparada precisa poder ser DESDITA: quem é
    // reescalado depois do aviso de saída tem essa mensagem editada em vez de ficar com um recado
    // que manda sair de uma guerra em que ele está (ver lib/retratarSaida.ts).
    let canal: string | null = null, mensagem: string | null = null;
    if (voltaram?.has(a.chave)) erro = "voltou pra escalação antes do envio";
    else if (!a.user_id) erro = SEM_DISCORD;
    else {
      try {
        const dm = await botFetch(`/users/@me/channels`, { method: "POST", body: JSON.stringify({ recipient_id: a.user_id }) }, 2);
        if (!dm.ok) erro = await motivoDaFalha(dm, "abrir");
        else {
          const ch = (await dm.json()) as { id: string };
          const res = await botFetch(`/channels/${ch.id}/messages`, { method: "POST", body: JSON.stringify(montarDM(lote.tipo, lote.evento_id, lote.titulo, a.party, link, servidor)) }, 2);
          if (!res.ok) erro = await motivoDaFalha(res, "enviar");
          else {
            canal = ch.id;
            // corpo ilegível não invalida o envio: a DM SAIU. Perde-se só a chance de editá-la
            try { mensagem = ((await res.json()) as { id?: string })?.id ?? null; } catch { mensagem = null; }
          }
        }
      } catch (e) { erro = (e as Error).message; }
    }
    await sql`UPDATE dm_lote_alvo SET status = ${erro ? "falha" : "ok"}, erro = ${erro}, tentado = now(),
                                      dm_channel_id = ${canal}, dm_message_id = ${mensagem}
              WHERE id = ${a.id}`;
    // o carimbo de convocado é o que a tela usa pra separar "não chamado" de "chamado e calado"
    if (!erro && lote.tipo === "convocacao") {
      await sql`UPDATE evento_escalacao SET convidado_em = now() WHERE evento_id = ${lote.evento_id} AND chave = ${a.chave}`;
    }
    await new Promise((r) => setTimeout(r, 150)); // respiro entre DMs, como no Buzinador: 429 em rajada custa mais
  }
  // devolve na hora o que não deu tempo — sem isso ficariam 2 minutos presos em 'enviando'
  if (devolver.length) await sql`UPDATE dm_lote_alvo SET status = 'pendente' WHERE id = ANY(${devolver as unknown as number[]})`;

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
