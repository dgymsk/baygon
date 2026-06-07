"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PlayerRow } from "@/lib/players";
import { C } from "@/lib/theme";

const GUILD: Record<string, { label: string; icon: string }> = {
  MANI: { label: "Manicômio", icon: "/guilds/manicomio.png" },
  RESO: { label: "Resonance", icon: "/guilds/resonance.png" },
};

type Status = { kind: "idle" | "saving" | "ok" | "err"; msg?: string };
const editKey = (p: PlayerRow) => JSON.stringify([p.grupo, p.classe_bdo ?? "", p.is_core, p.guilda]);

export default function MembrosTable({ initial }: { initial: PlayerRow[] }) {
  const [rows, setRows] = useState<PlayerRow[]>(initial);
  const [baseline, setBaseline] = useState<Map<string, string>>(
    () => new Map(initial.map((p) => [p.nome_familia, editKey(p)])),
  );
  const [tab, setTab] = useState<"ativos" | "ex">("ativos");
  const [q, setQ] = useState("");
  const [gf, setGf] = useState<"" | "MANI" | "RESO">("");
  const [novo, setNovo] = useState({ nome: "", grupo: "", classe: "", guilda: "MANI" });
  const [arq, setArq] = useState<string | null>(null); // nome em processo de arquivar
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const grupos = useMemo(() => [...new Set(rows.map((r) => r.grupo))].sort(), [rows]);
  const classes = useMemo(() => [...new Set(rows.map((r) => r.classe_bdo).filter(Boolean) as string[])].sort(), [rows]);
  const dirty = useMemo(() => rows.filter((r) => baseline.get(r.nome_familia) !== editKey(r)), [rows, baseline]);

  const ativos = useMemo(() => rows.filter((r) => r.ativo), [rows]);
  const ex = useMemo(() => rows.filter((r) => !r.ativo), [rows]);
  const nMani = ativos.filter((r) => r.guilda === "MANI").length;
  const nReso = ativos.length - nMani;

  const filtered = useMemo(() => {
    const base = tab === "ativos" ? ativos : ex;
    const s = q.trim().toLowerCase();
    return base.filter((r) => {
      const isDirty = baseline.get(r.nome_familia) !== editKey(r);
      if (gf && r.guilda !== gf && !isDirty) return false;
      if (!s) return true;
      return r.nome_familia.toLowerCase().includes(s) || r.grupo.toLowerCase().includes(s) || (r.classe_bdo ?? "").toLowerCase().includes(s);
    });
  }, [tab, ativos, ex, q, gf, baseline]);

  const patch = (nome: string, campo: Partial<PlayerRow>) =>
    setRows((prev) => prev.map((r) => (r.nome_familia === nome ? { ...r, ...campo } : r)));

  async function refresh() {
    const data = await fetch("/api/players").then((r) => r.json());
    const ps: PlayerRow[] = data.players ?? [];
    setRows(ps);
    setBaseline(new Map(ps.map((p) => [p.nome_familia, editKey(p)])));
  }

  async function salvar() {
    if (!dirty.length) return;
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/players", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updates: dirty }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha");
      setBaseline(new Map(rows.map((p) => [p.nome_familia, editKey(p)])));
      setStatus({ kind: "ok", msg: `${dirty.length} alteração(ões) salva(s).` });
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }

  async function adicionar() {
    const nome = novo.nome.trim();
    if (!nome) return;
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/players", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome_familia: nome, grupo: novo.grupo, classe_bdo: novo.classe, guilda: novo.guilda }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha");
      const g = novo.guilda;
      setNovo({ nome: "", grupo: "", classe: "", guilda: g });
      await refresh();
      setTab("ativos");
      if (gf && gf !== g) setGf("");
      setStatus({ kind: "ok", msg: `"${nome}" adicionado.` });
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }

  async function acao(nome: string, init: RequestInit, msg: string) {
    setStatus({ kind: "saving" });
    try {
      const res = await fetch(`/api/players/${encodeURIComponent(nome)}`, init);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha");
      await refresh();
      setStatus({ kind: "ok", msg });
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }
  const arquivar = (nome: string, tipo: "Saiu" | "Kikado") => { setArq(null); acao(nome, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "arquivar", saida_tipo: tipo }) }, `"${nome}" → ex-membro (${tipo}).`); };
  const reativar = (nome: string) => acao(nome, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reativar" }) }, `"${nome}" reativado.`);
  const excluir = (nome: string) => { if (confirm(`Excluir "${nome}" DEFINITIVAMENTE? (só funciona sem histórico de war)`)) acao(nome, { method: "DELETE" }, `"${nome}" excluído.`); };

  const inp = { background: C.inputBg, color: C.texto, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 8px", fontFamily: "inherit", fontSize: 13, outline: "none", width: "100%" } as const;
  const chip = (on: boolean) => ({ borderRadius: 8, border: `1px solid ${on ? C.verde : C.border}`, background: on ? C.verdeTint : C.inputBg, color: on ? C.verde : C.mute, padding: "6px 12px", fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 } as const);
  const btn = (color: string = C.verde) => ({ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" } as const);

  const Stat = ({ children }: { children: React.ReactNode }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, border: `1px solid ${C.borderSoft}`, background: C.inputBg, fontSize: 12, color: C.mute }}>{children}</span>
  );

  return (
    <div style={{ background: C.bgGlow, minHeight: "100vh", padding: "26px 24px", fontFamily: "'Chakra Petch', system-ui, sans-serif", color: C.texto }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&family=Chakra+Petch:wght@400;500;600;700&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}
        input:focus,select:focus{border-color:${C.verde}}
        table{border-collapse:collapse;width:100%} th,td{padding:8px 10px;text-align:left;border-bottom:1px solid ${C.borderSoft};font-size:13px}
        th{color:${C.mute};font-size:10.5px;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;position:sticky;top:0;background:${C.surfaceSolid}}
        tbody tr:hover{background:rgba(126,224,70,.04)}
        input[type=checkbox]{accent-color:${C.verde}}
      `}</style>

      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/mascot.png" alt="BAYGON" width={40} height={40} style={{ filter: "drop-shadow(0 0 10px rgba(126,224,70,.45))" }} />
            <div>
              <h1 style={{ fontFamily: "'Cinzel',serif", fontWeight: 800, fontSize: 26, letterSpacing: 1, margin: 0, color: C.amarelo }}>
                BAYGON <span style={{ color: C.mute, fontSize: 14, fontFamily: "inherit", letterSpacing: 2 }}>· MEMBROS</span>
              </h1>
              <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                <Stat>{rows.length} no total</Stat>
                <Stat><b style={{ color: C.verde }}>{ativos.length}</b> ativos</Stat>
                <Stat>{ex.length} ex-membros</Stat>
                <Stat><img src={GUILD.MANI.icon} alt="" width={14} height={14} style={{ borderRadius: 3 }} /> {nMani}</Stat>
                <Stat><img src={GUILD.RESO.icon} alt="" width={14} height={14} style={{ borderRadius: 3 }} /> {nReso}</Stat>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <Link className="navlink" href="/painel">← Painel</Link>
            <Link className="navlink" href="/evolucao">Evolução</Link>
            <Link className="navlink" href="/config">⚙ Config</Link>
          </div>
        </div>

        {/* tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: `1px solid ${C.border}` }}>
          {([["ativos", `Ativos (${ativos.length})`], ["ex", `Ex-membros (${ex.length})`]] as const).map(([k, label]) => (
            <button key={k} onClick={() => { setTab(k); setArq(null); }}
              style={{ background: "none", border: "none", borderBottom: `2px solid ${tab === k ? C.verde : "transparent"}`, color: tab === k ? C.verde : C.mute, padding: "8px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: -1 }}>
              {label}
            </button>
          ))}
        </div>

        {/* adicionar (só na aba ativos) */}
        {tab === "ativos" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14, padding: "12px 14px", border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface }}>
            <span style={{ color: C.mute, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" }}>Adicionar</span>
            <input placeholder="Nome de família" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} style={{ ...inp, width: 170 }} />
            <input placeholder="Grupo" list="dl-grupos" value={novo.grupo} onChange={(e) => setNovo({ ...novo, grupo: e.target.value })} style={{ ...inp, width: 130 }} />
            <input placeholder="Classe" list="dl-classes" value={novo.classe} onChange={(e) => setNovo({ ...novo, classe: e.target.value })} style={{ ...inp, width: 130 }} />
            <select value={novo.guilda} onChange={(e) => setNovo({ ...novo, guilda: e.target.value })} style={{ ...inp, width: 130, cursor: "pointer" }}>
              <option value="MANI">Manicômio</option>
              <option value="RESO">Resonance</option>
            </select>
            <button onClick={adicionar} style={{ ...btn(C.amarelo), padding: "7px 16px", fontSize: 13 }}>+ Adicionar</button>
          </div>
        )}

        {/* toolbar */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input placeholder="🔎 buscar nome / grupo / classe" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inp, width: 250 }} />
            <button onClick={() => setGf("")} style={chip(gf === "")}>Todas</button>
            <button onClick={() => setGf("MANI")} style={chip(gf === "MANI")}><img src={GUILD.MANI.icon} alt="" width={16} height={16} style={{ borderRadius: 3 }} />MANI</button>
            <button onClick={() => setGf("RESO")} style={chip(gf === "RESO")}><img src={GUILD.RESO.icon} alt="" width={16} height={16} style={{ borderRadius: 3 }} />RESO</button>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {status.kind === "ok" && <span style={{ color: C.verde, fontSize: 13 }}>✓ {status.msg}</span>}
            {status.kind === "err" && <span style={{ color: C.vermelho, fontSize: 13 }}>⚠ {status.msg}</span>}
            <button onClick={salvar} disabled={!dirty.length || status.kind === "saving"} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: dirty.length ? C.verdeTint : C.inputBg, color: C.verde, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: dirty.length ? "pointer" : "default", opacity: dirty.length ? 1 : 0.5 }}>
              {status.kind === "saving" ? "Salvando…" : `Salvar${dirty.length ? ` (${dirty.length})` : ""}`}
            </button>
          </div>
        </div>

        {/* tabela */}
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", background: C.surface }}>
          <table>
            <thead>
              <tr>
                <th>Família</th><th>Grupo</th><th>Classe</th>
                <th style={{ textAlign: "center" }}>Guilda</th>
                {tab === "ativos" ? <th style={{ textAlign: "center" }}>Core</th> : <th>Saída</th>}
                <th style={{ textAlign: "center" }}>Wars</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isDirty = baseline.get(r.nome_familia) !== editKey(r);
                const g = GUILD[r.guilda] ?? GUILD.MANI;
                return (
                  <tr key={r.nome_familia} style={{ background: isDirty ? "rgba(255,210,30,.06)" : undefined }}>
                    <td style={{ color: C.texto, fontWeight: 600 }}>{r.nome_familia}{isDirty ? <span style={{ color: C.amarelo }}> •</span> : null}</td>
                    <td><input list="dl-grupos" value={r.grupo} onChange={(e) => patch(r.nome_familia, { grupo: e.target.value })} style={{ ...inp, width: 120 }} /></td>
                    <td><input list="dl-classes" value={r.classe_bdo ?? ""} onChange={(e) => patch(r.nome_familia, { classe_bdo: e.target.value })} style={{ ...inp, width: 120 }} /></td>
                    <td style={{ textAlign: "center" }}>
                      <button onClick={() => patch(r.nome_familia, { guilda: r.guilda === "MANI" ? "RESO" : "MANI" })} title={`${g.label} — clique pra trocar`}
                        style={{ background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, color: C.texto, fontSize: 12 }}>
                        <img src={g.icon} alt={r.guilda} width={22} height={22} style={{ borderRadius: 4 }} />{r.guilda}
                      </button>
                    </td>
                    {tab === "ativos"
                      ? <td style={{ textAlign: "center" }}><input type="checkbox" checked={r.is_core} onChange={(e) => patch(r.nome_familia, { is_core: e.target.checked })} /></td>
                      : <td style={{ color: C.mute, fontSize: 12 }}>{r.saida_tipo === "Kikado" ? <span style={{ color: C.vermelho }}>Kikado</span> : "Saiu"}{r.saida_data ? ` · ${r.saida_data.split("-").reverse().join("/")}` : ""}</td>}
                    <td style={{ textAlign: "center", color: C.mute }}>{r.n_wars}</td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
                        {tab === "ativos" ? (
                          arq === r.nome_familia ? (
                            <>
                              <span style={{ color: C.mute, fontSize: 11 }}>motivo:</span>
                              <button onClick={() => arquivar(r.nome_familia, "Saiu")} style={btn(C.amarelo)}>Saiu</button>
                              <button onClick={() => arquivar(r.nome_familia, "Kikado")} style={btn(C.vermelho)}>Kikado</button>
                              <button onClick={() => setArq(null)} style={{ background: "none", border: "none", color: C.mute, cursor: "pointer" }}>✕</button>
                            </>
                          ) : (
                            <button onClick={() => setArq(r.nome_familia)} style={btn(C.mute)}>Arquivar</button>
                          )
                        ) : (
                          <button onClick={() => reativar(r.nome_familia)} style={btn(C.verde)}>Reativar</button>
                        )}
                        {r.n_wars === 0
                          ? <button title="excluir definitivamente" onClick={() => excluir(r.nome_familia)} style={{ background: "none", border: "none", color: C.vermelho, cursor: "pointer", fontSize: 15 }}>🗑</button>
                          : <span title="tem histórico — arquive em vez de excluir" style={{ color: C.borderSoft, fontSize: 12, width: 18, display: "inline-block", textAlign: "center" }}>—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ color: C.mute, textAlign: "center", padding: 24 }}>Nenhum membro {tab === "ex" ? "arquivado" : "aqui"}{q || gf ? " com esse filtro" : ""}.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <datalist id="dl-grupos">{grupos.map((g) => <option key={g} value={g} />)}</datalist>
        <datalist id="dl-classes">{classes.map((c) => <option key={c} value={c} />)}</datalist>

        <p style={{ color: C.mute, fontSize: 11.5, marginTop: 14, lineHeight: 1.6 }}>
          • = alteração não salva · clique no ícone da guilda pra alternar MANI/RESO · <b style={{ color: C.amarelo }}>Arquivar</b> manda pra Ex-membros com o motivo (preserva histórico) ·
          🗑 (excluir definitivo) só aparece pra quem tem 0 wars.
        </p>
      </div>
    </div>
  );
}
