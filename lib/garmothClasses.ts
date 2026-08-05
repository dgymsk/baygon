import { tiposDe } from "./bdoClasses";

/**
 * Ordem das classes no Garmoth (campo numérico `class`, 0-based) → nome CANÔNICO do app.
 * Fonte: ordem dos ícones no Garmoth (0=Berserker, 3=Domadora=Azly, … 30=Seraph).
 * Puro (client-safe). Alinha com CLASSE_NOMES de bdoClasses (Caçadora→Ranger, Lutador→Striker,
 * Musah→Musa, Wu-Sa→Woosa, Me-Gu→Maegu, Dosa→DoSa, Serafim→Seraph).
 */
export const GARMOTH_CLASSES: string[] = [
  "Berserker", "Ranger", "Feiticeira", "Domadora", "Valquíria", "Guerreiro", "Bruxa", "Mago",
  "Musa", "Maehwa", "Ninja", "Kunoichi", "Cavaleira das Trevas", "Striker", "Mística", "Lahn",
  "Arqueiro", "Shai", "Guardiã", "Hashashin", "Nova", "Sage", "Corsária", "Drakania",
  "Woosa", "Maegu", "Erudita", "DoSa", "Deadeye", "Wukong", "Seraph",
];

export function classeGarmoth(n: number | null | undefined): string | null {
  return typeof n === "number" && n >= 0 && n < GARMOTH_CLASSES.length ? GARMOTH_CLASSES[n] : null;
}

/** spec do Garmoth (succ=Sucessão, awk=Despertar) → tipo do app. Classe de tipo único (Ascensão/Talento) ignora o spec. */
export function tipoGarmoth(classeCanonica: string | null, spec: string | null | undefined): string | null {
  if (!classeCanonica) return null;
  const tipos = tiposDe(classeCanonica);
  if (tipos.length === 1) return tipos[0]; // Arqueiro/Erudita/Deadeye/Wukong/Seraph=Ascensão; Shai=Talento
  const s = (spec || "").toLowerCase();
  // a API manda "awak"; "awk" é o que o registro manual digita. Aceitar só os dois últimos fazia
  // TODO despertar vindo do Garmoth cair em null, e o COALESCE lá em cima congelava o tipo antigo.
  return s === "succ" || s === "succession" ? "Sucessão"
    : s === "awak" || s === "awk" || s === "awakening" ? "Despertar" : null;
}
