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
