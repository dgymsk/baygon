/**
 * Catálogo (ordem canônica) das 15 métricas do print de resultado da war — igual ao CSV e à
 * tabela `metricas`. Puro (sem imports de servidor) — usado no client (tabela de revisão), no
 * lib de visão e nos endpoints.
 */
export const METRICAS_RESULTADO: { metrica: string; rotulo: string; dica: string }[] = [
  { metrica: "kills", rotulo: "Kills", dica: "Abates / Kills / Muertes causadas" },
  { metrica: "mortes", rotulo: "Mortes", dica: "Mortes / Muertes" },
  { metrica: "sequencia", rotulo: "Sequência", dica: "Maior sequência de abates / Racha" },
  { metrica: "dano_em_player", rotulo: "Dano PvP", dica: "Dano a personagens/jogadores / Daño a personajes" },
  { metrica: "dano_recebido", rotulo: "Dano Recebido", dica: "Dano recebido / Daño recibido" },
  { metrica: "ccs", rotulo: "CCs", dica: "CCs / Derrubadas / Controle de grupo" },
  { metrica: "cura_propria", rotulo: "Cura Própria", dica: "Cura em si mesmo / Curación propia" },
  { metrica: "cura_aliados", rotulo: "Cura Aliados", dica: "Cura em aliados / Curación a aliados" },
  { metrica: "dano_do_pino", rotulo: "Dano Pino", dica: "Dano ao pino/estandarte de comando" },
  { metrica: "acerto_canhao", rotulo: "Acerto Canhão", dica: "Acertos de canhão / Aciertos de cañón" },
  { metrica: "estruturas_canhao", rotulo: "Estruturas (canhão)", dica: "Estruturas destruídas com canhão" },
  { metrica: "distancia_canhao", rotulo: "Distância Canhão", dica: "Distância de disparo de canhão" },
  { metrica: "armadilha_disparos", rotulo: "Armadilhas", dica: "Disparos de armadilha / Trampas" },
  { metrica: "tempo_morto", rotulo: "Tempo Morto", dica: "Tempo morto (mm:ss) / Tiempo muerto" },
  { metrica: "tempo_sobrevivencia", rotulo: "Tempo Vivo", dica: "Tempo de sobrevivência/vivo (mm:ss)" },
];
