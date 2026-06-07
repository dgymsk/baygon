/**
 * Paleta BAYGON — terminal/veneno: preto esverdeado + VERDE NEON (mascote/veneno)
 * como acento dominante, no estilo do app de avaliação. Amarelo só p/ avisos.
 */
export const C = {
  // base
  bg0: "#050a07",
  bgGlow: "radial-gradient(1100px 600px at 70% -10%, #0c2417 0%, #050a07 65%)",
  surface: "linear-gradient(180deg,#0a1610 0%,#070f0a 100%)",
  surfaceSolid: "#0a140e",
  inputBg: "#06100b",
  border: "#1c3a28",
  border2: "#2a5a3c",
  borderSoft: "#142b1d",
  tooltipBg: "#07120c",

  // acentos
  verde: "#34e06a", // verde neon — principal / positivo
  verdeBright: "#5cff8a",
  amarelo: "#ffd21e", // amarelo — avisos pontuais / pendente
  laranja: "#f4881f",
  vermelho: "#ff4d4d", // perigo / negativo

  // texto
  texto: "#d6f0dd",
  mute: "#6f9a80",
  branco: "#ffffff",

  // tints
  verdeTint: "rgba(52,224,106,.15)",
  amareloTint: "rgba(255,210,30,.15)",
} as const;
