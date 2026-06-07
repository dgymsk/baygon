"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine, Cell,
  ResponsiveContainer, Tooltip,
} from "recharts";
import type { DiscrepanciaRow, Populacao, WarInfo } from "@/lib/score";

const GOLD = "#34e06a", CRIM = "#ff4d4d", PARCH = "#d6f0dd", MUTE = "#6f9a80", BG2 = "#07120c";
const LENTES: { key: Populacao; label: string }[] = [
  { key: "core_grupo", label: "Core do grupo" },
  { key: "grupo", label: "Grupo inteiro" },
  { key: "guilda", label: "Guilda inteira" },
];

export default function Painel({ wars }: { wars: WarInfo[] }) {
  const [warId, setWarId] = useState<number | null>(wars[0]?.war_id ?? null);
  const [rows, setRows] = useState<DiscrepanciaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [grupo, setGrupo] = useState("");
  const [lens, setLens] = useState<Populacao>("core_grupo");
  const [player, setPlayer] = useState("");
  const [metricBar, setMetricBar] = useState("");

  useEffect(() => {
    if (warId == null) return;
    setLoading(true);
    fetch(`/api/wars/${warId}/discrepancia`)
      .then((r) => r.json())
      .then((d) => setRows(d.discrepancia ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [warId]);

  const grupos = useMemo(() => [...new Set(rows.map((r) => r.grupo))].sort(), [rows]);
  useEffect(() => {
    if (grupos.length && !grupos.includes(grupo)) setGrupo(grupos.includes("Bolo") ? "Bolo" : grupos[0]);
  }, [grupos, grupo]);

  const lentesDisp = useMemo(() => {
    const s = new Set(rows.filter((r) => r.grupo === grupo).map((r) => r.populacao));
    return LENTES.filter((l) => s.has(l.key));
  }, [rows, grupo]);
  useEffect(() => {
    if (lentesDisp.length && !lentesDisp.some((l) => l.key === lens)) setLens(lentesDisp[0].key);
  }, [lentesDisp, lens]);

  const filtered = useMemo(
    () => rows.filter((r) => r.grupo === grupo && r.populacao === lens),
    [rows, grupo, lens],
  );
  const metrics = useMemo(() => {
    const m = new Map<string, { metrica: string; rotulo: string; direcao: string }>();
    for (const r of filtered) if (!m.has(r.metrica)) m.set(r.metrica, { metrica: r.metrica, rotulo: r.rotulo, direcao: r.direcao });
    return [...m.values()];
  }, [filtered]);
  const players = useMemo(() => [...new Set(filtered.map((r) => r.nome_familia))].sort(), [filtered]);

  useEffect(() => { if (players.length && !players.includes(player)) setPlayer(players[0]); }, [players, player]);
  useEffect(() => { if (metrics.length && !metrics.some((m) => m.metrica === metricBar)) setMetricBar(metrics[0].metrica); }, [metrics, metricBar]);

  const radarData = metrics.map((m) => {
    const row = filtered.find((r) => r.nome_familia === player && r.metrica === m.metrica);
    const pct = row?.pct ?? 0;
    return { metric: m.rotulo, real: pct, show: Math.min(pct, 200) };
  });
  const mBar = metrics.find((m) => m.metrica === metricBar);
  const bars = filtered
    .filter((r) => r.metrica === metricBar)
    .map((r) => ({ nome: r.nome_familia, val: r.pct ?? 0, me: r.nome_familia === player }))
    .sort((a, b) => b.val - a.val);

  const colorFor = (v: number) => (v >= 100 ? GOLD : CRIM);
  const war = wars.find((w) => w.war_id === warId);
  const fmtData = (iso?: string) => (iso ? iso.split("-").reverse().join("/") : "");

  const Select = ({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{ background: "#06100b", color: PARCH, border: "1px solid #2a5a3c", borderRadius: 8, padding: "8px 12px", fontFamily: "inherit", fontSize: 14, outline: "none", cursor: "pointer" }}>
      {children}
    </select>
  );
  const Label = ({ children, value }: { children: React.ReactNode; value: React.ReactNode }) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: MUTE, letterSpacing: 1 }}>
      {children}{value}
    </label>
  );

  return (
    <div style={{ background: "radial-gradient(1200px 600px at 70% -10%, #0c2417 0%, #050a07 60%)", minHeight: "100vh", padding: "28px 24px", fontFamily: "'Chakra Petch', system-ui, sans-serif", color: PARCH }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        .card{background:linear-gradient(180deg,#0a1610 0%,#07120c 100%);border:1px solid #1c3a28;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.5), inset 0 1px 0 rgba(52,224,106,.08);}
        select:focus{border-color:${GOLD}}
        a.navlink{color:${MUTE};text-decoration:none;font-size:13px;letter-spacing:1px}
        a.navlink:hover{color:${GOLD}}
      `}</style>

      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
          <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 30, letterSpacing: 1, margin: 0, color: GOLD, textShadow: "0 2px 12px rgba(52,224,106,.25)" }}>
            BAYGON{grupo ? ` · ${grupo}` : ""}
          </h1>
          <div style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
            <Link className="navlink" href="/evolucao">Evolução</Link>
            <Link className="navlink" href="/membros">Membros</Link>
            <Link className="navlink" href="/config">⚙ Configuração</Link>
            <span style={{ color: MUTE, fontSize: 13, letterSpacing: 2, textTransform: "uppercase" }}>
              {fmtData(war?.data)}{war?.resultado ? ` · ${war.resultado}` : ""}
            </span>
          </div>
        </div>
        <p style={{ color: MUTE, fontSize: 13, marginTop: 0, marginBottom: 22 }}>
          Desempenho como <b style={{ color: PARCH }}>% da régua</b> ({LENTES.find((l) => l.key === lens)?.label.toLowerCase()}). 100% = empatou com a régua.
        </p>

        {/* controls */}
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 18 }}>
          <Label value={
            <Select value={String(warId ?? "")} onChange={(v) => setWarId(Number(v))}>
              {wars.map((w) => <option key={w.war_id} value={w.war_id}>{fmtData(w.data)} · {w.resultado ?? "?"} ({w.n_players})</option>)}
            </Select>
          }>WAR</Label>
          <Label value={
            <Select value={grupo} onChange={setGrupo}>
              {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
          }>GRUPO</Label>
          <Label value={
            <Select value={lens} onChange={(v) => setLens(v as Populacao)}>
              {lentesDisp.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            </Select>
          }>RÉGUA (LENTE)</Label>
          <Label value={
            <Select value={player} onChange={setPlayer}>
              {players.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          }>PLAYER (RADAR)</Label>
          <Label value={
            <Select value={metricBar} onChange={setMetricBar}>
              {metrics.map((m) => <option key={m.metrica} value={m.metrica}>{m.rotulo}</option>)}
            </Select>
          }>MÉTRICA (RANKING)</Label>
        </div>

        {loading ? (
          <p style={{ color: MUTE }}>Carregando…</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: MUTE }}>Sem dados para este grupo/lente nesta war (ex.: nenhum core do grupo participou).</p>
        ) : (
          <>
            {/* big numbers do player */}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 22 }}>
              {radarData.map((d) => (
                <div key={d.metric} className="card" style={{ padding: "14px 18px", minWidth: 150, flex: "1 1 150px" }}>
                  <div style={{ fontSize: 11, color: MUTE, letterSpacing: 1.5, textTransform: "uppercase" }}>{d.metric}</div>
                  <div style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 28, color: colorFor(d.real) }}>{d.real.toFixed(0)}%</div>
                  <div style={{ fontSize: 11, color: MUTE }}>{d.real >= 100 ? "acima da régua" : "abaixo da régua"}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              {/* radar */}
              <div className="card" style={{ padding: "18px 14px 8px" }}>
                <div style={{ fontFamily: "'Share Tech Mono', monospace", color: PARCH, fontSize: 16, marginBottom: 6, paddingLeft: 8 }}>{player} vs régua</div>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData} outerRadius="72%">
                    <PolarGrid stroke="#1c3a28" />
                    <PolarAngleAxis dataKey="metric" tick={{ fill: PARCH, fontSize: 12 }} />
                    <PolarRadiusAxis domain={[0, 200]} tick={{ fill: MUTE, fontSize: 10 }} stroke="#1c3a28" />
                    <Radar name="régua (100%)" dataKey={() => 100} stroke={MUTE} fill={MUTE} fillOpacity={0.12} strokeDasharray="4 4" />
                    <Radar name={player} dataKey="show" stroke={GOLD} fill={GOLD} fillOpacity={0.35} strokeWidth={2} />
                    <Tooltip contentStyle={{ background: BG2, border: "1px solid #2a5a3c", borderRadius: 8, color: PARCH }}
                      formatter={(_value, _name, item) => [`${((item?.payload?.real as number) ?? 0).toFixed(0)}%`, player]} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              {/* ranking */}
              <div className="card" style={{ padding: "18px 14px 8px" }}>
                <div style={{ fontFamily: "'Share Tech Mono', monospace", color: PARCH, fontSize: 16, marginBottom: 6, paddingLeft: 8 }}>Ranking · {mBar?.rotulo ?? ""}</div>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={bars} layout="vertical" margin={{ left: 18, right: 24 }}>
                    <CartesianGrid horizontal={false} stroke="#142b1d" />
                    <XAxis type="number" tick={{ fill: MUTE, fontSize: 11 }} stroke="#1c3a28" />
                    <YAxis type="category" dataKey="nome" width={96} tick={{ fill: PARCH, fontSize: 11 }} stroke="#1c3a28" />
                    <ReferenceLine x={100} stroke={PARCH} strokeDasharray="5 4" label={{ value: "régua", fill: MUTE, fontSize: 10, position: "top" }} />
                    <Tooltip cursor={{ fill: "rgba(52,224,106,.06)" }}
                      contentStyle={{ background: BG2, border: "1px solid #2a5a3c", borderRadius: 8, color: PARCH }}
                      formatter={(v) => [`${Number(v).toFixed(0)}%`, mBar?.rotulo ?? ""]} />
                    <Bar dataKey="val" radius={[0, 4, 4, 0]}>
                      {bars.map((b, i) => <Cell key={i} fill={b.me ? "#ffffff" : colorFor(b.val)} fillOpacity={b.me ? 1 : 0.85} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}

        <p style={{ color: MUTE, fontSize: 11.5, marginTop: 18, lineHeight: 1.6 }}>
          Barra branca = player selecionado no radar · <b style={{ color: GOLD }}>dourado</b> = ≥ régua, <b style={{ color: CRIM }}>vermelho</b> = abaixo.
          No radar, valores acima de 200% aparecem no teto; o número real está no card e no tooltip. Métricas e cores de cada grupo são definidos em <Link className="navlink" href="/config" style={{ color: GOLD }}>Configuração</Link>.
        </p>
      </div>
    </div>
  );
}
