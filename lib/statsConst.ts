/**
 * CONSTANTES DE ESTATÍSTICA QUE O NAVEGADOR PODE IMPORTAR.
 *
 * Existe por um acidente que custou uma tela inteira: lib/stats.ts importa lib/db.ts, e lib/db.ts
 * LANÇA ERRO ao ser carregado sem DATABASE_URL — que é exatamente o estado do navegador. Um
 * componente cliente que importava só uma lista de nomes daquele arquivo puxava o módulo do banco
 * junto e morria na primeira linha, com "This page couldn't load" e nenhuma pista.
 *
 * Aqui não entra nada que toque o banco. lib/db.ts agora é `server-only`, então repetir o acidente
 * quebra a build em vez da tela.
 */

/** Métricas observadas nas telas de comparação: Dano PvP, Dano Pino, CC, Cura Aliados, Tempo Morto. */
export const STAT_METRICAS = ["dano_em_player", "dano_do_pino", "ccs", "cura_aliados", "tempo_morto"];

/** Janelas de wars oferecidas em /classes. 999 = todas. */
export const JANELAS = [5, 10, 20, 999] as const;
export const janelaOk = (v: unknown): number => {
  const n = Math.trunc(Number(v));
  return (JANELAS as readonly number[]).includes(n) ? n : 10;
};
