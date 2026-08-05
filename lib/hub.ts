import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import { faltasPorChave, type Falta } from "@/lib/faltas";

/**
 * Agregações do HUB — o funil de um evento e o resumo de uma série.
 *
 * O funil tem quatro degraus, e a graça está justamente na queda entre eles:
 *   marcaram → escalados → confirmaram in-game → presença oficial (estatística da war).
 * "Marcou e não jogou" é a diferença entre o 1º e o 4º; quem confirmou in-game e mesmo assim não
 * tem estatística é um caso mais grave, porque prometeu duas vezes.
 */
export type FunilEvento = {
  eventoId: number; uuid: string; titulo: string; tipo: string; data: string; status: string;
  marcaram: number; escalados: number; confirmaram: number; jogaram: number;
  aceitaram: number; recusaram: number; naoVao: number;
  temWar: boolean;      // false → "presença oficial" ainda é desconhecida, não zero
  resultado: string | null;
  presetId: number | null; presetNome: string | null; // qual chamada gerou este evento
};

/** Um card por evento que teve chamada de intenção, do mais recente pro mais antigo. */
export async function funilEventos(limite = 24): Promise<FunilEvento[]> {
  return (await sql`
    SELECT
      e.id::int AS "eventoId", e.uuid, COALESCE(e.titulo, e.tipo) AS titulo, e.tipo,
      e.data::text AS data, e.status, r.resultado,
      (r.war_id IS NOT NULL) AS "temWar",
      (SELECT count(*)::int FROM intencao_resp ir WHERE ir.message_id = p.message_id AND ir.resposta = 'vai') AS marcaram,
      (SELECT count(*)::int FROM evento_escalacao es WHERE es.evento_id = e.id AND es.party_id IS NOT NULL) AS escalados,
      (SELECT count(*)::int FROM evento_escalacao es WHERE es.evento_id = e.id AND es.confirmou IS TRUE) AS aceitaram,
      (SELECT count(*)::int FROM evento_escalacao es WHERE es.evento_id = e.id AND es.confirmou IS FALSE) AS recusaram,
      (SELECT count(*)::int FROM intencao_resp ir WHERE ir.message_id = p.message_id AND ir.resposta = 'nao') AS naoVao,
      (SELECT count(*)::int FROM evento_presenca ep WHERE ep.evento_id = e.id AND ep.participar) AS confirmaram,
      COALESCE((SELECT count(DISTINCT d.nome_familia)::int FROM desempenho d WHERE d.war_id = r.war_id), 0) AS jogaram,
      p.preset_id::int AS "presetId", pr.nome AS "presetNome"
    FROM intencao_post p
    LEFT JOIN intencao_preset pr ON pr.id = p.preset_id
    JOIN evento e ON e.id = p.evento_id
    LEFT JOIN evento_resultado r ON r.evento_id = e.id
    ORDER BY e.data DESC, p.criado DESC
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
    (SELECT count(*)::int FROM intencao_post) AS eventos,
    (SELECT count(*)::int FROM intencao_post p JOIN evento_resultado r ON r.evento_id = p.evento_id WHERE r.war_id IS NOT NULL) AS avaliaveis,
    (SELECT count(*)::int FROM funcao) AS funcoes,
    (SELECT count(*)::int FROM party) AS parties,
    (SELECT count(*)::int FROM players WHERE lendario) AS lendarios`) as { eventos: number; avaliaveis: number; funcoes: number; parties: number; lendarios: number }[];
  return rows[0];
}
