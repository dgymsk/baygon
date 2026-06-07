import { auth } from "@/auth";

// Protege o app inteiro: sem sessão → manda pro /login.
// Liberados: /api/auth/*, /login, assets do _next e arquivos de imagem (mascote/ícones).
export default auth((req) => {
  if (!req.auth) {
    const url = new URL("/login", req.nextUrl.origin);
    if (req.nextUrl.pathname !== "/") url.searchParams.set("from", req.nextUrl.pathname);
    return Response.redirect(url);
  }
});

export const config = {
  matcher: ["/((?!api/auth|login|_next|.*\\.(?:png|svg|ico|jpg|jpeg|webp)).*)"],
};
