import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { auth, signOut } from "@/auth";
import NavMenu from "./NavMenu";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BAYGON · Painel da Aliança",
  description: "Estatísticas de Node War — Manicômio + Resonance",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  const canEdit = (session as { canEdit?: boolean } | null)?.canEdit === true;
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        {session?.user && (
          <div className="barra-conta" style={{ position: "fixed", right: 12, bottom: 12, zIndex: 50, display: "flex", gap: 8, alignItems: "center", fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
            <NavMenu canEdit={canEdit} />
            <a
              href="/eu"
              title="Minhas stats"
              style={{
                display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none",
                borderRadius: 999, border: "1px solid #454545", background: "#131313",
                color: "#f2f2f2", padding: "6px 12px", fontSize: 12,
              }}
            >
              {session.user.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={session.user.image} alt="" width={18} height={18} style={{ borderRadius: 999 }} />
              )}
              <span className="nome">{session.user.name}</span>
            </a>
            <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
              <button
                type="submit"
                title="Sair"
                style={{
                  cursor: "pointer", borderRadius: 999, border: "1px solid #454545", background: "#131313",
                  color: "#8f8f8f", padding: "6px 12px", fontSize: 12, fontFamily: "inherit",
                }}
              >
                Sair
              </button>
            </form>
          </div>
        )}
      </body>
    </html>
  );
}
