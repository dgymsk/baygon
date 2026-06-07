"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PlayerRow } from "@/lib/players";

const GOLD = "#e3b04b", CRIM = "#bf4234", PARCH = "#e9dcc0", MUTE = "#8a7c5f";

const GUILD: Record<string, { label: string; icon: string }> = {
  MANI: { label: "Manicômio", icon: "/guilds/manicomio.png" },
  RESO: { label: "Resonance", icon: "/guilds/resonance.png" },
};

type Status = { kind: "idle" | "saving" | "ok" | "err"; msg?: string };
const editKey = (p: PlayerRow) => JSON.stringify([p.grupo, p.classe_bdo ?? "", p.is_core, p.ativo, p.guilda]);

export default function MembrosTable({ initial }: { initial: PlayerRow[] }) {
  const [rows, setRows] = useState<PlayerRow[]>(initial);
  const [baseline, setBaseline] = useState<Map<string, string>>(
    () => new Map(initial.map((p) => [p.nome_familia, editKey(p)])),
  );
  const [q, setQ] = useState("");
  const [gf, setGf] = useState<"" | "MANI" | "RESO">("");
  const [novo, setNovo] = useState({ nome: "", grupo: "", classe: "", guilda: "MANI" });
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const grupos = useMemo(() => [...new Set(rows.map((r) => r.grupo))].sort(), [rows]);
  const classes = useMemo(() => [...new Set(rows.map((r) => r.classe_bdo).filter(Boolean) as string[])].sort(), [rows]);
  const dirty = useMemo(() => rows.filter((r) => baseline.get(r.nome_familia) !== editKey(r)), [rows, baseline]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      const isDirty = baseline.get(r.nome_familia) !== editKey(r);
      // não esconde linha com alteração pendente, pra não perder o undo/feedback
      if (gf && r.guilda !== gf && !isDirty) return false;
      if (!s) return true;
      return r.nome_familia.toLowerCase().includes(s) || r.grupo.toLowerCase().includes(s) || (r.classe_bdo ?? "").toLowerCase().includes(s);
    });
  }, [rows, q, gf, baseline]);

  const ativos = rows.filter((r) => r.ativo).length;
  const nMani = rows.filter((r) => r.guilda === "MANI").length;
  const nReso = rows.length - nMani;

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
      const res = await fetch("/api/players", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: dirty }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha");
      setBaseline(new Map(rows.map((p) => [p.nome_familia, editKey(p)])));
      setStatus({ kind: "ok", msg: `${dirty.length} alteração(ões) salva(s).` });
    } catch (e) {
      setStatus({ kind: "err", msg: (e as Error).message });
    }
  }

  async function adicionar() {
    const nome = novo.nome.trim();
    if (!nome) return;
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome_familia: nome, grupo: novo.grupo, classe_bdo: novo.classe, guilda: novo.guilda }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha");
      const guildaAdd = novo.guilda;
      setNovo({ nome: "", grupo: "", classe: "", guilda: novo.guilda });
      await refresh();
      if (gf && gf !== guildaAdd) setGf(""); // pra o novo membro não ficar escondido pelo filtro
      setStatus({ kind: "ok", msg: `"${nome}" adicionado.` });
    } catch (e) {
      setStatus({ kind: "err", msg: (e as Error).message });
    }
  }

  async function excluir(nome: string) {
    if (!confirm(`Excluir "${nome}" definitivamente? (só funciona se não tiver histórico de war)`)) return;
    setStatus({ kind: "saving" });
    try {
      const res = await fetch(`/api/players/${encodeURIComponent(nome)}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha");
      await refresh();
      setStatus({ kind: "ok", msg: `"${nome}" excluído.` });
    } catch (e) {
      setStatus({ kind: "err", msg: (e as Error).message });
    }
  }

  const inp = { background: "#0f0b06", color: PARCH, border: "1px solid #3a2c18", borderRadius: 6, padding: "5px 8px", fontFamily: "inherit", fontSize: 13, outline: "none", width: "100%" } as const;
  const fchip = (on: boolean) => ({ borderRadius: 8, border: `1px solid ${on ? GOLD : "#3a2c18"}`, background: on ? "rgba(227,176,75,.15)" : "#0f0b06", color: on ? GOLD : MUTE, padding: "6px 10px", fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 } as const);

  return (
    <div style={{ background: "radial-gradient(1200px 600px at 70% -10%, #241a10 0%, #0e0a06 60%)", minHeight: "100vh", padding: "28px 24px", fontFamily: "'Chakra Petch', system-ui, sans-serif", color: PARCH }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${MUTE};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${GOLD}}
        input:focus,select:focus{border-color:${GOLD}}
        table{border-collapse:collapse;width:100%} th,td{padding:6px 8px;text-align:left;border-bottom:1px solid #2a2012;font-size:13px}
        th{color:${MUTE};font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:500}
      `}</style>

      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
          <h1 style={{ fontFamily: "'Cinzel', serif", fontWeight: 800, fontSize: 30, letterSpacing: 1, margin: 0, color: GOLD }}>Membros</h1>
          <div style={{ display: "flex", gap: 16 }}>
            <Link className="navlink" href="/painel">← Painel</Link>
            <Link className="navlink" href="/evolucao">Evolução</Link>
            <Link className="navlink" href="/config">⚙ Configuração</Link>
          </div>
        </div>
        <p style={{ color: MUTE, fontSize: 13, marginTop: 0, marginBottom: 18 }}>
          {rows.length} membros · {ativos} ativos · {rows.length - ativos} inativos ·{" "}
          <img src={GUILD.MANI.icon} alt="" width={14} height={14} style={{ verticalAlign: "-2px", borderRadius: 3 }} /> {nMani} ·{" "}
          <img src={GUILD.RESO.icon} alt="" width={14} height={14} style={{ verticalAlign: "-2px", borderRadius: 3 }} /> {nReso}.
          Editar grupo/classe/guilda/core/ativo e <b style={{ color: PARCH }}>Salvar</b>. Remover da guild = desativar (preserva histórico).
        </p>

        {/* adicionar */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16, padding: "12px 14px", border: "1px solid #3a2c18", borderRadius: 12, background: "linear-gradient(180deg,#1c150d,#15100a)" }}>
          <span style={{ color: MUTE, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" }}>Adicionar</span>
          <input placeholder="Nome de família" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} style={{ ...inp, width: 170 }} />
          <input placeholder="Grupo" list="dl-grupos" value={novo.grupo} onChange={(e) => setNovo({ ...novo, grupo: e.target.value })} style={{ ...inp, width: 130 }} />
          <input placeholder="Classe" list="dl-classes" value={novo.classe} onChange={(e) => setNovo({ ...novo, classe: e.target.value })} style={{ ...inp, width: 130 }} />
          <select value={novo.guilda} onChange={(e) => setNovo({ ...novo, guilda: e.target.value })} style={{ ...inp, width: 130, cursor: "pointer" }}>
            <option value="MANI">Manicômio</option>
            <option value="RESO">Resonance</option>
          </select>
          <button onClick={adicionar} style={{ borderRadius: 8, border: "1px solid #4a3a20", background: "#0f0b06", color: GOLD, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Adicionar</button>
        </div>

        {/* toolbar */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input placeholder="🔎 buscar nome / grupo / classe" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inp, width: 250 }} />
            <button onClick={() => setGf("")} style={fchip(gf === "")}>Todas</button>
            <button onClick={() => setGf("MANI")} style={fchip(gf === "MANI")}><img src={GUILD.MANI.icon} alt="" width={16} height={16} style={{ borderRadius: 3 }} />MANI</button>
            <button onClick={() => setGf("RESO")} style={fchip(gf === "RESO")}><img src={GUILD.RESO.icon} alt="" width={16} height={16} style={{ borderRadius: 3 }} />RESO</button>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {status.kind === "ok" && <span style={{ color: GOLD, fontSize: 13 }}>✓ {status.msg}</span>}
            {status.kind === "err" && <span style={{ color: CRIM, fontSize: 13 }}>⚠ {status.msg}</span>}
            <button onClick={salvar} disabled={!dirty.length || status.kind === "saving"} style={{ borderRadius: 8, border: "1px solid #4a3a20", background: dirty.length ? "rgba(227,176,75,.15)" : "#0f0b06", color: GOLD, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: dirty.length ? "pointer" : "default", opacity: dirty.length ? 1 : 0.5 }}>
              {status.kind === "saving" ? "Salvando…" : `Salvar${dirty.length ? ` (${dirty.length})` : ""}`}
            </button>
          </div>
        </div>

        {/* tabela */}
        <div style={{ border: "1px solid #3a2c18", borderRadius: 12, overflow: "hidden", background: "linear-gradient(180deg,#1c150d,#15100a)" }}>
          <table>
            <thead>
              <tr>
                <th>Família</th><th>Grupo</th><th>Classe</th>
                <th style={{ textAlign: "center" }}>Guilda</th>
                <th style={{ textAlign: "center" }}>Core</th><th style={{ textAlign: "center" }}>Ativo</th>
                <th style={{ textAlign: "center" }}>Wars</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isDirty = baseline.get(r.nome_familia) !== editKey(r);
                const g = GUILD[r.guilda] ?? GUILD.MANI;
                return (
                  <tr key={r.nome_familia} style={{ background: isDirty ? "rgba(227,176,75,.06)" : undefined, opacity: r.ativo ? 1 : 0.55 }}>
                    <td style={{ color: PARCH, fontWeight: 500 }}>{r.nome_familia}{isDirty ? <span style={{ color: GOLD }}> •</span> : null}</td>
                    <td><input list="dl-grupos" value={r.grupo} onChange={(e) => patch(r.nome_familia, { grupo: e.target.value })} style={{ ...inp, width: 120 }} /></td>
                    <td><input list="dl-classes" value={r.classe_bdo ?? ""} onChange={(e) => patch(r.nome_familia, { classe_bdo: e.target.value })} style={{ ...inp, width: 120 }} /></td>
                    <td style={{ textAlign: "center" }}>
                      <button onClick={() => patch(r.nome_familia, { guilda: r.guilda === "MANI" ? "RESO" : "MANI" })}
                        title={`${g.label} — clique pra trocar`}
                        style={{ background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, color: PARCH, fontSize: 12 }}>
                        <img src={g.icon} alt={r.guilda} width={20} height={20} style={{ borderRadius: 4 }} />{r.guilda}
                      </button>
                    </td>
                    <td style={{ textAlign: "center" }}><input type="checkbox" checked={r.is_core} onChange={(e) => patch(r.nome_familia, { is_core: e.target.checked })} /></td>
                    <td style={{ textAlign: "center" }}><input type="checkbox" checked={r.ativo} onChange={(e) => patch(r.nome_familia, { ativo: e.target.checked })} /></td>
                    <td style={{ textAlign: "center", color: MUTE }}>{r.n_wars}</td>
                    <td style={{ textAlign: "center" }}>
                      {r.n_wars === 0
                        ? <button title="excluir definitivamente" onClick={() => excluir(r.nome_familia)} style={{ background: "none", border: "none", color: CRIM, cursor: "pointer", fontSize: 14 }}>🗑</button>
                        : <span title="tem histórico — desative em vez de excluir" style={{ color: "#5a4a30", fontSize: 12 }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <datalist id="dl-grupos">{grupos.map((g) => <option key={g} value={g} />)}</datalist>
        <datalist id="dl-classes">{classes.map((c) => <option key={c} value={c} />)}</datalist>

        <p style={{ color: MUTE, fontSize: 11.5, marginTop: 14 }}>
          • = linha com alteração não salva · clique no ícone da guilda pra alternar MANI/RESO · 🗑 só aparece para quem não tem nenhuma war · grupo vazio vira “Indefinido”.
        </p>
      </div>
    </div>
  );
}
