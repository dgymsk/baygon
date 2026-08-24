import { sql } from "@/lib/db";

/**
 * SAIU DA ESCALAÇÃO — quem foi convocado e DEPOIS tirado da PT.
 *
 * É o estado que faltava nomear. Até aqui, arrastar alguém pra fora depois da convocação não
 * deixava marca nenhuma: o card voltava pro pool igualzinho ao de quem nunca foi chamado, e a
 * pessoa continuava com a DM no privado dizendo "você foi escalado, sua PT é X" e o *participar*
 * marcado dentro do jogo. Quem não é avisado não desmarca, e quem não desmarca entra na guerra
 * ocupando vaga de quem foi escalado no lugar dele.
 *
 * A REGRA, em quatro pedaços, cada um por um motivo:
 *   `party_id IS NULL`        — não está em PT nenhuma AGORA;
 *   `saiu_em IS NOT NULL`     — e a razão de não estar é que a STAFF O TIROU. Este carimbo é escrito
 *                               só pelo ramo de remoção de `aplicarEscalacao` e apagado ao voltar
 *                               pra uma PT: é fato registrado, não inferência;
 *   `convidado_em IS NOT NULL` e `saiu_em > convidado_em` — ele CHEGOU a ser avisado de que estava
 *                               dentro, ANTES de ser tirado. Sem a DM não há o que desmentir:
 *                               ninguém nunca lhe disse que estava escalado;
 *   `confirmou IS NOT FALSE`  — quem RECUSOU saiu por vontade própria e já tem o seu estado (nome
 *                               rubro, ✖). Mandar "você não está mais escalado" pra quem acabou de
 *                               dizer "não vou" é responder o óbvio.
 *
 * A PRIMEIRA VERSÃO DERIVAVA ISSO DE `atualizado`, e a derivação era ambígua: aquele carimbo é
 * escrito por qualquer arraste — escalar, mover de PT, tirar. Dois casos reais quebravam:
 *   - o ↺ que desfaz uma recusa (lib/convocacao.ts) zera `confirmou` e `respondeu_em` e NÃO devolve
 *     a PT; a linha ficava idêntica à de quem foi cortado, e quem tinha sido resgatado de um clique
 *     errado entrava na fila do aviso "você NÃO está mais escalado";
 *   - quem foi cortado e SÓ DEPOIS clicou "✅ Confirmo" na DM antiga apagava o próprio estado, e
 *     sumia justamente a pessoa que mais precisa do aviso: ela acha que vai jogar e está com o
 *     *participar* marcado.
 * Nenhuma comparação de carimbos resolve os dois, porque a informação que falta — QUEM tirou — não
 * estava em lugar nenhum. Agora está.
 *
 * Uma definição SÓ, aqui, porque ela é lida em dois lugares que precisam concordar: a tela (o card
 * amarelo) e o público do disparo (o botão). Duas cópias divergiriam no dia em que uma mudasse, e o
 * número no botão passaria a prometer um envio diferente do que sairia.
 *
 * Exige que a tabela `evento_escalacao` esteja com o alias `e` na consulta que interpola.
 */
export const SAIU = sql`(e.party_id IS NULL AND e.saiu_em IS NOT NULL AND e.convidado_em IS NOT NULL
   AND e.saiu_em > e.convidado_em AND e.confirmou IS NOT FALSE)`;

/**
 * Já recebeu o aviso de saída DEPOIS do último convite.
 *
 * A âncora é `convidado_em`, e não a simples existência de um aviso entregue, porque o ciclo pode
 * se repetir no mesmo evento: sai, é avisado, a staff o reescala (o que zera o funil dele, ver
 * lib/escalacao.ts), recebe convocação nova e sai de novo. Comparar contra o convite mais recente é
 * o que faz o segundo corte voltar a ser um aviso pendente em vez de ficar mudo pra sempre.
 */
export const JA_AVISADO = sql`EXISTS (
  SELECT 1 FROM dm_lote_alvo a JOIN dm_lote l ON l.id = a.lote_id
  WHERE l.evento_id = e.evento_id AND l.tipo = 'desescalado'
    AND a.chave = e.chave AND a.status = 'ok' AND a.tentado >= e.convidado_em)`;

/**
 * PRECISA DE CONVITE — está escalado e não tem convocação VÁLIDA em pé.
 *
 * Mora aqui, e não em lib/loteDM.ts, porque a segunda condição é filha desta feature: reescalar
 * alguém que foi avisado da saída zera o `convidado_em` dele (lib/escalacao.ts), mas o alvo 'ok' do
 * lote ANTIGO continua no histórico — e era ele, sozinho, que mantinha a pessoa fora de "quem ainda
 * não recebeu". O sintoma era mudo e completo: card mostrando ✉ ("ainda não foi convocado"), botão
 * de convocar em (0) e desabilitado, e a pessoa jamais recebendo convite nesse evento.
 *
 * A âncora `a.tentado >= e.atualizado` é "a DM saiu DEPOIS da última mexida da staff nesta linha".
 * Reescalar carimba `atualizado`, então o convite velho deixa de valer; e a DM antiga do sistema de
 * lotes (que gravou 'ok' sem carimbar `convidado_em`) continua valendo, que é pra isso que essa
 * checagem de histórico existe desde o começo.
 *
 * Exportada porque a TELA conta o mesmo número que o servidor vai disparar — ver `alvosConv` em
 * EventoBoard e o ramo `convocacao` de `alvosDoTipo`.
 */
export const SEM_CONVITE_VALIDO = sql`(e.convidado_em IS NULL AND NOT EXISTS (
  SELECT 1 FROM dm_lote_alvo a JOIN dm_lote l ON l.id = a.lote_id
  WHERE l.evento_id = e.evento_id AND l.tipo = 'convocacao'
    AND a.chave = e.chave AND a.status = 'ok' AND a.tentado >= e.atualizado))`;
