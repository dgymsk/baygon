import type { EstadoWar } from "@/lib/historicoSemana";

/**
 * A paleta dos quadradinhos de presença — UMA definição, usada pelo card da escalação e pela grade
 * global de /presenca.
 *
 * Estava dentro do EventoBoard e a grade precisava das mesmas cores. Duas cópias divergiriam no
 * primeiro ajuste, e aí a mesma informação teria duas caras no mesmo app — que é pior do que não
 * ter cor nenhuma.
 *
 * Cores REAIS (verde/azul/laranja/vermelho) e não a paleta do site: aqui a cor É a informação, e a
 * paleta couro/aço/sangue tem `verde` e `vermelho` iguais.
 */
export const ESTADO: Record<EstadoWar, { fill: string; stroke?: string; marca?: "x" | "o" | "traco"; rot: string }> = {
  jogou:           { fill: "#3fbf5f", rot: "escalado e jogou" },
  jogou_sem_escala:{ fill: "#3f8fe0", rot: "não escalado, mas jogou" },
  marcou:          { fill: "#e08a3a", rot: "marcou e não foi escalado" },
  faltou:          { fill: "#2a1414", stroke: "#e04b4b", marca: "x", rot: "escalado e NÃO compareceu" },
  nao_respondeu:   { fill: "transparent", stroke: "#8f8f8f", marca: "o", rot: "não respondeu a chamada" },
  recusou:         { fill: "#3a3a3a", stroke: "#8f8f8f", marca: "traco", rot: "recusou — avisou que não ia" },
  sem_stat:        { fill: "#2e2e2e", stroke: "#5a5a5a", rot: "escalado, mas a war não teve estatística gravada" },
  sem:             { fill: "#242424", rot: "sem dado" },
};
