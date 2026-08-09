"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer,
} from "recharts";
import type { Escopo, PontoEvolucao } from "@/lib/evolucao";

const GOLD = "#cc0000", CRIM = "#8f8f8f", PARCH = "#f2f2f2", MUTE = "#8f8f8f", BG2 = "#141414";
const fmt = (iso: string) => iso.slice(5).split("-").reverse().join("/"); // dd/mm

export default function Evolucao({
  minData, maxData, grupos, players,
}: { minData: string; maxData: string; grupos: string[]; players: string[] }) {
  const [escopo, setEscopo] = useState<Escopo>("geral");
  const [grupo, setGrupo] = useState(grupos.includes("Bolo") ? "Bolo" : grupos[0] ?? "");
  const [player, setPlayer] = useState(players[0] ?? "");
  const [from, setFrom] = useState(minData);
  const [to, setTo] = useState(maxData);
  const [serie, setSerie] = useState<PontoEvolucao[]>([]);
  const [loading, setLoading] = useState(false);

  const valor = escopo === "grupo" ? grupo : escopo === "player" ? player : "";

  useEffect(() => {
    const params = new URLSearchParams({ escopo, from, to });
    if (escopo !== "geral") params.set("valor", valor);
    setLoading(true);
    fetch(`/api/evolucao?${params}`)
      .then((r) => r.json())
      .then((d) => setSerie(d.serie ?? []))
      .catch(() => setSerie([]))
      .finally(() => setLoading(false));
  }, [escopo, valor, from, to]);

  const data = useMemo(() => serie.map((p) => ({ ...p, label: fmt(p.data) })), [serie]);
  const media = useMemo(
    () => (serie.length ? serie.reduce((s, p) => s + p.pct, 0) / serie.length : null),
    [serie],
  );
  const titulo = escopo === "geral" ? "Guilda (geral)" : escopo === "grupo" ? `Grupo ${grupo}` : player;

  const Select = ({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{ background: "#131313", color: PARCH, border: "1px solid #454545", borderRadius: 8, padding: "8px 12px", fontFamily: "inherit", fontSize: 14, outline: "none", cursor: "pointer" }}>
      {children}
    </select>
  );
  const dateInp = { background: "#131313", color: PARCH, border: "1px solid #454545", borderRadius: 8, padding: "7px 10px", fontFamily: "inherit", fontSize: 14, outline: "none", colorScheme: "dark" } as const;
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: MUTE, letterSpacing: 1 }}>{label}{children}</label>
  );

  return (
    <div className="pg" style={{ background: "radial-gradient(1200px 600px at 70% -10%, #241010 0%, #0d0d0d 60%)", minHeight: "100vh", padding: "28px 24px", fontFamily: "'Chakra Petch', system-ui, sans-serif", color: PARCH }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${MUTE};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${GOLD}}
        select:focus,input:focus{border-color:${GOLD}}`}</style>

      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
          <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 30, letterSpacing: 1, margin: 0, color: GOLD }}>
            Evolução · {titulo}
          </h1>
          <div style={{ display: "flex", gap: 16 }}>
            <Link className="navlink" href="/painel">← Painel</Link>
            <Link className="navlink" href="/membros">Membros</Link>
            <Link className="navlink" href="/config">⚙ Config</Link>
          </div>
        </div>
        <p style={{ color: MUTE, fontSize: 13, marginTop: 0, marginBottom: 20 }}>
          Performance ao longo das wars como <b style={{ color: PARCH }}>% da régua do core</b> (média do escopo). 100% = core; abaixo de 80% = zona de atenção.
        </p>

        {/* controles */}
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 20, alignItems: "flex-end" }}>
          <Field label="ESCOPO">
            <Select value={escopo} onChange={(v) => setEscopo(v as Escopo)}>
              <option value="geral">Geral (guilda)</option>
              <option value="grupo">Grupo</option>
              <option value="player">Player</option>
            </Select>
          </Field>
          {escopo === "grupo" && (
            <Field label="GRUPO"><Select value={grupo} onChange={setGrupo}>{grupos.map((g) => <option key={g} value={g}>{g}</option>)}</Select></Field>
          )}
          {escopo === "player" && (
            <Field label="PLAYER"><Select value={player} onChange={setPlayer}>{players.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
          )}
          <Field label="DE"><input type="date" value={from} min={minData} max={to} onChange={(e) => setFrom(e.target.value)} style={dateInp} /></Field>
          <Field label="ATÉ"><input type="date" value={to} min={from} max={maxData} onChange={(e) => setTo(e.target.value)} style={dateInp} /></Field>
        </div>

        <div style={{ border: "1px solid #2c2c2c", borderRadius: 14, background: "linear-gradient(180deg,#1a1a1a,#0f0f0f)", padding: "18px 12px 8px" }}>
          {loading ? (
            <p style={{ color: MUTE, padding: 20 }}>Carregando…</p>
          ) : data.length === 0 ? (
            <p style={{ color: MUTE, padding: 20 }}>Sem dados nesse range/escopo.</p>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={data} margin={{ top: 10, right: 24, left: 4, bottom: 4 }}>
                <CartesianGrid stroke="#202020" />
                <XAxis dataKey="label" tick={{ fill: MUTE, fontSize: 11 }} stroke="#2c2c2c" />
                <YAxis domain={[0, (max: number) => Math.max(110, Math.ceil(max * 1.05))]} tick={{ fill: MUTE, fontSize: 11 }} stroke="#2c2c2c" />
                {/* zona de atenção < 80% */}
                <ReferenceArea y1={0} y2={80} fill={CRIM} fillOpacity={0.06} />
                {/* faixas */}
                <ReferenceLine y={100} stroke={GOLD} strokeWidth={1.5} label={{ value: "core 100%", fill: GOLD, fontSize: 10, position: "insideTopLeft" }} />
                <ReferenceLine y={80} stroke={CRIM} strokeDasharray="5 4" label={{ value: "80% core", fill: CRIM, fontSize: 10, position: "insideBottomLeft" }} />
                {media != null && (
                  <ReferenceLine y={media} stroke={PARCH} strokeDasharray="2 4" label={{ value: `média ${media.toFixed(0)}%`, fill: PARCH, fontSize: 10, position: "insideTopRight" }} />
                )}
                <Tooltip
                  contentStyle={{ background: BG2, border: "1px solid #454545", borderRadius: 8, color: PARCH }}
                  labelStyle={{ color: PARCH }}
                  formatter={(v) => [`${Number(v).toFixed(0)}%`, "performance"]}
                  labelFormatter={(l, p) => { const r = p?.[0]?.payload?.resultado; return `${l}${r ? " · " + r : ""}`; }}
                />
                <Line type="monotone" dataKey="pct" stroke={GOLD} strokeWidth={2.5} dot={{ r: 3, fill: GOLD }} activeDot={{ r: 5 }} name="performance" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <p style={{ color: MUTE, fontSize: 11.5, marginTop: 14, lineHeight: 1.6 }}>
          Cada ponto = uma war. <b style={{ color: GOLD }}>Carmesim 100%</b> = empatou com o core · <b style={{ color: CRIM }}>cinza 80%</b> = piso de atenção ·
          linha clara = média do período ({media != null ? `${media.toFixed(0)}%` : "—"}). Cada % é limitada a 200% (teto, como no radar). Escolha grupo/player e o range acima.
        </p>
      </div>
    </div>
  );
}
