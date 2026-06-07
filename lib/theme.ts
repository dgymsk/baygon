/**
 * Paleta BAYGON (marca de inseticida) — base escura azul-esverdeada,
 * VERDE TÓXICO (veneno / mascote) como acento principal e AMARELO da marca
 * como destaque. Sem o dourado/marrom medieval anterior.
 */
export const C = {
  // base
  bg0: "#060d0b",
  bgGlow: "radial-gradient(1200px 600px at 70% -10%, #103326 0%, #060d0b 60%)",
  surface: "linear-gradient(180deg,#0f1f18 0%,#0b1611 100%)",
  surfaceSolid: "#0e1c16",
  inputBg: "#091310",
  border: "#21402f",
  border2: "#2a4a37",
  borderSoft: "#172e22",
  tooltipBg: "#0b1611",

  // acentos
  verde: "#7ee046", // verde tóxico — principal / positivo
  verdeBright: "#a6ff5e",
  amarelo: "#ffd21e", // amarelo Baygon — marca / destaque
  laranja: "#f4881f",
  vermelho: "#ff5240", // perigo / negativo

  // texto
  texto: "#e9f3ec",
  mute: "#82a08f",
  branco: "#ffffff",

  // tints
  verdeTint: "rgba(126,224,70,.15)",
  amareloTint: "rgba(255,210,30,.15)",
} as const;
