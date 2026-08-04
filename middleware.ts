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
// senão /api/x.png burlava o gate). Libera: auth, _next, /login e os assets
// públicos da tela de login. TAMBÉM libera do gate de sessão os endpoints chamados
// por serviços externos: api/discord (webhook de Interações, protegido por assinatura
// Ed25519) e api/participacao/cron|api/intencao/cron (Vercel Cron, protegido por CRON_SECRET). Todo o
// resto — incluindo as demais /api de escrita/leitura — passa pelo gate.
export const config = {
  matcher: ["/((?!api/auth|api/discord/interactions|api/participacao/cron|api/garmoth/refresh(?:/|$)|api/img|_next|login|guilds/|mascot\\.png|favicon\\.ico).*)"],
};
