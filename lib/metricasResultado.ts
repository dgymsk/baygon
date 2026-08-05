/**
 * Catálogo (ORDEM CANÔNICA) das 15 métricas do print de resultado da war — a mesma ordem em que as
 * colunas aparecem na tela do jogo, da esquerda pra direita, depois de "Nome de Família" e "Classe".
 *
 * A ordem aqui não é cosmética: o cabeçalho do print é SÓ DE ÍCONES, sem uma palavra escrita, então
 * a leitura por visão não tem como casar coluna por nome — ela casa por POSIÇÃO. Mexer na ordem
 * desta lista desalinha a extração inteira.
 *
 * `formato` é a âncora que deixa conferir o alinhamento sem ler o cabeçalho: as duas ÚLTIMAS colunas
 * são as únicas em mm:ss e as três primeiras são inteiros pequenos — isso prende as duas pontas da
 * tabela, que é o que impede o deslize no meio (as 4 colunas de canhão/trap são quase sempre 0 e,
 * sozinhas, não dão referência nenhuma).
 *
 * Puro (sem imports de servidor) — usado no client (tabela de revisão), no lib de visão e nos
 * endpoints. `metrica` é a chave gravada em `desempenho` e referenciada por `grupos_metricas`:
 * NÃO renomear. `rotulo` é só exibição e segue o vocabulário da guilda.
 */
export type FormatoMetrica = "inteiro" | "abreviado" | "tempo";

export const METRICAS_RESULTADO: { metrica: string; rotulo: string; dica: string; formato: FormatoMetrica }[] = [
  { metrica: "kills",               rotulo: "Kills",         dica: "Kills",                                  formato: "inteiro" },
  { metrica: "mortes",              rotulo: "Mortes",        dica: "Mortes",                                 formato: "inteiro" },
  { metrica: "sequencia",           rotulo: "Multi Abate",   dica: "Multi Abate",                            formato: "inteiro" },
  { metrica: "dano_em_player",      rotulo: "Dano Causado",  dica: "Dano Causado",                           formato: "abreviado" },
  { metrica: "dano_recebido",       rotulo: "Dano Recebido", dica: "Dano Recebido",                          formato: "abreviado" },
  { metrica: "ccs",                 rotulo: "CCs",           dica: "CC's",                                   formato: "inteiro" },
  { metrica: "cura_propria",        rotulo: "Cura Própria",  dica: "Cura Própria",                           formato: "abreviado" },
  { metrica: "cura_aliados",        rotulo: "Cura Aliados",  dica: "Cura de aliados",                        formato: "abreviado" },
  { metrica: "dano_do_pino",        rotulo: "Dano ao Pino",  dica: "Dano ao pino",                           formato: "abreviado" },
  { metrica: "acerto_canhao",       rotulo: "Acerto Canhão", dica: "Acerto de Canhão",                       formato: "inteiro" },
  { metrica: "estruturas_canhao",   rotulo: "Estruturas",    dica: "Estruturas destruídas pelo Canhão",      formato: "inteiro" },
  { metrica: "distancia_canhao",    rotulo: "Dist. Canhão",  dica: "Distância máxima do tiro do canhão",     formato: "inteiro" },
  { metrica: "armadilha_disparos",  rotulo: "Trap",          dica: "Acionamento de Trap",                    formato: "inteiro" },
  { metrica: "tempo_morto",         rotulo: "Tempo Morto",   dica: "Tempo Morto",                            formato: "tempo" },
  { metrica: "tempo_sobrevivencia", rotulo: "Tempo Vivo",    dica: "Tempo Vivo",                             formato: "tempo" },
];
