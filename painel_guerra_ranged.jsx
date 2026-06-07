import React, { useState, useMemo } from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine, Cell,
  ResponsiveContainer, Tooltip,
} from "recharts";

// --- dados da war (já normalizados: k/M -> número, mm:ss -> segundos) ---
// lista ILUSTRATIVA do grupo "Ranged" extraída do print de 05/06/2026 (Derrota)
const PLAYERS = [
  { nome: "Tripaloska",     dano_pvp: 887600,  dano_pino: 2300000,  morto: 594, core: true },
  { nome: "Infa",           dano_pvp: 1400000, dano_pino: 330500,   morto: 649, core: true },
  { nome: "CorvoNegroo",    dano_pvp: 983400,  dano_pino: 1300000,  morto: 424 },
  { nome: "Voltroon",       dano_pvp: 522400,  dano_pino: 6100000,  morto: 420 },
  { nome: "KingDarK",       dano_pvp: 635100,  dano_pino: 6700000,  morto: 596 },
  { nome: "BololoHAHAHAHA", dano_pvp: 683000,  dano_pino: 5800000,  morto: 665 },
  { nome: "DEC",            dano_pvp: 470500,  dano_pino: 14100000, morto: 517 },
  { nome: "Tdz1",           dano_pvp: 641600,  dano_pino: 2400000,  morto: 542 },
  { nome: "Illumi",         dano_pvp: 431200,  dano_pino: 1000000,  morto: 486 },
  { nome: "Arquitorto",     dano_pvp: 315700,  dano_pino: 2500000,  morto: 495 },
  { nome: "OPeres",         dano_pvp: 431200,  dano_pino: 2400000,  morto: 602 },
];

// métricas do grupo Ranged + direção (menor = inverte)
const METRICS = [
  { key: "dano_pvp",  label: "Dano PvP",       dir: "maior" },
  { key: "dano_pino", label: "Dano Pino",      dir: "maior" },
  { key: "morto",     label: "Sobrevivência",  dir: "menor" }, // tempo morto invertido
];

export default function PainelGuerra() {
  const [sel, setSel] = useState("KingDarK");
  const [metricBar, setMetricBar] = useState("dano_pino");

  // régua = média do core, por métrica
  const core = useMemo(() => {
    const cs = PLAYERS.filter((p) => p.core);
    const avg = {};
    METRICS.forEach((m) => (avg[m.key] = cs.reduce((s, p) => s + p[m.key], 0) / cs.length));
    return avg;
  }, []);

  // % do core (100 = empatou; >100 = melhor). Inverte onde menos é melhor.
  const pct = (val, m) =>
    m.dir === "maior" ? (val / core[m.key]) * 100 : (core[m.key] / val) * 100;

  const selPlayer = PLAYERS.find((p) => p.nome === sel);

  const radarData = METRICS.map((m) => ({
    metric: m.label,
    real: pct(selPlayer[m.key], m),
    show: Math.min(pct(selPlayer[m.key], m), 200), // clamp visual no radar
    core: 100,
  }));

  const mBar = METRICS.find((m) => m.key === metricBar);
  const bars = PLAYERS
    .map((p) => ({ nome: p.nome, val: pct(p[metricBar], mBar), isCore: !!p.core, me: p.nome === sel }))
    .sort((a, b) => b.val - a.val);

  const GOLD = "#e3b04b", CRIM = "#bf4234", PARCH = "#e9dcc0", MUTE = "#8a7c5f", BG2 = "#1a140d";

  const colorFor = (v) => (v >= 100 ? GOLD : CRIM);

  return (
    <div style={{ background: "radial-gradient(1200px 600px at 70% -10%, #241a10 0%, #0e0a06 60%)", minHeight: "100%", padding: "28px 24px", fontFamily: "'Chakra Petch', system-ui, sans-serif", color: PARCH }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&family=Chakra+Petch:wght@400;500;600&display=swap');
        .card{background:linear-gradient(180deg,#1c150d 0%,#15100a 100%);border:1px solid #3a2c18;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.5), inset 0 1px 0 rgba(227,176,75,.08);}
        select{background:#0f0b06;color:${PARCH};border:1px solid #4a3a20;border-radius:8px;padding:8px 12px;font-family:inherit;font-size:14px;outline:none;cursor:pointer}
        select:focus{border-color:${GOLD}}
      `}</style>

      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
          <h1 style={{ fontFamily: "'Cinzel', serif", fontWeight: 800, fontSize: 30, letterSpacing: 1, margin: 0, color: GOLD, textShadow: "0 2px 12px rgba(227,176,75,.25)" }}>
            Sala de Guerra · Ranged
          </h1>
          <span style={{ color: MUTE, fontSize: 13, letterSpacing: 2, textTransform: "uppercase" }}>05/06/2026 · Derrota</span>
        </div>
        <p style={{ color: MUTE, fontSize: 13, marginTop: 0, marginBottom: 22 }}>
          Desempenho de cada player como <b style={{ color: PARCH }}>% da régua do core</b> (Tripaloska + Infa). 100% = empatou com o core.
        </p>

        {/* controls */}
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 18 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: MUTE, letterSpacing: 1 }}>
            PLAYER (RADAR)
            <select value={sel} onChange={(e) => setSel(e.target.value)}>
              {PLAYERS.map((p) => <option key={p.nome} value={p.nome}>{p.nome}{p.core ? " ★" : ""}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: MUTE, letterSpacing: 1 }}>
            MÉTRICA (RANKING)
            <select value={metricBar} onChange={(e) => setMetricBar(e.target.value)}>
              {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
        </div>

        {/* big numbers for selected player */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 22 }}>
          {METRICS.map((m) => {
            const v = pct(selPlayer[m.key], m);
            return (
              <div key={m.key} className="card" style={{ padding: "14px 18px", minWidth: 150, flex: "1 1 150px" }}>
                <div style={{ fontSize: 11, color: MUTE, letterSpacing: 1.5, textTransform: "uppercase" }}>{m.label}</div>
                <div style={{ fontFamily: "'Cinzel',serif", fontWeight: 800, fontSize: 28, color: colorFor(v) }}>{v.toFixed(0)}%</div>
                <div style={{ fontSize: 11, color: MUTE }}>{v >= 100 ? "acima do core" : "abaixo do core"}</div>
              </div>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* radar */}
          <div className="card" style={{ padding: "18px 14px 8px" }}>
            <div style={{ fontFamily: "'Cinzel',serif", color: PARCH, fontSize: 16, marginBottom: 6, paddingLeft: 8 }}>{sel} vs Core</div>
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={radarData} outerRadius="72%">
                <PolarGrid stroke="#3a2c18" />
                <PolarAngleAxis dataKey="metric" tick={{ fill: PARCH, fontSize: 12, fontFamily: "Chakra Petch" }} />
                <PolarRadiusAxis domain={[0, 200]} tick={{ fill: MUTE, fontSize: 10 }} stroke="#3a2c18" />
                <Radar name="Core (100%)" dataKey="core" stroke={MUTE} fill={MUTE} fillOpacity={0.12} strokeDasharray="4 4" />
                <Radar name={sel} dataKey="show" stroke={GOLD} fill={GOLD} fillOpacity={0.35} strokeWidth={2} />
                <Tooltip
                  contentStyle={{ background: BG2, border: "1px solid #4a3a20", borderRadius: 8, color: PARCH }}
                  formatter={(val, name, p) => name === sel ? [`${p.payload.real.toFixed(0)}%`, sel] : [`${val}%`, name]}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* ranking bar */}
          <div className="card" style={{ padding: "18px 14px 8px" }}>
            <div style={{ fontFamily: "'Cinzel',serif", color: PARCH, fontSize: 16, marginBottom: 6, paddingLeft: 8 }}>
              Ranking · {mBar.label}
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={bars} layout="vertical" margin={{ left: 18, right: 24 }}>
                <CartesianGrid horizontal={false} stroke="#2a2012" />
                <XAxis type="number" tick={{ fill: MUTE, fontSize: 11 }} stroke="#3a2c18" />
                <YAxis type="category" dataKey="nome" width={96} tick={{ fill: PARCH, fontSize: 11, fontFamily: "Chakra Petch" }} stroke="#3a2c18" />
                <ReferenceLine x={100} stroke={PARCH} strokeDasharray="5 4" label={{ value: "core", fill: MUTE, fontSize: 10, position: "top" }} />
                <Tooltip
                  cursor={{ fill: "rgba(227,176,75,.06)" }}
                  contentStyle={{ background: BG2, border: "1px solid #4a3a20", borderRadius: 8, color: PARCH }}
                  formatter={(v) => [`${v.toFixed(0)}%`, mBar.label]}
                />
                <Bar dataKey="val" radius={[0, 4, 4, 0]}>
                  {bars.map((b, i) => (
                    <Cell key={i} fill={b.me ? "#ffffff" : colorFor(b.val)} fillOpacity={b.me ? 1 : 0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <p style={{ color: MUTE, fontSize: 11.5, marginTop: 18, lineHeight: 1.6 }}>
          ★ = player core · barra branca = player selecionado no radar · <b style={{ color: GOLD }}>dourado</b> = ≥ core, <b style={{ color: CRIM }}>vermelho</b> = abaixo.
          “Sobrevivência” é o tempo morto invertido (morrer menos → % maior). No radar, valores acima de 200% aparecem no teto; o número real está no card e no tooltip.
        </p>
      </div>
    </div>
  );
}
