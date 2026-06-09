import { chaveNome } from "@/lib/nomes";
import type { GrupoConf, PlayerConf } from "@/lib/confirmados";

/**
 * Aplica as substituições CONFIRMADAS ao roster: tira os removidos de cada grupo e
 * coloca os promovidos (reservas confirmadas) no lugar, repartindo a fila de cada
 * ícone entre os grupos via cursor (grupos com o mesmo emoji não se confundem).
 * Espelha a cascata do SubstituicoesBoard — mantenha as duas em sincronia.
 */
export function gruposEfetivos(
  grupos: GrupoConf[], listaEspera: PlayerConf[], removidos: Set<string>, promovidos: Set<string>,
): GrupoConf[] {
  const isRem = (p: PlayerConf) => removidos.has(chaveNome(p.nome));
  const isProm = (p: PlayerConf) => promovidos.has(chaveNome(p.nome));

  const need = new Map<string, number>();
  for (const g of grupos) {
    if (!g.iconKey) continue;
    const n = g.players.filter(isRem).length;
    if (n > 0) need.set(g.iconKey, (need.get(g.iconKey) ?? 0) + n);
  }
  // confirmados por ícone (ordem da espera), limitados ao need
  const confPorIcon = new Map<string, PlayerConf[]>();
  for (const w of listaEspera) {
    if (isRem(w) || !w.iconKey || !isProm(w)) continue;
    const lim = need.get(w.iconKey) ?? 0;
    const arr = confPorIcon.get(w.iconKey) ?? [];
    if (arr.length < lim) { arr.push(w); confPorIcon.set(w.iconKey, arr); }
  }
  const cursor = new Map<string, number>();
  return grupos.map((g) => {
    const remaining = g.players.filter((p) => !isRem(p));
    let promoted: PlayerConf[] = [];
    const removedHere = g.players.length - remaining.length;
    if (g.iconKey && removedHere) {
      const pool = confPorIcon.get(g.iconKey) ?? [];
      const start = cursor.get(g.iconKey) ?? 0;
      promoted = pool.slice(start, start + removedHere);
      cursor.set(g.iconKey, start + promoted.length);
    }
    return { ...g, players: [...remaining, ...promoted] };
  });
}
