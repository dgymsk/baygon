import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { auth, signOut } from "@/auth";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BAYGON · Painel da Aliança",
  description: "Estatísticas de Node War — Manicômio + Resonance",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        {session?.user && (
          <form
            action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}
            style={{ position: "fixed", right: 12, bottom: 12, zIndex: 50 }}
          >
            <button
              type="submit"
              title={`Sair (${session.user.name ?? ""})`}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer",
                borderRadius: 999, border: "1px solid #2a5a3c", background: "#06100b",
                color: "#6f9a80", padding: "6px 12px", fontSize: 12,
                fontFamily: "'Chakra Petch', system-ui, sans-serif",
              }}
            >
              {session.user.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={session.user.image} alt="" width={18} height={18} style={{ borderRadius: 999 }} />
              )}
              <span style={{ color: "#d6f0dd" }}>{session.user.name}</span> · Sair
            </button>
          </form>
        )}
      </body>
    </html>
  );
}
