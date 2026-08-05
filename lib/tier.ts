/**
 * Tier da node war — T1, T2 ou T3. É o porte da guerra: muda o teto de gear, o tamanho do time e
 * com quem você cruza, então comparar desempenho entre tiers diferentes não diz muita coisa.
 *
 * Módulo próprio (em vez de morar em eventos.ts ou intencaoPreset.ts) porque os dois lados precisam
 * dele: o preset guarda o tier padrão da chamada, o evento guarda o tier daquela guerra.
 *
 * Não confundir com `evento.tipo`, que é `nodewar | siege` — outra pergunta.
 */
export const TIERS = ["T1", "T2", "T3"] as const;
export type Tier = (typeof TIERS)[number];

/** Normaliza entrada solta ("t2", " T3 ") pro valor canônico. Qualquer outra coisa vira null
 *  (= não informado), que é o que o CHECK do banco aceita além dos três. */
export function tierOk(v: unknown): Tier | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return (TIERS as readonly string[]).includes(s) ? (s as Tier) : null;
}

export const corTier: Record<Tier, string> = { T1: "#7d8b99", T2: "#d6b22a", T3: "#e0322e" };
