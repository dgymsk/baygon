/**
 * Chave canônica para casar nomes de família entre fontes diferentes
 * (embed do bot Apollo, leitura por visão do print in-game, e texto digitado
 * à mão no /config). Remove acentos, colapsa espaços e normaliza caixa, pra
 * "Aláska" / "Alaska" / "Alaska " caírem na MESMA chave.
 * Puro (sem imports de servidor) — pode ser usado no client.
 */
export function chaveNome(s: string): string {
  // NFD separa o acento (diacrítico combinante, U+0300..U+036F) da letra base;
  // filtramos esses code points por número (sem regex de char combinante).
  const semAcento = [...(s ?? "").normalize("NFD")]
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c < 0x0300 || c > 0x036f;
    })
    .join("");
  return semAcento.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Distância de edição com transposição adjacente (Optimal String Alignment):
 * inserção/remoção/substituição = 1, e trocar 2 letras vizinhas = 1 (comum em OCR,
 * ex.: "wizrad" -> "wizard"). Levenshtein puro contaria 2.
 */
export function distancia(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prevPrev: number[] = new Array(n + 1).fill(0);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], prevPrev[j - 2] + 1); // transposição adjacente
      }
    }
    prevPrev = prev; prev = cur;
  }
  return prev[n];
}

/**
 * Encaixa um nome (já como chaveNome) no candidato REAL mais próximo, p/ corrigir
 * erros de 1-2 letras da IA (ex.: "sykoltic" -> "sykotic"). Conservador: limite de
 * distância cresce com o tamanho (nomes curtos exigem exato) e só aceita se houver
 * vencedor CLARO (sem empate) — evita fundir duas pessoas de nomes parecidos.
 * Retorna o candidato (nome de exibição) ou null se nada seguro casar.
 */
export function acharSimilar(alvoChave: string, candidatos: { chave: string; nome: string }[]): { nome: string; dist: number } | null {
  const len = alvoChave.length;
  const maxDist = len <= 3 ? 0 : len <= 6 ? 1 : 2;
  if (maxDist === 0) return null; // muito curto → não arrisca
  let best: { nome: string; dist: number } | null = null;
  let segundo = Infinity;
  for (const c of candidatos) {
    if (Math.abs(c.chave.length - len) > maxDist) continue; // poda por tamanho
    const d = distancia(alvoChave, c.chave);
    if (d < (best?.dist ?? Infinity)) { segundo = best?.dist ?? Infinity; best = { nome: c.nome, dist: d }; }
    else if (d < segundo) segundo = d;
  }
  if (best && best.dist <= maxDist && best.dist < segundo) return best; // dentro do limite e sem empate
  return null;
}
