import { createPublicKey, verify } from "crypto";

/**
 * Verifica a assinatura Ed25519 de uma interação do Discord (webhook de Interactions).
 * O Discord assina `timestamp + rawBody` com a chave privada do app; validamos com a
 * Public Key (Developer Portal). Usa o crypto nativo do Node — sem dependência extra.
 */
// Prefixo SPKI DER de uma chave pública Ed25519 (RFC 8410) — monta a KeyObject a partir
// dos 32 bytes crus da Public Key.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verificarInteracao(rawBody: string, sigHex: string | null, ts: string | null, publicKeyHex?: string): boolean {
  if (!publicKeyHex || !sigHex || !ts) return false;
  // rejeita timestamp velho/futuro (janela de 15min) — mitiga replay de uma requisição capturada
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 900) return false;
  try {
    const pub = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
    const sig = Buffer.from(sigHex, "hex");
    if (sig.length !== 64) return false;
    return verify(null, Buffer.from(ts + rawBody, "utf8"), pub, sig);
  } catch {
    return false;
  }
}
