import { chaveNome, acharSimilar } from "@/lib/nomes";

export type Cand = { chave: string; nome: string };
export type Correcao = { de: string; para: string };

/**
 * Encaixa um nome lido pela IA no nome REAL mais próximo, com PRIORIDADE pro roster
 * da war atual (bot + espera + reservas) sobre a tabela `players` — senão um typo
 * histórico em players (ex.: "Denzell") roubaria o match do "Denzel" do bot.
 * Ordem: exato no roster → similar no roster → exato em players → similar em players.
 */
export function casarNome(nome: string, roster: Cand[], players: Cand[]): string {
  const k = chaveNome(nome);
  const exato = (cands: Cand[]) => cands.find((c) => c.chave === k)?.nome;
  return exato(roster) ?? acharSimilar(k, roster)?.nome ?? exato(players) ?? acharSimilar(k, players)?.nome ?? nome;
}

/**
 * Canonicaliza uma lista de nomes (de exibição). Devolve o mapa, as correções
 * aplicadas (mudou de nome) e os NÃO ENCONTRADOS (não bateram com ninguém — nem
 * exato nem similar; podem ser roubo legítimo OU leitura ruim da IA, conferir).
 */
export function canonicalizarNomes(nomes: string[], roster: Cand[], players: Cand[]): { mapa: Map<string, string>; correcoes: Correcao[]; naoEncontrados: string[] } {
  const mapa = new Map<string, string>(); // chaveNome(original) -> nome canônico
  const correcoes: Correcao[] = [];
  const naoEncontrados: string[] = [];
  const exato = (k: string, cands: Cand[]) => cands.some((c) => c.chave === k);
  for (const nome of nomes) {
    const k = chaveNome(nome);
    if (!k || mapa.has(k)) continue;
    const canon = casarNome(nome, roster, players);
    mapa.set(k, canon);
    if (chaveNome(canon) !== k) correcoes.push({ de: nome, para: canon });
    else if (!exato(k, roster) && !exato(k, players)) naoEncontrados.push(nome);
  }
  return { mapa, correcoes, naoEncontrados };
}
