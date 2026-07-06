// Proxy público de imagens do Blob PRIVADO: busca a URL privada com o token e faz stream,
// pra o Discord (e o preview) conseguirem exibir. Liberado no middleware. SSRF-guard: só
// aceita URLs do host privado do Vercel Blob.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const OK = /^https:\/\/[a-z0-9]+\.private\.blob\.vercel-storage\.com\/[^\s]+$/;

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get("u") ?? "";
  if (!OK.test(u)) return new Response("url inválida", { status: 400 });
  if (!TOKEN) return new Response("blob não configurado", { status: 500 });
  try {
    const res = await fetch(u, { headers: { Authorization: `Bearer ${TOKEN}` }, cache: "no-store" });
    if (!res.ok || !res.body) return new Response("não encontrado", { status: res.status || 404 });
    const ct = res.headers.get("content-type") ?? "image/png";
    return new Response(res.body, { headers: { "content-type": ct, "cache-control": "public, max-age=86400, immutable" } });
  } catch {
    return new Response("erro ao buscar imagem", { status: 502 });
  }
}
