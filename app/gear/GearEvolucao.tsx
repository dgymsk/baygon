"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { C } from "@/lib/theme";
import type { GearAtual, PontoGear } from "@/lib/garmothStats";

const AZUL = "#6f93b5"; // azul-aço dessaturado (único tom frio p/ separar a série DP)
const LINHAS = [
  { key: "gs", label: "GS", cor: C.verde },
  { key: "ap", label: "AP", cor: C.branco },
  { key: "aap", label: "AAP", cor: C.mute },
  { key: "dp", label: "DP", cor: AZUL },
] as const;
const ESPEC = (s: string | null) => (s === "succ" ? "Sucessão" : s === "awk" ? "Awakening" : s || "");
const fmtDia = (iso: string) => iso.slice(5, 10).split("-").reverse().join("/");
const haQuanto = (iso: string | null) => {
  if (!iso) return "";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  return h < 1 ? "agora há pouco" : h < 24 ? `há ${h}h` : `há ${Math.floor(h / 24)}d`;
};

export default function GearEvolucao({ ranking, minData, maxData }: { ranking: GearAtual[]; minData: string | null; maxData: string | null }) {
  const [escopo, setEscopo] = useState<"player" | "guilda">("player");
  const [player, setPlayer] = useState(ranking[0]?.nome_familia ?? "");
  const [from, setFrom] = useState(minData ?? "");
  const [to, setTo] = useState(maxData ?? "");
  const [serie, setSerie] = useState<PontoGear[]>([]);
  const [loading, setLoading] = useState(false);
  const [vis, setVis] = useState<Record<string, boolean>>({ gs: true, ap: true, aap: true, dp: true });

  useEffect(() => {
    if (escopo !== "player" || !player) { setSerie([]); return; }
    const p = new URLSearchParams({ player });
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    setLoading(true);
    fetch(`/api/garmoth/evolucao?${p}`).then((r) => r.json()).then((d) => setSerie(d.serie ?? [])).catch(() => setSerie([])).finally(() => setLoading(false));
  }, [escopo, player, from, to]);

  const data = useMemo(() => serie.map((pt) => ({ ...pt, label: fmtDia(pt.capturado) })), [serie]);
  const atual = ranking.find((r) => r.nome_familia === player) ?? null;
  const comGs = serie.filter((p) => p.gs != null);
  const delta = comGs.length >= 2 ? (comGs[comGs.length - 1].gs as number) - (comGs[0].gs as number) : null;
  const maxGs = Math.max(1, ...ranking.map((r) => r.gs ?? 0));

  const box = { background: C.inputBg, color: C.texto, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "7px 11px", fontFamily: "inherit", fontSize: 13.5, outline: "none" } as const;
  const chip = (on: boolean, cor: string) => ({ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, border: `1px solid ${on ? cor : C.border2}`, background: on ? "rgba(255,255,255,.03)" : "transparent", color: on ? cor : C.mute, padding: "4px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" } as const);
  const Quad = ({ lbl, v, cor }: { lbl: string; v: number | null | undefined; cor: string }) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 62, border: `1px solid ${C.border2}`, borderRadius: 10, padding: "8px 12px", background: C.inputBg }}>
      <span style={{ fontSize: 10, color: C.mute, letterSpacing: 1 }}>{lbl}</span>
      <b style={{ fontSize: 22, color: cor, fontFamily: "'Share Tech Mono', monospace" }}>{v ?? "—"}</b>
    </div>
  );

  const nav = (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      <Link className="navlink" href="/painel">← Painel</Link>
      <Link className="navlink" href="/membros">Membros</Link>
      <Link className="navlink" href="/evolucao">Evolução</Link>
    </div>
  );

  return (
    <div style={{ background: C.bgGlow, minHeight: "100vh", padding: "28px 24px", fontFamily: "'Chakra Petch', system-ui, sans-serif", color: C.texto }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600;700&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}
        select:focus,input:focus{border-color:${C.verde}}`}</style>

      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 28, letterSpacing: 1, margin: 0, color: C.amarelo }}>
            BAYGON <span style={{ color: C.mute, fontSize: 14, letterSpacing: 2 }}>· GEAR</span>
          </h1>
          {nav}
        </div>
        <p style={{ color: C.mute, fontSize: 12.5, margin: "2px 0 18px" }}>
          Evolução de gear pelo Garmoth. <b style={{ color: C.verde }}>GS = (AP+AAP)/2 + DP</b>. Os pontos surgem conforme o gear muda (lido a cada 2h).
        </p>

        {/* toggle de escopo */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(["player", "guilda"] as const).map((e) => (
            <button key={e} onClick={() => setEscopo(e)}
              style={{ borderRadius: 8, border: `1px solid ${escopo === e ? C.verde : C.border2}`, background: escopo === e ? C.verdeTint : "transparent", color: escopo === e ? C.verde : C.mute, padding: "8px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
              {e === "player" ? "Por player (evolução)" : "Ranking da guilda"}
            </button>
          ))}
        </div>

        {ranking.length === 0 ? (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 28, color: C.mute, fontSize: 14 }}>
            Nenhum gear carregado ainda. Cole as URLs do Garmoth no <Link href="/membros" style={{ color: C.verde }}>Membros</Link> e clique <b style={{ color: C.texto }}>⟳ Garmoth</b> (ou espere o refresh de 2h).
          </div>
        ) : escopo === "player" ? (
          <>
            {/* controles + stats do player */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: C.mute, letterSpacing: 1 }}>PLAYER
                <select value={player} onChange={(e) => setPlayer(e.target.value)} style={{ ...box, cursor: "pointer", minWidth: 190 }}>
                  {ranking.map((r) => <option key={r.nome_familia} value={r.nome_familia}>{r.nome_familia}{r.gs != null ? ` — GS ${r.gs}` : ""}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: C.mute, letterSpacing: 1 }}>DE
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={{ ...box, colorScheme: "dark" }} /></label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: C.mute, letterSpacing: 1 }}>ATÉ
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={{ ...box, colorScheme: "dark" }} /></label>
            </div>

            {atual && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
                <Quad lbl="GS" v={atual.gs} cor={C.verde} />
                <Quad lbl="AP" v={atual.ap} cor={C.verdeBright} />
                <Quad lbl="AAP" v={atual.aap} cor={C.laranja} />
                <Quad lbl="DP" v={atual.dp} cor={AZUL} />
                <div style={{ marginLeft: 6, fontSize: 12.5, color: C.mute, lineHeight: 1.7 }}>
                  <div><b style={{ color: C.texto }}>{atual.char_name || player}</b> {atual.classe_bdo ? `· ${atual.classe_bdo}` : ""} {atual.spec ? `· ${ESPEC(atual.spec)}` : ""} {atual.level ? `· nv ${atual.level}` : ""}</div>
                  <div>{delta != null && <span style={{ color: delta >= 0 ? C.verde : C.vermelho }}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} GS no período</span>} {atual.atualizado ? <span suppressHydrationWarning style={{ color: C.borderSoft, marginLeft: delta != null ? 8 : 0 }}>atualizado {haQuanto(atual.atualizado)}</span> : null}</div>
                </div>
              </div>
            )}

            {/* toggles de linha */}
            <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              {LINHAS.map((l) => <button key={l.key} onClick={() => setVis((v) => ({ ...v, [l.key]: !v[l.key] }))} style={chip(vis[l.key], l.cor)}><span style={{ width: 9, height: 9, borderRadius: 2, background: l.cor, opacity: vis[l.key] ? 1 : 0.3 }} />{l.label}</button>)}
            </div>

            <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: "18px 12px 10px" }}>
              {loading ? <p style={{ color: C.mute, padding: 24 }}>Carregando…</p>
                : data.length === 0 ? <p style={{ color: C.mute, padding: 24 }}>Sem histórico de gear ainda para <b style={{ color: C.texto }}>{player}</b>. Os pontos aparecem quando o gear muda (Garmoth lido a cada 2h).</p>
                : (
                  <ResponsiveContainer width="100%" height={480}>
                    <ComposedChart data={data} margin={{ top: 10, right: 26, left: 6, bottom: 4 }}>
                      <defs>
                        <linearGradient id="gsFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={C.verde} stopOpacity={0.28} />
                          <stop offset="100%" stopColor={C.verde} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#202020" />
                      <XAxis dataKey="label" tick={{ fill: C.mute, fontSize: 11 }} stroke="#2c2c2c" />
                      <YAxis domain={[(min: number) => Math.floor(min * 0.94), (max: number) => Math.ceil(max * 1.04)]} tick={{ fill: C.mute, fontSize: 11 }} stroke="#2c2c2c" width={44} />
                      <Tooltip contentStyle={{ background: C.tooltipBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto }} labelStyle={{ color: C.texto }} formatter={(v, n) => [v as number, String(n).toUpperCase()]} />
                      {vis.gs && <Area type="monotone" dataKey="gs" name="gs" stroke={C.verde} strokeWidth={3} fill="url(#gsFill)" dot={{ r: 3, fill: C.verde }} activeDot={{ r: 6 }} />}
                      {vis.ap && <Line type="monotone" dataKey="ap" name="ap" stroke={C.branco} strokeWidth={2} dot={{ r: 2.5 }} />}
                      {vis.aap && <Line type="monotone" dataKey="aap" name="aap" stroke={C.mute} strokeWidth={2} dot={{ r: 2.5 }} />}
                      {vis.dp && <Line type="monotone" dataKey="dp" name="dp" stroke={AZUL} strokeWidth={2} dot={{ r: 2.5 }} />}
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
            </div>
            <p style={{ color: C.mute, fontSize: 11.5, marginTop: 12 }}>Cada ponto = uma captura em que o AP/AAP/DP mudou. Clique nas legendas pra mostrar/esconder linhas.</p>
          </>
        ) : (
          /* RANKING da guilda (atual) */
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: "12px 8px" }}>
            {ranking.map((r, i) => (
              <div key={r.nome_familia} style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 10px", borderBottom: i < ranking.length - 1 ? `1px solid ${C.borderSoft}` : "none" }}>
                <span style={{ width: 26, textAlign: "right", color: i < 3 ? C.amarelo : C.mute, fontWeight: 700, fontFamily: "'Share Tech Mono', monospace" }}>{i + 1}</span>
                <div style={{ width: 168, minWidth: 168 }}>
                  <div style={{ color: C.texto, fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.nome_familia}</div>
                  <div style={{ color: C.mute, fontSize: 10.5 }}>{r.classe_bdo || "—"}{r.spec ? ` · ${ESPEC(r.spec)}` : ""}</div>
                </div>
                <div style={{ flex: 1, minWidth: 90, height: 16, background: C.inputBg, borderRadius: 5, overflow: "hidden", border: `1px solid ${C.borderSoft}` }}>
                  <div style={{ width: `${Math.round(((r.gs ?? 0) / maxGs) * 100)}%`, height: "100%", background: `linear-gradient(90deg, ${C.verde}, ${C.verdeBright})` }} />
                </div>
                <b style={{ width: 54, textAlign: "right", color: C.verde, fontSize: 15, fontFamily: "'Share Tech Mono', monospace" }}>{r.gs ?? "—"}</b>
                <span style={{ width: 128, textAlign: "right", color: C.mute, fontSize: 11 }}>
                  <span style={{ color: C.branco }}>{r.ap ?? "?"}</span>/<span style={{ color: C.mute }}>{r.aap ?? "?"}</span> · <span style={{ color: AZUL }}>{r.dp ?? "?"}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
