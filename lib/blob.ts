import { put, list } from "@vercel/blob";

/**
 * Imagens no Vercel Blob. O store é PRIVADO (URL direta dá 403), então servimos via um
 * proxy público nosso (/api/img?u=<url privada>) que busca com o token e faz stream — assim
 * o Discord consegue exibir. `uploadImagem`/`listImagens` já devolvem a URL do PROXY.
 */
const base = () => `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || "baygon.vercel.app"}`;
const proxyUrl = (privateUrl: string) => `${base()}/api/img?u=${encodeURIComponent(privateUrl)}`;

export async function uploadImagem(nome: string, file: Blob): Promise<string> {
  const safe = (nome || "img").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60) || "img";
  const res = await put(`participacao/${safe}`, file, { access: "private", addRandomSuffix: true });
  return proxyUrl(res.url);
}

/** Lista as imagens enviadas (mais recentes primeiro), já como URL de proxy. Vazio se Blob off. */
export async function listImagens(): Promise<{ url: string; nome: string }[]> {
  try {
    const { blobs } = await list({ prefix: "participacao/", limit: 100 });
    return blobs
      .sort((a, b) => (b.uploadedAt ? +new Date(b.uploadedAt) : 0) - (a.uploadedAt ? +new Date(a.uploadedAt) : 0))
      .map((b) => ({ url: proxyUrl(b.url), nome: b.pathname.replace(/^participacao\//, "") }));
  } catch {
    return [];
  }
}
