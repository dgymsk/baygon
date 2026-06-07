import Link from "next/link";

const GOLD = "#34e06a", PARCH = "#d6f0dd", MUTE = "#6f9a80";

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        background: "radial-gradient(1200px 600px at 50% -10%, #0c2417 0%, #050a07 60%)",
        fontFamily: "'Chakra Petch', system-ui, sans-serif",
        color: PARCH,
        padding: 24,
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');`}</style>
      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <img src="/mascot.png" alt="BAYGON" width={92} height={92} style={{ filter: "drop-shadow(0 0 22px rgba(126,224,70,.55))" }} />
        <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 46, letterSpacing: 3, margin: "4px 0 0", color: GOLD, textShadow: "0 0 24px rgba(126,224,70,.35)" }}>
          BAYGON
        </h1>
        <p style={{ color: MUTE, marginTop: 2, fontSize: 14, letterSpacing: 1 }}>
          Aliança · <span style={{ color: "#7ee046" }}>Manicômio</span> + <span style={{ color: "#7ee046" }}>Resonance</span> · Node War
        </p>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
        <Tile href="/painel" titulo="Painel" desc="Radar e ranking por war/grupo" />
        <Tile href="/evolucao" titulo="Evolução" desc="Performance no tempo (player/grupo/geral)" />
        <Tile href="/membros" titulo="Membros" desc="Adicionar, remover e gerenciar grupos/classes" />
        <Tile href="/config" titulo="Configuração" desc="Cores e métricas de cada grupo" />
      </div>
    </main>
  );
}

function Tile({ href, titulo, desc }: { href: string; titulo: string; desc: string }) {
  return (
    <Link
      href={href}
      style={{
        textDecoration: "none",
        minWidth: 220,
        padding: "20px 24px",
        borderRadius: 14,
        border: "1px solid #1c3a28",
        background: "linear-gradient(180deg,#0a1610 0%,#07120c 100%)",
        boxShadow: "0 10px 40px rgba(0,0,0,.5), inset 0 1px 0 rgba(52,224,106,.08)",
        color: PARCH,
      }}
    >
      <div style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 20, color: GOLD }}>{titulo}</div>
      <div style={{ color: MUTE, fontSize: 13, marginTop: 4 }}>{desc}</div>
    </Link>
  );
}
