import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";

/**
 * MINI RESUMO de um jogador — o cartão que abre ao clicar no nome em /membros.
 *
 * A pergunta que ele responde é sempre a mesma, e é operacional: "posso contar com essa pessoa?".
 * Por isso ele mistura três coisas que hoje moram em telas diferentes — o cadastro (quem é), o
 * funil de participação (o que ela faz quando é chamada) e a presença de fato (se apareceu).
 *
 * Uma consulta por dimensão, todas por jogador (não é a lista inteira): o cartão abre sob demanda,
 * então o custo é de UM jogador por clique, não de 220 no carregamento da tabela.
 *
 * IDENTIDADE: `nome_familia` no cadastro e nas estatísticas, `chave` (chaveNome) no funil. As duas
 * andam juntas e são derivadas do mesmo nome — quem mistura as duas erra silenciosamente, então
 * cada consulta abaixo diz qual está usando.
 */
export type EventoDoPlayer = {
  eventoId: number;
  titulo: string;
  tipo: string;
  data: string;
  status: string;
  marcou: boolean;      // clicou numa função na chamada do bot
  escalado: boolean;    // a staff pôs numa PT
  confirmou: boolean | null; // resposta da DM: true aceitou, false recusou, null não respondeu
  ingame: boolean;      // apareceu na conferência in-game
  jogou: boolean | null; // tem estatística na war (null = a war não foi gravada)
};

export type PerfilPlayer = {
  nomeFamilia: string;
  chave: string;
  /** Quantos eventos ele aparece em cada estágio do funil, nos últimos N eventos. */
  funil: { eventos: number; marcou: number; escalado: number; aceitou: number; recusou: number; semResposta: number; ingame: number; jogou: number };
  wars: { comEstatistica: number; primeira: string | null; ultima: string | null };
  ultimos: EventoDoPlayer[];
};

const LIMITE_EVENTOS = 12;

export async function perfilPlayer(nomeFamilia: string, limite = LIMITE_EVENTOS): Promise<PerfilPlayer | null> {
  const nome = (nomeFamilia ?? "").trim();
  if (!nome) return null;
  const existe = (await sql`SELECT nome_familia FROM players WHERE nome_familia = ${nome}`) as { nome_familia: string }[];
  if (!existe[0]) return null;
  const chave = chaveNome(existe[0].nome_familia);

  /**
   * Os últimos N eventos, com o estágio do jogador em cada um.
   *
   * LEFT JOIN em tudo de propósito: o evento entra na lista mesmo que ele não tenha feito nada
   * nele — é justamente "foi chamado e não apareceu" que a staff precisa ver. Um INNER JOIN
   * mostraria só os eventos em que ele participou, que é o retrato mais bonito e menos útil.
   *
   * `jogou` é NULL quando a war não foi gravada: sem estatística ninguém faltou, e um "não jogou"
   * ali seria acusação inventada — a mesma regra do histórico da semana.
   */
  const ultimos = (await sql`
    SELECT e.id::int AS "eventoId", COALESCE(e.titulo, e.tipo) AS titulo, e.tipo,
           e.data::text AS data, e.status,
           (m.chave IS NOT NULL OR ir.chave IS NOT NULL) AS marcou,
           (esc.party_id IS NOT NULL) AS escalado,
           esc.confirmou,
           COALESCE(pr.participar, FALSE) AS ingame,
           CASE WHEN r.war_id IS NULL THEN NULL
                ELSE EXISTS (SELECT 1 FROM desempenho d WHERE d.war_id = r.war_id AND d.nome_familia = ${nome})
           END AS jogou
    FROM evento e
    LEFT JOIN evento_resultado r ON r.evento_id = e.id
    LEFT JOIN evento_escalacao esc ON esc.evento_id = e.id AND esc.chave = ${chave}
    LEFT JOIN evento_presenca  pr  ON pr.evento_id  = e.id AND pr.chave  = ${chave}
    LEFT JOIN LATERAL (
      SELECT im.chave FROM intencao_post ip JOIN intencao_marca im ON im.message_id = ip.message_id
      WHERE ip.evento_id = e.id AND im.chave = ${chave} LIMIT 1) m ON TRUE
    LEFT JOIN LATERAL (
      SELECT r2.chave FROM intencao_post ip JOIN intencao_resp r2 ON r2.message_id = ip.message_id
      WHERE ip.evento_id = e.id AND r2.chave = ${chave} AND r2.resposta = 'vai' LIMIT 1) ir ON TRUE
    ORDER BY e.data DESC, e.id DESC
    LIMIT ${limite}`) as EventoDoPlayer[];

  const wars = (await sql`
    SELECT count(DISTINCT d.war_id)::int AS "comEstatistica",
           min(w.data)::text AS primeira, max(w.data)::text AS ultima
    FROM desempenho d JOIN wars w ON w.war_id = d.war_id
    WHERE d.nome_familia = ${nome}`) as { comEstatistica: number; primeira: string | null; ultima: string | null }[];

  const funil = {
    eventos: ultimos.length,
    marcou: ultimos.filter((e) => e.marcou).length,
    escalado: ultimos.filter((e) => e.escalado).length,
    aceitou: ultimos.filter((e) => e.confirmou === true).length,
    recusou: ultimos.filter((e) => e.confirmou === false).length,
    semResposta: ultimos.filter((e) => e.escalado && e.confirmou == null).length,
    ingame: ultimos.filter((e) => e.ingame).length,
    jogou: ultimos.filter((e) => e.jogou === true).length,
  };

  return {
    nomeFamilia: existe[0].nome_familia,
    chave,
    funil,
    wars: wars[0] ?? { comEstatistica: 0, primeira: null, ultima: null },
    ultimos,
  };
}
