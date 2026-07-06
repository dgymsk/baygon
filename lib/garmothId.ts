/**
 * Extrai o id da build do Garmoth de uma URL colada (ou aceita o id cru).
 * "https://garmoth.com/character/dMx9dsM85P" -> "dMx9dsM85P". Puro (client-safe).
 * Retorna null se não parecer um id válido.
 */
export function parseGarmothId(input: string): string | null {
  const s = (input || "").trim();
  if (!s) return null;
  const m = s.match(/garmoth\.com\/character\/([^/?#\s]+)/i);
  const id = (m ? m[1] : s.replace(/[?#].*$/, "").replace(/^.*\//, "")).trim();
  return /^[A-Za-z0-9_-]{4,40}$/.test(id) ? id : null;
}
