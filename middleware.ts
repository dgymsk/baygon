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

// Exclusões ANCORADAS no início do path (não por extensão "em qualquer lugar",
// senão /api/x.png burlava o gate). Só libera: auth, _next, /login e os assets
// públicos da tela de login (mascote/ícones/favicon). Todo o resto — incluindo
// TODAS as /api de escrita/leitura — passa pelo gate.
export const config = {
  matcher: ["/((?!api/auth|_next|login|guilds/|mascot\\.png|favicon\\.ico).*)"],
};
