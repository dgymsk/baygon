import { chaveNome } from "@/lib/nomes";
import type { GrupoConf, PlayerConf } from "@/lib/confirmados";

/** Grupo "Ataque" = flex: a vaga aceita subir QUALQUER classe (sem aviso).
 *  Ancorado no início (evita "Contra-ataque", "Reataque" etc.). */
export function ehAtaque(nome: string): boolean {
  return /^ataque\b/i.test(nome.trim());
}

export type Slot = { removido: PlayerConf; promovido: PlayerConf | null; cross: boolean };
export type GrupoView = { g: GrupoConf; ataque: boolean; slots: Slot[] };
export type Atribuicao = {
  grupoView: GrupoView[];
  promovidoPara: Map<string, { grupo: string; cross: boolean }>; // chave do promovido -> grupo + se é cross-classe
  abertas: { icon: string | null; ataque: boolean }[]; // vagas ainda não preenchidas
};

/**
 * Casa removidos (vagas) com promovidos confirmados. Regras:
 *  1) mesma classe (mesmo ícone) numa vaga NÃO-ataque — match limpo;
 *  2) vaga de ATAQUE pega qualquer reserva — match limpo (ataque é flex);
 *  3) sobra → cross: vaga não-ataque preenchida por outra classe (marcado p/ AVISO).
 * Compartilhado pelo SubstituicoesBoard e pelo gruposEfetivos — fonte única.
 */
export function atribuirPromocoes(
  grupos: GrupoConf[], listaEspera: PlayerConf[], removidos: Set<string>, promovidos: Set<string>,
): Atribuicao {
  const isRem = (p: PlayerConf) => removidos.has(chaveNome(p.nome));
  const isProm = (p: PlayerConf) => promovidos.has(chaveNome(p.nome));

  type Vaga = { gIdx: number; icon: string | null; ataque: boolean; prom: PlayerConf | null };
  const vagas: Vaga[] = [];
  grupos.forEach((g, gIdx) => {
    const n = g.players.filter(isRem).length;
    const ataque = ehAtaque(g.nome);
    for (let i = 0; i < n; i++) vagas.push({ gIdx, icon: g.iconKey, ataque, prom: null });
  });

  const proms = listaEspera.filter((w) => isProm(w) && !isRem(w)); // confirmados, em ordem da espera
  const usados = new Set<string>();
  const pegar = (pred: (p: PlayerConf) => boolean) => proms.find((p) => !usados.has(chaveNome(p.nome)) && pred(p));
  const atribui = (v: Vaga, w: PlayerConf | undefined) => { if (w) { v.prom = w; usados.add(chaveNome(w.nome)); } };

  for (const v of vagas) if (!v.ataque && !v.prom) atribui(v, pegar((p) => (p.iconKey ?? null) === v.icon)); // 1) mesma classe
  for (const v of vagas) if (v.ataque && !v.prom) atribui(v, pegar(() => true)); // 2) ataque pega qualquer
  for (const v of vagas) if (!v.prom) atribui(v, pegar(() => true)); // 3) cross (vaga não-ataque restante)

  const promovidoPara = new Map<string, { grupo: string; cross: boolean }>();
  const grupoView: GrupoView[] = grupos.map((g, gIdx) => {
    const removidosAqui = g.players.filter(isRem);
    const vagasAqui = vagas.filter((v) => v.gIdx === gIdx); // mesma ordem/contagem dos removidos
    const slots: Slot[] = removidosAqui.map((rmv, i) => {
      const v = vagasAqui[i];
      const promovido = v?.prom ?? null;
      const cross = !!promovido && !v.ataque && (promovido.iconKey ?? null) !== v.icon;
      if (promovido) promovidoPara.set(chaveNome(promovido.nome), { grupo: g.nome, cross });
      return { removido: rmv, promovido, cross };
    });
    return { g, ataque: ehAtaque(g.nome), slots };
  });
  const abertas = vagas.filter((v) => !v.prom).map((v) => ({ icon: v.icon, ataque: v.ataque }));
  return { grupoView, promovidoPara, abertas };
}

/** Roster pós-substituição (removidos saem, promovidos confirmados entram no grupo da vaga). */
export function gruposEfetivos(
  grupos: GrupoConf[], listaEspera: PlayerConf[], removidos: Set<string>, promovidos: Set<string>,
): GrupoConf[] {
  const { grupoView } = atribuirPromocoes(grupos, listaEspera, removidos, promovidos);
  return grupos.map((g, i) => {
    const remaining = g.players.filter((p) => !removidos.has(chaveNome(p.nome)));
    const promoted = grupoView[i].slots.map((s) => s.promovido).filter((p): p is PlayerConf => !!p);
    return { ...g, players: [...remaining, ...promoted] };
  });
}
