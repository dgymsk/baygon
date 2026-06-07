import Link from "next/link";

const GOLD = "#e3b04b", PARCH = "#e9dcc0", MUTE = "#8a7c5f";

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
        background: "radial-gradient(1200px 600px at 50% -10%, #241a10 0%, #0e0a06 60%)",
        fontFamily: "'Chakra Petch', system-ui, sans-serif",
        color: PARCH,
        padding: 24,
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&family=Chakra+Petch:wght@400;500;600&display=swap');`}</style>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontFamily: "'Cinzel', serif", fontWeight: 800, fontSize: 40, letterSpacing: 1, margin: 0, color: GOLD, textShadow: "0 2px 18px rgba(227,176,75,.25)" }}>
          Guild War Stats
        </h1>
        <p style={{ color: MUTE, marginTop: 8, fontSize: 14, letterSpacing: 1 }}>
          Estatísticas de Node War · Manicômio
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
        border: "1px solid #3a2c18",
        background: "linear-gradient(180deg,#1c150d 0%,#15100a 100%)",
        boxShadow: "0 10px 40px rgba(0,0,0,.5), inset 0 1px 0 rgba(227,176,75,.08)",
        color: PARCH,
      }}
    >
      <div style={{ fontFamily: "'Cinzel',serif", fontWeight: 800, fontSize: 20, color: GOLD }}>{titulo}</div>
      <div style={{ color: MUTE, fontSize: 13, marginTop: 4 }}>{desc}</div>
    </Link>
  );
}
