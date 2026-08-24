import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import { SAIU, JA_AVISADO, SEM_CONVITE_VALIDO } from "@/lib/desescalado";

/**
 * Escalação final do evento: quem joga e em QUAL PT. É aqui que a intenção múltipla do bot
 * (a pessoa pode marcar 3 PTs) vira decisão — por isso a PK é (evento_id, chave): uma PT só
 * por pessoa no time que entra em campo.
 *
 * Gravação por DELTA (uma op por linha), como em lib/remocaoStatus.ts: duas pessoas montando a
 * escalação ao mesmo tempo não sobrescrevem o trabalho uma da outra.
 */
export type EscalacaoRow = { chave: string; familia: string; party_id: number | null; ordem_pt: number | null; confirmou: boolean | null; convidado_em: string | null; respondeu_em: string | null;
  /** convocado e DEPOIS tirado da PT — ver lib/desescalado.ts */
  saiu: boolean; saiu_avisado: boolean;
  /** escalado e sem convocação válida em pé (é o público "quem ainda não recebeu") */
  precisa_convite: boolean };
export type EscalacaoOp = { familia: string; partyId?: number | null };

export async function getEscalacao(eventoId: number): Promise<EscalacaoRow[]> {
  return (await sql`SELECT e.chave, e.familia, e.party_id::int AS party_id, e.ordem_pt::int AS ordem_pt, e.confirmou,
                           e.convidado_em::text AS convidado_em, e.respondeu_em::text AS respondeu_em,
                           ${SAIU} AS saiu, ${JA_AVISADO} AS saiu_avisado,
                           ${SEM_CONVITE_VALIDO} AS precisa_convite
                    FROM evento_escalacao e WHERE e.evento_id = ${eventoId}
                    ORDER BY e.party_id NULLS LAST, e.ordem_pt NULLS LAST, e.familia`) as EscalacaoRow[];
}

/**
 * Aplica um lote de deltas. `partyId` numérico = escala naquela PT (move, se já estava em outra);
 * `null`/ausente = tira da escalação. Ignora linha sem família válida.
 */
export async function aplicarEscalacao(eventoId: number, ops: unknown): Promise<EscalacaoRow[]> {
  const lista = Array.isArray(ops) ? ops : [];
  for (const o of lista) {
    const r = (o ?? {}) as { familia?: unknown; partyId?: unknown };
    const familia = typeof r.familia === "string" ? r.familia.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    const chave = chaveNome(familia);
    if (!chave) continue;
    const pid = r.partyId === null || r.partyId === undefined || r.partyId === "" ? null : Math.trunc(Number(r.partyId));
    if (pid == null || !Number.isFinite(pid)) {
      /**
       * TIRAR DA PT NÃO APAGA HISTÓRIA.
       *
       * Antes isto era um DELETE seco, e o efeito colateral era grave: arrastar pro pool alguém que
       * tinha RECUSADO apagava a recusa junto — o status sumia sem ninguém apertar o botão de
       * desfazer, e com ele iam também o convidado_em e o respondeu_em. Some a auditoria ("por que
       * fulano não saiu?") e o próximo disparo de "quem ainda não recebeu" manda DM repetida pra
       * quem já tinha recebido.
       *
       * A regra agora separa os dois casos pelo que existe pra perder:
       *   sem história (nunca convocado, nunca respondeu) -> DELETE, que é o que sempre foi: a linha
       *      era só "está nesta PT", e fora da PT ela não diz nada;
       *   com história -> fica, com party_id e ordem_pt nulos. Quem recusou continua no grupo rubro
       *      até alguém desfazer no ↺, que é o caminho explícito.
       *
       * Nenhuma contagem quebra: todo lugar que quer dizer "escalado" já filtra por
       * `party_id IS NOT NULL` (historicoSemana, hub, resumo, loteDM, publicarLista).
       */
      await sql`DELETE FROM evento_escalacao
                WHERE evento_id = ${eventoId} AND chave = ${chave}
                  AND confirmou IS NULL AND convidado_em IS NULL`;
      /**
       * `saiu_em` = a assinatura da staff no corte. É o único lugar do app que escreve esse carimbo,
       * e é o que distingue "a staff tirou" de "saiu porque recusou" (a recusa nula o `party_id` em
       * lib/convocacao.ts sem passar por aqui) e de "foi movido de PT" (esse continua com PT).
       * Sem um fato registrado, a leitura teria que adivinhar por comparação de carimbos — e adivinha
       * errado, que foi como o ↺ de desfazer recusa acabava mandando gente pra fila do aviso.
       */
      await sql`UPDATE evento_escalacao SET party_id = NULL, ordem_pt = NULL, saiu_em = now(), atualizado = now()
                WHERE evento_id = ${eventoId} AND chave = ${chave}`;
      continue;
    }
    // entra no FIM da PT. Se já estava nela, mantém a posição — arrastar de volta pro mesmo lugar
    // não pode reordenar sozinho; quem reordena é o reordenarParty.
    await sql`INSERT INTO evento_escalacao (evento_id, chave, familia, party_id, ordem_pt, atualizado)
      VALUES (${eventoId}, ${chave}, ${familia}, ${pid},
              COALESCE((SELECT max(ordem_pt) + 1 FROM evento_escalacao WHERE evento_id = ${eventoId} AND party_id = ${pid}), 0), now())
      ON CONFLICT (evento_id, chave) DO UPDATE SET familia = EXCLUDED.familia, party_id = EXCLUDED.party_id,
        ordem_pt = CASE WHEN evento_escalacao.party_id IS DISTINCT FROM EXCLUDED.party_id THEN EXCLUDED.ordem_pt ELSE evento_escalacao.ordem_pt END,
        -- voltou pra uma PT: o corte anterior deixou de valer, e o estado de saída morre aqui
        saiu_em = NULL,
        atualizado = now()`;
    /**
     * REESCALADO DEPOIS DE TER SIDO AVISADO QUE SAIU: o funil dele volta à estaca zero.
     *
     * Sem isto o aviso vira uma armadilha silenciosa. A pessoa recebeu "você NÃO está mais
     * escalado, tire o participar"; a staff muda de ideia e a arrasta de volta — e ela não fica
     * sabendo, porque `convidado_em` continua carimbado do convite ANTIGO e o disparo de "quem
     * ainda não recebeu" a pula. Ela ficaria de fora do jogo obedecendo a última coisa que leu.
     *
     * Zerar convite e resposta a devolve pra fila de convocação, com o card mostrando ✉ ("ainda não
     * foi convocado") — que é a verdade depois do aviso. A auditoria não se perde: as duas DMs
     * continuam no histórico de chamadas do evento, com hora.
     *
     * A âncora é `a.tentado >= e.convidado_em` (e não o `atualizado`, que a linha de cima acabou de
     * carimbar com now()): o que interessa é se a ÚLTIMA coisa que ele recebeu foi o aviso de saída.
     */
    await sql`UPDATE evento_escalacao e
              SET convidado_em = NULL, confirmou = NULL, respondeu_em = NULL
              WHERE e.evento_id = ${eventoId} AND e.chave = ${chave} AND e.party_id IS NOT NULL
                AND ${JA_AVISADO}`;
  }
  return getEscalacao(eventoId);
}

/**
 * Regrava a ordem de UMA party. Recebe as chaves na ordem final — posição 0 é o líder.
 *
 * Só mexe em quem está naquela party: mandar uma chave de outra PT (ou inexistente) não pode
 * arrastá-la pra cá por engano, então o WHERE prende os dois lados.
 */
export async function reordenarParty(eventoId: number, partyId: unknown, chaves: unknown): Promise<EscalacaoRow[]> {
  const pid = Math.trunc(Number(partyId));
  const lista = (Array.isArray(chaves) ? chaves : []).filter((x): x is string => typeof x === "string" && !!x).slice(0, 200);
  if (!Number.isFinite(pid) || !lista.length) return getEscalacao(eventoId);
  await sql`
    UPDATE evento_escalacao e SET ordem_pt = s.n, atualizado = now()
    FROM (SELECT chave, (ordinality - 1)::int AS n FROM unnest(${lista}::text[]) WITH ORDINALITY AS t(chave, ordinality)) s
    WHERE e.evento_id = ${eventoId} AND e.party_id = ${pid} AND e.chave = s.chave`;
  return getEscalacao(eventoId);
}

export async function limparEscalacao(eventoId: number): Promise<void> {
  await sql`DELETE FROM evento_escalacao WHERE evento_id = ${eventoId}`;
}
