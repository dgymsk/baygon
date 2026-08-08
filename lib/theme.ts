/**
 * Paleta BAYGON — couro/aço/sangue: preto grafite + VERMELHO CARMESIM (sangue)
 * como acento dominante, cinza aço como neutro e branco giz no texto.
 *   Preto Couro/Grafite  #0D0D0D–#1A1A1A
 *   Branco Giz/Pálido     #F2F2F2
 *   Vermelho Sangue/Carmesim #990000–#CC0000
 *   Cinza Metálico/Aço    #737373–#A6A6A6
 * (chaves mantêm o nome antigo — ex. `verde` = acento — p/ compatibilidade com o site.)
 */
export const C = {
  // base — preto couro / grafite escuro
  bg0: "#0d0d0d",
  bgGlow: "radial-gradient(1100px 600px at 70% -10%, #241010 0%, #0d0d0d 62%)",
  surface: "linear-gradient(180deg,#1a1a1a 0%,#0f0f0f 100%)",
  surfaceSolid: "#161616",
  inputBg: "#131313",
  border: "#2c2c2c",
  border2: "#454545",
  borderSoft: "#202020",
  tooltipBg: "#161616",

  // acentos — vermelho sangue / carmesim (acento) + aço p/ neutro
  verde: "#cc0000", // acento principal / positivo (carmesim)
  verdeBright: "#e11414",
  amarelo: "#a6a6a6", // "avisos" → aço claro (paleta sem amarelo)
  laranja: "#990000", // sangue escuro (2º tom)
  vermelho: "#cc0000", // perigo / negativo (carmesim)

  // texto — branco giz + cinza aço
  texto: "#f2f2f2",
  mute: "#8f8f8f",
  branco: "#f2f2f2",

  // tints
  verdeTint: "rgba(204,0,0,.15)",
  amareloTint: "rgba(166,166,166,.13)",
} as const;

/**
 * RESULTADO DA GUERRA — as únicas cores do app que fogem da paleta, de propósito.
 *
 * O tema é couro/aço/sangue: `verde` e `vermelho` são AMBOS carmesim (#cc0000) e `amarelo` é aço
 * cinza. Isso funciona pro resto da interface, mas destrói exatamente a distinção que o placar
 * precisa — vitória e derrota sairiam idênticas na tela. Aqui vale semáforo de verdade.
 *
 * `fundo` tem alpha baixo porque a cor é pro saldo se ler de relance rolando a lista, não pra
 * competir com o texto.
 */
export const CorResultado: Record<string, { cor: string; fundo: string }> = {
  vitoria:      { cor: "#3fbf5f", fundo: "rgba(47,158,68,.13)" },
  participacao: { cor: "#e0bd3a", fundo: "rgba(214,178,42,.13)" },
  derrota:      { cor: "#e04b4b", fundo: "rgba(204,0,0,.16)" },
};
/** Sem resultado gravado devolve null — "ainda não sabemos" não é empate, e não pode virar cor. */
export const corDoResultado = (r: string | null | undefined) =>
  (r ? CorResultado[r.toLowerCase()] ?? null : null);
