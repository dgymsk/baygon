import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { C } from "@/lib/theme";

export const metadata = { title: "Entrar · BAYGON" };

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; from?: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { error } = await searchParams;

  return (
    <main
      style={{
        minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 18, padding: 24, background: C.bgGlow, color: C.texto,
        fontFamily: "'Chakra Petch', system-ui, sans-serif",
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');`}</style>
      <img src="/mascot.png" alt="BAYGON" width={96} height={96} style={{ filter: "drop-shadow(0 0 24px rgba(204,0,0,.55))" }} />
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 44, letterSpacing: 3, margin: 0, color: C.verde, textShadow: "0 0 24px rgba(204,0,0,.35)" }}>
          BAYGON
        </h1>
        <p style={{ color: C.mute, marginTop: 6, fontSize: 14, letterSpacing: 1 }}>
          Painel da aliança · acesso restrito ao servidor Discord
        </p>
      </div>

      {error && (
        <p style={{ color: C.vermelho, fontSize: 13, maxWidth: 360, textAlign: "center" }}>
          ⚠ Acesso negado. Você precisa estar no <b>servidor Discord da guilda</b> para entrar.
        </p>
      )}

      <form action={async () => { "use server"; await signIn("discord", { redirectTo: "/" }); }}>
        <button
          type="submit"
          style={{
            display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer",
            borderRadius: 10, border: `1px solid ${C.border2}`, background: C.verdeTint,
            color: C.verde, padding: "12px 22px", fontSize: 15, fontWeight: 700, fontFamily: "inherit",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.25.5a18.3 18.3 0 0 1 4.3 1.4 16.5 16.5 0 0 0-14.9 0A18.3 18.3 0 0 1 8.85 3.5L8.6 3a19.8 19.8 0 0 0-4.9 1.4C.6 9 .1 13.5.3 17.9a19.9 19.9 0 0 0 6 3.1l.5-.8c-.7-.25-1.36-.56-2-.93l.5-.4a14.2 14.2 0 0 0 12.4 0l.5.4c-.64.37-1.3.68-2 .93l.5.8a19.9 19.9 0 0 0 6-3.1c.3-5.1-.5-9.6-2.9-13.5ZM8.4 15.3c-1.16 0-2.12-1.07-2.12-2.4 0-1.32.94-2.4 2.12-2.4 1.2 0 2.15 1.09 2.12 2.4 0 1.33-.94 2.4-2.12 2.4Zm7.2 0c-1.16 0-2.12-1.07-2.12-2.4 0-1.32.94-2.4 2.12-2.4 1.2 0 2.15 1.09 2.12 2.4 0 1.33-.93 2.4-2.12 2.4Z"/></svg>
          Entrar com Discord
        </button>
      </form>
    </main>
  );
}
