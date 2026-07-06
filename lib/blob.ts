import { put, list } from "@vercel/blob";

/** Upload de imagem pro Vercel Blob (público). Precisa de BLOB_READ_WRITE_TOKEN no ambiente. */
export async function uploadImagem(nome: string, file: Blob): Promise<string> {
  const safe = (nome || "img").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60) || "img";
  const res = await put(`participacao/${safe}`, file, { access: "public", addRandomSuffix: true });
  return res.url;
}

/** Lista as imagens já enviadas (mais recentes primeiro). Vazio se Blob não configurado. */
export async function listImagens(): Promise<{ url: string; nome: string }[]> {
  try {
    const { blobs } = await list({ prefix: "participacao/", limit: 100 });
    return blobs
      .sort((a, b) => (b.uploadedAt ? +new Date(b.uploadedAt) : 0) - (a.uploadedAt ? +new Date(a.uploadedAt) : 0))
      .map((b) => ({ url: b.url, nome: b.pathname.replace(/^participacao\//, "") }));
  } catch {
    return [];
  }
}
