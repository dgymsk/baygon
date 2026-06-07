/**
 * Classes do Black Desert (PT-BR) e seus tipos de especialização.
 * Regra:
 *  - maioria: Despertar (Awakening) + Sucessão (Succession)
 *  - Classes de Ascensão: Arqueiro, Erudita, Deadeye, Wukong, Seraph
 *  - Shai: Talento (classe "única")
 * Editável aqui caso o jogo/guilda mude.
 */

export type SpecTipo = "Despertar" | "Sucessão" | "Ascensão" | "Talento";
export const TIPOS: SpecTipo[] = ["Despertar", "Sucessão", "Ascensão", "Talento"];

const PADRAO: SpecTipo[] = ["Despertar", "Sucessão"];

export const CLASSES: { nome: string; tipos: SpecTipo[] }[] = [
  { nome: "Guerreiro", tipos: PADRAO },
  { nome: "Ranger", tipos: PADRAO },
  { nome: "Feiticeira", tipos: PADRAO },
  { nome: "Berserker", tipos: PADRAO },
  { nome: "Domadora", tipos: PADRAO },
  { nome: "Musa", tipos: PADRAO },
  { nome: "Maehwa", tipos: PADRAO },
  { nome: "Valquíria", tipos: PADRAO },
  { nome: "Kunoichi", tipos: PADRAO },
  { nome: "Ninja", tipos: PADRAO },
  { nome: "Mago", tipos: PADRAO },
  { nome: "Bruxa", tipos: PADRAO },
  { nome: "Cavaleira das Trevas", tipos: PADRAO },
  { nome: "Striker", tipos: PADRAO },
  { nome: "Mística", tipos: PADRAO },
  { nome: "Lahn", tipos: PADRAO },
  { nome: "Arqueiro", tipos: ["Ascensão"] },
  { nome: "Shai", tipos: ["Talento"] },
  { nome: "Guardiã", tipos: PADRAO },
  { nome: "Hashashin", tipos: PADRAO },
  { nome: "Nova", tipos: PADRAO },
  { nome: "Sage", tipos: PADRAO },
  { nome: "Corsária", tipos: PADRAO },
  { nome: "Drakania", tipos: PADRAO },
  { nome: "Woosa", tipos: PADRAO },
  { nome: "Maegu", tipos: PADRAO },
  { nome: "Erudita", tipos: ["Ascensão"] },
  { nome: "DoSa", tipos: PADRAO },
  { nome: "Deadeye", tipos: ["Ascensão"] },
  { nome: "Wukong", tipos: ["Ascensão"] },
  { nome: "Seraph", tipos: ["Ascensão"] },
];

export const CLASSE_NOMES: string[] = CLASSES.map((c) => c.nome);

/** Tipos válidos para uma classe (todos, se a classe não for reconhecida). */
export const tiposDe = (classe: string | null | undefined): SpecTipo[] =>
  CLASSES.find((c) => c.nome === classe)?.tipos ?? TIPOS;
