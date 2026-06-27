/**
 * Template das PTs (squads) do board "Montar PTs", conforme o tipo de evento.
 *  - nodewar: PT1, PT2, Defesa, UngaBunga (fixo);
 *  - siege:   N PTs numeradas (1-5, slider) + Flanco + Defesa.
 * As chaves do siege são separadas (sg*) das de nodewar, então marcar num modo
 * não mistura com o outro. Puro (sem imports de servidor) — usável no client.
 */
export type PtIcon = { kind: "num"; n: string } | { kind: "cdn"; id: string } | { kind: "emoji"; e: string };
export type PtDef = { key: string; nome: string; icon: PtIcon };

const FLAME_ID = "1459738870592835584"; // emoji "flame" do bot = Defesa
const UNGA_ID = "1512543325851353208"; // emoji ":ungaungacore:" = UngaBunga

export const SIEGE_MIN = 1;
export const SIEGE_MAX = 5;
export const clampSiege = (n: number) => Math.max(SIEGE_MIN, Math.min(SIEGE_MAX, Math.trunc(Number(n) || SIEGE_MIN)));

export function ptsAtivas(modo: string, siegePts: number): PtDef[] {
  if (modo === "siege") {
    const n = clampSiege(siegePts);
    const out: PtDef[] = [];
    for (let i = 1; i <= n; i++) out.push({ key: `sg${i}`, nome: `PT${i}`, icon: { kind: "num", n: String(i) } });
    out.push({ key: "sgflanco", nome: "Flanco", icon: { kind: "emoji", e: "⚔️" } });
    out.push({ key: "sgdefesa", nome: "Defesa", icon: { kind: "cdn", id: FLAME_ID } });
    return out;
  }
  return [
    { key: "1", nome: "PT1", icon: { kind: "num", n: "1" } },
    { key: "2", nome: "PT2", icon: { kind: "num", n: "2" } },
    { key: "defesa", nome: "Defesa", icon: { kind: "cdn", id: FLAME_ID } },
    { key: "ungabunga", nome: "UngaBunga", icon: { kind: "cdn", id: UNGA_ID } },
  ];
}

/** Todas as chaves de PT que podem ser gravadas (p/ validação no servidor). */
export const PT_KEYS_VALIDAS = new Set<string>([
  "1", "2", "defesa", "ungabunga",
  "sg1", "sg2", "sg3", "sg4", "sg5", "sgflanco", "sgdefesa",
]);
