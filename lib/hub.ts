import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import { faltasPorChave, type Falta } from "@/lib/faltas";
import type { Tier } from "@/lib/tier";

/**
 * Agregações do HUB — o funil de um evento e o resumo de uma série.
 *
 * O funil tem quatro degraus, e a graça está justamente na queda entre eles:
 *   marcaram → escalados → confirmaram in-game → presença oficial (estatística da war).
 * "Marcou e não jogou" é a diferença entre o 1º e o 4º; quem confirmou in-game e mesmo assim não
 * tem estatística é um caso mais grave, porque prometeu duas vezes.
 */
/** De onde o evento nasceu. Muda o que a tela pode oferecer — sem chamada não há mensagem pra
 *  sincronizar, e o pool da escalação vira o elenco em vez de "quem marcou". */
export type OrigemEvento = "chamada" | "legado" | "manual";

export type FunilEvento = {
  eventoId: number; uuid: string; titulo: string; tipo: string; tier: Tier | null; data: string; status: string;
  marcaram: number | null; // null = não houve chamada nenhuma: o degrau não existe, e 0 mentiria
  naoVao: number | null;
  escalados: number; confirmaram: number; jogaram: number;
  aceitaram: number; recusaram: number;
  pendentes: number;    // escalados que ainda não responderam a DM
  temWar: boolean;      // false → "presença oficial" ainda é desconhecida, não zero
  chamadaAberta: boolean; // ainda dá pra marcar no Discord
  resultado: string | null;
  origem: OrigemEvento;
  presetId: number | null; presetNome: string | null; // qual chamada rege as PTs deste evento
};

/**
 * Um evento por linha, do mais recente pro mais antigo — TODOS eles, não só os que tiveram chamada
 * do bot novo. Partir de `intencao_post` escondia do hub o evento criado à mão e o do bot antigo,
 * que é justamente o que o hub deveria estar mostrando: o último evento, veio de onde vier.
 *
 * Os dois LATERAL pegam o post mais recente de cada bot (nada impede um evento ter mais de um post;
 * sem o LIMIT 1 a linha do evento duplicaria). `marcaram`/`naoVao` somam os dois porque na prática
 * são excludentes — um evento nasce de um bot só — e somar dispensa um CASE que mentiria se um dia
 * deixassem de ser. Sem post NENHUM os dois viram NULL, não 0: "ninguém marcou" e "não houve onde
 * marcar" são coisas diferentes, e a tela precisa saber qual é qual.
 *
 * A ordem termina em `e.id DESC` de propósito: sem desempate, dois eventos criados no mesmo
 * instante trocam de lugar entre um render e outro, e o "último evento" do topo piscaria.
 */
export async function funilEventos(limite = 24): Promise<FunilEvento[]> {
  return (await sql`
    SELECT
      e.id::int AS "eventoId", e.uuid, COALESCE(e.titulo, e.tipo) AS titulo, e.tipo,
      e.tier, e.data::text AS data, e.status, r.resultado,
      (r.war_id IS NOT NULL) AS "temWar",
      -- "dá pra marcar agora": tem mensagem no canal E o evento ainda aceita clique. Sem o status
      -- o selo ficava aceso pra sempre, contradizendo o 🔒 finalizado na mesma linha.
      (p.message_id IS NOT NULL AND e.status = 'aberto') AS "chamadaAberta",
      CASE WHEN p.message_id IS NOT NULL THEN 'chamada'
           WHEN q.message_id IS NOT NULL THEN 'legado'
           ELSE 'manual' END AS origem,
      CASE WHEN p.message_id IS NULL AND q.message_id IS NULL THEN NULL ELSE
        COALESCE((SELECT count(*)::int FROM intencao_resp ir WHERE ir.message_id = p.message_id AND ir.resposta = 'vai'), 0)
          + COALESCE((SELECT count(*)::int FROM participacao_resp pr2 WHERE pr2.war_key = q.message_id AND pr2.resposta = 'can'), 0) END AS marcaram,
      CASE WHEN p.message_id IS NULL AND q.message_id IS NULL THEN NULL ELSE
        COALESCE((SELECT count(*)::int FROM intencao_resp ir WHERE ir.message_id = p.message_id AND ir.resposta = 'nao'), 0)
          + COALESCE((SELECT count(*)::int FROM participacao_resp pr2 WHERE pr2.war_key = q.message_id AND pr2.resposta = 'cant'), 0) END AS "naoVao",
      (SELECT count(*)::int FROM evento_escalacao es WHERE es.evento_id = e.id AND es.party_id IS NOT NULL) AS escalados,
      (SELECT count(*)::int FROM evento_escalacao es WHERE es.evento_id = e.id AND es.confirmou IS TRUE) AS aceitaram,
      (SELECT count(*)::int FROM evento_escalacao es WHERE es.evento_id = e.id AND es.confirmou IS FALSE) AS recusaram,
      -- pendente sai do mesmo recorte de escalados: quem recusa perde a PT, então subtrair
      -- recusaram de escalados no front descontava a mesma pessoa duas vezes
      (SELECT count(*)::int FROM evento_escalacao es WHERE es.evento_id = e.id AND es.party_id IS NOT NULL AND es.confirmou IS NULL) AS pendentes,
      (SELECT count(*)::int FROM evento_presenca ep WHERE ep.evento_id = e.id AND ep.participar) AS confirmaram,
      COALESCE((SELECT count(DISTINCT d.nome_familia)::int FROM desempenho d WHERE d.war_id = r.war_id), 0) AS jogaram,
      COALESCE(p.preset_id, e.preset_id)::int AS "presetId", pr.nome AS "presetNome"
    FROM evento e
    LEFT JOIN LATERAL (SELECT ip.message_id, ip.preset_id FROM intencao_post ip
                       WHERE ip.evento_id = e.id ORDER BY ip.criado DESC LIMIT 1) p ON TRUE
    LEFT JOIN LATERAL (SELECT pp.message_id FROM participacao_post pp
                       WHERE pp.evento_id = e.id ORDER BY pp.criado DESC LIMIT 1) q ON TRUE
    LEFT JOIN intencao_preset pr ON pr.id = COALESCE(p.preset_id, e.preset_id)
    LEFT JOIN evento_resultado r ON r.evento_id = e.id
    ORDER BY e.data DESC, e.criado DESC, e.id DESC
    LIMIT ${limite}`) as FunilEvento[];
}

export type LinhaSerie = { chave: string; familia: string } & Falta;

/**
 * Resumo da série: uma linha por jogador com o funil acumulado, ordenado por quem mais deve —
 * primeiro a sequência de faltas, depois o total de faltas. Só entra quem tem algo a mostrar.
 */
export async function resumoSerie(limite = 12): Promise<LinhaSerie[]> {
  const faltas = await faltasPorChave(limite);
  if (!faltas.size) return [];
  const nomes = (await sql`SELECT nome_familia FROM players`) as { nome_familia: string }[];
  const nomePorChave = new Map(nomes.map((n) => [chaveNome(n.nome_familia), n.nome_familia]));
  return [...faltas.entries()]
    .map(([chave, f]) => ({ chave, familia: nomePorChave.get(chave) ?? chave, ...f }))
    .filter((l) => l.marcou > 0 || l.jogou > 0)
    .sort((a, b) => b.sequencia - a.sequencia || (b.marcou - b.jogou) - (a.marcou - a.jogou) || a.familia.localeCompare(b.familia));
}

/** Totais do topo do hub. `avaliaveis` = eventos com estatística gravada (os que dão pra julgar). */
export async function totaisHub(): Promise<{ eventos: number; avaliaveis: number; funcoes: number; parties: number; lendarios: number }> {
  const rows = (await sql`SELECT
    (SELECT count(*)::int FROM evento) AS eventos,
    (SELECT count(*)::int FROM evento_resultado WHERE war_id IS NOT NULL) AS avaliaveis,
    (SELECT count(*)::int FROM funcao) AS funcoes,
    (SELECT count(*)::int FROM party) AS parties,
    (SELECT count(*)::int FROM players WHERE lendario) AS lendarios`) as { eventos: number; avaliaveis: number; funcoes: number; parties: number; lendarios: number }[];
  return rows[0];
}
