"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerRow } from "@/lib/players";
import { CLASSE_NOMES, tiposDe } from "@/lib/bdoClasses";
import type { MediasMap } from "@/lib/stats";
import { parseGarmothId } from "@/lib/garmothId";
import { C } from "@/lib/theme";
import { iconeUrl, type GuildEntry } from "@/lib/guild";

const STATS = [
  { m: "dano_em_player", l: "PvP" },
  { m: "dano_do_pino", l: "Pino" },
  { m: "ccs", l: "CC" },
  { m: "cura_aliados", l: "Cura" },
  { m: "tempo_morto", l: "Morto↓" },
];

type Status = { kind: "idle" | "saving" | "ok" | "err"; msg?: string };
const editKey = (p: PlayerRow) => JSON.stringify([p.grupo, p.classe_bdo ?? "", p.classe_tipo ?? "", p.is_core, p.guilda, p.pt_preferida ?? "", p.garmoth_id ?? "", p.registro]);
const haQuanto = (iso: string | null) => {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return "agora há pouco";
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
};
// PT preferida de nodewar (vira a "base" na montagem das PTs)
const PT_OPTS: { v: string; l: string }[] = [{ v: "1", l: "PT1" }, { v: "2", l: "PT2" }, { v: "defesa", l: "Defesa" }, { v: "ungabunga", l: "UngaBunga" }];

export default function MembrosTable({ initial, guildas, gruposExtra = [], medias = {}, canEdit = true }: { initial: PlayerRow[]; guildas: GuildEntry[]; gruposExtra?: string[]; medias?: MediasMap; canEdit?: boolean }) {
  const ro = !canEdit; // somente leitura
  const byId = useMemo(() => new Map(guildas.map((g) => [g.id, g])), [guildas]);
  const ids = useMemo(() => guildas.map((g) => g.id), [guildas]);
  const nextGuild = (cur: string) => { const i = ids.indexOf(cur); return ids.length ? ids[(i + 1) % ids.length] : cur; };
  const GuildIcon = ({ id, size = 16 }: { id: string; size?: number }) => {
    const g = byId.get(id); const u = g ? iconeUrl(g.icone) : null;
    return u ? <img src={u} alt="" width={size} height={size} style={{ borderRadius: 3 }} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : <span style={{ fontSize: size - 2 }}>{g?.icone || g?.tag || id}</span>;
  };
  const [rows, setRows] = useState<PlayerRow[]>(initial);
  const [baseline, setBaseline] = useState<Map<string, string>>(
    () => new Map(initial.map((p) => [p.nome_familia, editKey(p)])),
  );
  const [tab, setTab] = useState<"ativos" | "ex">("ativos");
  const [q, setQ] = useState("");
  const [gf, setGf] = useState<string>("");
  const [novo, setNovo] = useState(() => ({ nome: "", grupo: "", classe: "", tipo: "", guilda: guildas[0]?.id ?? "MANI" }));
  const [arq, setArq] = useState<string | null>(null); // nome em processo de arquivar
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [gInput, setGInput] = useState<Record<string, string>>({}); // texto CRU do campo Garmoth em edição (só normaliza no blur — auto-save nunca grava parcial)

  const grupos = useMemo(() => [...new Set([...rows.map((r) => r.grupo), ...gruposExtra])].sort(), [rows, gruposExtra]);
  const classes = useMemo(() => [...new Set(rows.map((r) => r.classe_bdo).filter(Boolean) as string[])].sort(), [rows]);
  const dirty = useMemo(() => rows.filter((r) => baseline.get(r.nome_familia) !== editKey(r)), [rows, baseline]);

  const ativos = useMemo(() => rows.filter((r) => r.ativo), [rows]);
  const ex = useMemo(() => rows.filter((r) => !r.ativo), [rows]);
  const contGuild = useMemo(() => { const m: Record<string, number> = {}; for (const g of guildas) m[g.id] = 0; for (const r of ativos) if (r.guilda in m) m[r.guilda]++; return m; }, [ativos, guildas]);
  const nReg = ativos.filter((r) => r.registro).length;

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

  // registrados primeiro; não-registrados vão pro fim (esmaecidos, sob um divisor). sort estável preserva grupo/nome.
  const ordenados = useMemo(() => [...filtered].sort((a, b) => Number(b.registro) - Number(a.registro)), [filtered]);
  const temReg = ordenados.some((r) => r.registro);

  const patch = (nome: string, campo: Partial<PlayerRow>) =>
    setRows((prev) => prev.map((r) => (r.nome_familia === nome ? { ...r, ...campo } : r)));

  async function refresh() {
    const data = await fetch("/api/players").then((r) => r.json());
    const ps: PlayerRow[] = data.players ?? [];
    setRows(ps);
    setBaseline(new Map(ps.map((p) => [p.nome_familia, editKey(p)])));
  }

  async function atualizarGarmoth() {
    if (dirty.length && !(await salvar())) return; // persiste edições (inclui garmoth_id) antes; aborta se o save falhar
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/garmoth/refresh", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha");
      await refresh();
      setStatus({ kind: "ok", msg: `Garmoth: ${d.atualizados ?? 0} build(s) atualizada(s)${d.erros?.length ? ` · ${d.erros.length} sem retorno` : ""}.` });
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }

  async function salvar(auto = false): Promise<boolean> {
    if (!dirty.length) return true;
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/players", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updates: dirty }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha");
      setBaseline(new Map(rows.map((p) => [p.nome_familia, editKey(p)])));
      setStatus({ kind: "ok", msg: auto ? `salvo automaticamente (${dirty.length})` : `${dirty.length} alteração(ões) salva(s).` });
      return true;
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); return false; }
  }

  // auto-save: a cada 10s grava as alterações pendentes (se não estiver salvando)
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const savingRef = useRef(false); savingRef.current = status.kind === "saving";
  const salvarRef = useRef(salvar); salvarRef.current = salvar;
  useEffect(() => {
    const id = setInterval(() => { if (canEdit && dirtyRef.current.length && !savingRef.current) salvarRef.current(true); }, 10000);
    return () => clearInterval(id);
  }, []);

  async function adicionar() {
    const nome = novo.nome.trim();
    if (!nome) return;
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/players", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome_familia: nome, grupo: novo.grupo, classe_bdo: novo.classe, classe_tipo: novo.tipo, guilda: novo.guilda }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha");
      const g = novo.guilda;
      setNovo({ nome: "", grupo: "", classe: "", tipo: "", guilda: g });
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
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600;700&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}
        input:focus,select:focus{border-color:${C.verde}}
        table{border-collapse:collapse;width:100%} th,td{padding:8px 10px;text-align:left;border-bottom:1px solid ${C.borderSoft};font-size:13px}
        th{color:${C.mute};font-size:10.5px;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;position:sticky;top:0;background:${C.surfaceSolid}}
        tbody tr:hover{background:rgba(204,0,0,.04)}
        input[type=checkbox]{accent-color:${C.verde}}
      `}</style>

      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/mascot.png" alt="BAYGON" width={40} height={40} style={{ filter: "drop-shadow(0 0 10px rgba(204,0,0,.45))" }} />
            <div>
              <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 26, letterSpacing: 1, margin: 0, color: C.amarelo }}>
                BAYGON <span style={{ color: C.mute, fontSize: 14, fontFamily: "inherit", letterSpacing: 2 }}>· MEMBROS</span>
              </h1>
              <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                <Stat>{rows.length} no total</Stat>
                <Stat><b style={{ color: C.verde }}>{ativos.length}</b> ativos</Stat>
                <Stat><b style={{ color: C.verde }}>{nReg}</b> reg. · <span style={{ color: C.mute }}>{ativos.length - nReg} não</span></Stat>
                <Stat>{ex.length} ex-membros</Stat>
                {guildas.map((g) => <Stat key={g.id}><GuildIcon id={g.id} size={14} /> {contGuild[g.id] ?? 0}</Stat>)}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            {ro && <span style={{ color: C.amarelo, fontSize: 12, border: `1px solid ${C.border2}`, borderRadius: 999, padding: "3px 10px" }}>🔒 somente leitura</span>}
            <Link className="navlink" href="/painel">← Painel</Link>
            <Link className="navlink" href="/confirmados">Confirmados</Link>
            <Link className="navlink" href="/evolucao">Evolução</Link>
            <Link className="navlink" href="/gear">Gear</Link>
            <Link className="navlink" href="/emojis">Emojis</Link>
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

        {/* adicionar (só na aba ativos, e só quem edita) */}
        {tab === "ativos" && canEdit && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14, padding: "12px 14px", border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface }}>
            <span style={{ color: C.mute, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" }}>Adicionar</span>
            <input placeholder="Nome de família" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} style={{ ...inp, width: 170 }} />
            <input placeholder="Grupo" list="dl-grupos" value={novo.grupo} onChange={(e) => setNovo({ ...novo, grupo: e.target.value })} style={{ ...inp, width: 130 }} />
            <select value={novo.classe} onChange={(e) => setNovo({ ...novo, classe: e.target.value, tipo: "" })} style={{ ...inp, width: 130, cursor: "pointer" }}>
              <option value="">Classe…</option>
              {CLASSE_NOMES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value })} disabled={!novo.classe} style={{ ...inp, width: 120, cursor: "pointer", opacity: novo.classe ? 1 : 0.5 }}>
              <option value="">Tipo…</option>
              {tiposDe(novo.classe).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={novo.guilda} onChange={(e) => setNovo({ ...novo, guilda: e.target.value })} style={{ ...inp, width: 130, cursor: "pointer" }}>
              {guildas.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
            </select>
            <button onClick={adicionar} style={{ ...btn(C.amarelo), padding: "7px 16px", fontSize: 13 }}>+ Adicionar</button>
          </div>
        )}

        {/* toolbar */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input placeholder="🔎 buscar nome / grupo / classe" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inp, width: 250 }} />
            <button onClick={() => setGf("")} style={chip(gf === "")}>Todas</button>
            {guildas.map((g) => <button key={g.id} onClick={() => setGf(g.id)} style={chip(gf === g.id)}><GuildIcon id={g.id} size={16} />{g.id}</button>)}
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {canEdit && (
              <span style={{ color: C.mute, fontSize: 11, display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: dirty.length ? C.amarelo : C.verde, boxShadow: `0 0 6px ${dirty.length ? C.amarelo : C.verde}` }} />
                auto-save 10s
              </span>
            )}
            {status.kind === "ok" && <span style={{ color: C.verde, fontSize: 13 }}>✓ {status.msg}</span>}
            {status.kind === "err" && <span style={{ color: C.vermelho, fontSize: 13 }}>⚠ {status.msg}</span>}
            {canEdit && (
              <button onClick={atualizarGarmoth} disabled={status.kind === "saving"} title="Busca a gear de todo mundo no Garmoth agora (o worker já faz isso a cada 2h)" style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: C.mute, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                ⟳ Garmoth
              </button>
            )}
            {canEdit && (
              <button onClick={() => salvar()} disabled={!dirty.length || status.kind === "saving"} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: dirty.length ? C.verdeTint : C.inputBg, color: C.verde, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: dirty.length ? "pointer" : "default", opacity: dirty.length ? 1 : 0.5 }}>
                {status.kind === "saving" ? "Salvando…" : `Salvar${dirty.length ? ` (${dirty.length})` : ""}`}
              </button>
            )}
          </div>
        </div>

        {/* tabela */}
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflowX: "auto", background: C.surface }}>
          <table>
            <thead>
              <tr>
                <th>Família</th><th>Grupo</th><th>Classe</th><th>Tipo</th><th>PT nodewar</th>
                <th style={{ textAlign: "center" }}>Guilda</th>
                {tab === "ativos" ? <th style={{ textAlign: "center" }}>Core</th> : <th>Saída</th>}
                <th style={{ textAlign: "center" }}>Wars</th>
                <th>Médias vs core (últ. 5)</th>
                <th>Garmoth <span style={{ textTransform: "none", color: C.borderSoft }}>(AP/AAP · DP)</span></th>
                <th style={{ textAlign: "center" }} title="Concluiu a jornada de registro">Reg.</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {ordenados.map((r, i) => {
                const isDirty = baseline.get(r.nome_familia) !== editKey(r);
                const gdef = byId.get(r.guilda);
                const primeiroNaoReg = !r.registro && temReg && (i === 0 || ordenados[i - 1].registro);
                return (
                  <Fragment key={r.nome_familia}>
                  {primeiroNaoReg && (
                    <tr><td colSpan={12} style={{ padding: "12px 10px 5px", color: C.mute, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", borderTop: `1px dashed ${C.border2}` }}>▽ Não registrados ({ordenados.length - ordenados.filter((x) => x.registro).length}) — aguardando a jornada de registro</td></tr>
                  )}
                  <tr style={{ background: isDirty ? "rgba(204,0,0,.08)" : undefined, opacity: r.registro || !temReg ? 1 : 0.5 }}>
                    <td style={{ color: C.texto, fontWeight: 600 }}>{r.nome_familia}{isDirty ? <span style={{ color: C.amarelo }}> •</span> : null}</td>
                    <td>
                      <select value={r.grupo} disabled={ro} onChange={(e) => patch(r.nome_familia, { grupo: e.target.value })} style={{ ...inp, width: 130, cursor: ro ? "default" : "pointer" }}>
                        {[...new Set([...grupos, "Indefinido", r.grupo])].map((gx) => <option key={gx} value={gx}>{gx}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={r.classe_bdo ?? ""} disabled={ro || !!r.garmoth_id} title={r.garmoth_id ? "classe vem do Garmoth" : undefined} onChange={(e) => patch(r.nome_familia, { classe_bdo: e.target.value || null, classe_tipo: null })} style={{ ...inp, width: 130, cursor: ro || r.garmoth_id ? "default" : "pointer", opacity: r.garmoth_id ? 0.7 : 1 }}>
                        <option value="">—</option>
                        {[...new Set([...CLASSE_NOMES, ...(r.classe_bdo ? [r.classe_bdo] : [])])].map((cx) => <option key={cx} value={cx}>{cx}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={r.classe_tipo ?? ""} onChange={(e) => patch(r.nome_familia, { classe_tipo: e.target.value || null })} disabled={ro || !r.classe_bdo || !!r.garmoth_id} title={r.garmoth_id ? "tipo vem do Garmoth" : undefined} style={{ ...inp, width: 115, cursor: ro || r.garmoth_id ? "default" : "pointer", opacity: r.classe_bdo && !r.garmoth_id ? 1 : 0.6 }}>
                        <option value="">—</option>
                        {[...new Set([...tiposDe(r.classe_bdo), ...(r.classe_tipo ? [r.classe_tipo] : [])])].map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={r.pt_preferida ?? ""} disabled={ro} onChange={(e) => patch(r.nome_familia, { pt_preferida: e.target.value || null })} style={{ ...inp, width: 120, cursor: ro ? "default" : "pointer" }}>
                        <option value="">—</option>
                        {PT_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                      </select>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button onClick={() => patch(r.nome_familia, { guilda: nextGuild(r.guilda) })} disabled={ro} title={ro ? (gdef?.nome ?? r.guilda) : `${gdef?.nome ?? r.guilda} — clique pra trocar`}
                        style={{ background: "none", border: "none", cursor: ro ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 6, color: C.texto, fontSize: 12 }}>
                        <GuildIcon id={r.guilda} size={22} />{r.guilda}
                      </button>
                    </td>
                    {tab === "ativos"
                      ? <td style={{ textAlign: "center" }}><input type="checkbox" checked={r.is_core} disabled={ro} onChange={(e) => patch(r.nome_familia, { is_core: e.target.checked })} /></td>
                      : <td style={{ color: C.mute, fontSize: 12 }}>{r.saida_tipo === "Kikado" ? <span style={{ color: C.vermelho }}>Kikado</span> : "Saiu"}{r.saida_data ? ` · ${r.saida_data.split("-").reverse().join("/")}` : ""}</td>}
                    <td style={{ textAlign: "center", color: C.mute }}>{r.n_wars}</td>
                    <td>
                      {(() => {
                        const md = medias[r.nome_familia];
                        if (!md) return <span style={{ color: C.borderSoft }}>—</span>;
                        return (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", maxWidth: 220, fontSize: 11 }}>
                            {STATS.map((s) => {
                              const v = md[s.m];
                              return v == null ? null : (
                                <span key={s.m} style={{ color: v >= 100 ? C.verde : C.vermelho, whiteSpace: "nowrap" }}>
                                  {s.l} <b>{v.toFixed(0)}%</b>
                                </span>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      <input placeholder="colar URL/id" value={gInput[r.nome_familia] ?? (r.garmoth_id ?? "")} disabled={ro}
                        onChange={(e) => { const v = e.target.value; setGInput((m) => ({ ...m, [r.nome_familia]: v })); }}
                        onBlur={() => {
                          const raw = gInput[r.nome_familia];
                          if (raw === undefined) return; // não editou → não mexe
                          setGInput((m) => { const n = { ...m }; delete n[r.nome_familia]; return n; });
                          const t = raw.trim();
                          // vazio → limpa; válido → id; inválido/parcial → mantém o id atual (nunca apaga sem querer)
                          patch(r.nome_familia, { garmoth_id: t === "" ? null : (parseGarmothId(t) ?? r.garmoth_id ?? null) });
                        }}
                        style={{ ...inp, width: 116, fontSize: 12 }} />
                      {r.garmoth && (
                        <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                          {([["AP", r.garmoth.ap, C.verde], ["AAP", r.garmoth.aap, C.mute], ["DP", r.garmoth.dp, "#6f93b5"]] as const).map(([lbl, v, cor]) => (
                            <span key={lbl} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: 32, border: `1px solid ${C.border2}`, borderRadius: 5, padding: "1px 3px", lineHeight: 1.1, background: C.inputBg }}>
                              <span style={{ fontSize: 8, color: C.mute, letterSpacing: 0.5 }}>{lbl}</span>
                              <b style={{ fontSize: 12, color: cor }}>{v ?? "?"}</b>
                            </span>
                          ))}
                          <span style={{ fontSize: 11.5, color: C.texto }} title="Gearscore = (AP+AAP)/2 + DP">GS <b style={{ color: C.verdeBright }}>{r.garmoth.gs ?? "?"}</b></span>
                          <a href={`https://garmoth.com/character/${encodeURIComponent(r.garmoth_id ?? "")}`} target="_blank" rel="noreferrer" title={`abrir no Garmoth${r.garmoth.char_name ? ` — ${r.garmoth.char_name}` : ""}`} style={{ color: C.mute, textDecoration: "none", fontSize: 12 }}>↗</a>
                          <span suppressHydrationWarning title={r.garmoth.atualizado ?? ""} style={{ color: r.garmoth.stale ? C.amarelo : C.borderSoft, fontSize: 10.5 }}>{r.garmoth.stale ? "⟳ id mudou" : haQuanto(r.garmoth.atualizado)}</span>
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input type="checkbox" checked={r.registro} disabled={ro} title={r.registro ? "registrado (jornada concluída)" : "não registrado — cai no grupo esmaecido"} onChange={(e) => patch(r.nome_familia, { registro: e.target.checked })} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {!canEdit ? <span style={{ color: C.borderSoft, fontSize: 12 }}>—</span> : (
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
                        {tab === "ex" && (r.n_wars === 0
                          ? <button title="excluir definitivamente" onClick={() => excluir(r.nome_familia)} style={{ background: "none", border: "none", color: C.vermelho, cursor: "pointer", fontSize: 15 }}>🗑</button>
                          : <span title="tem histórico — não dá pra excluir (fica arquivado)" style={{ color: C.borderSoft, fontSize: 12, width: 18, display: "inline-block", textAlign: "center" }}>—</span>)}
                      </div>
                      )}
                    </td>
                  </tr>
                  </Fragment>
                );
              })}
              {ordenados.length === 0 && (
                <tr><td colSpan={12} style={{ color: C.mute, textAlign: "center", padding: 24 }}>Nenhum membro {tab === "ex" ? "arquivado" : "aqui"}{q || gf ? " com esse filtro" : ""}.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <datalist id="dl-grupos">{grupos.map((g) => <option key={g} value={g} />)}</datalist>
        <datalist id="dl-classes">{classes.map((c) => <option key={c} value={c} />)}</datalist>

        <p style={{ color: C.mute, fontSize: 11.5, marginTop: 14, lineHeight: 1.6 }}>
          • = alteração não salva · clique no ícone da guilda pra alternar entre as guildas · <b style={{ color: C.amarelo }}>Arquivar</b> manda pra Ex-membros com o motivo (preserva histórico) ·
          🗑 (excluir definitivo) só aparece pra quem tem 0 wars.
        </p>
      </div>
    </div>
  );
}
