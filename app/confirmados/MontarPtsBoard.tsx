"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { chaveNome } from "@/lib/nomes";
import { ptsAtivas, SIEGE_MIN, SIEGE_MAX, type PtIcon } from "@/lib/ptConfig";
import { C } from "@/lib/theme";
import type { GrupoConf, PlayerConf } from "@/lib/confirmados";
import type { PtRow } from "@/lib/ptStatus";

const GUILD: Record<string, { label: string; icon: string }> = {
  M: { label: "Manicômio", icon: "/guilds/manicomio.png" },
  R: { label: "Resonance", icon: "/guilds/resonance.png" },
};
const VAGAS_PT = 20;
const imgErr = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = "none"; };

// ícone de uma PT do template ativo (número, emoji do Discord, ou emoji unicode)
function Glyph({ icon, size = 14 }: { icon: PtIcon; size?: number }) {
  if (icon.kind === "num") return <b style={{ fontSize: size, fontFamily: "'Share Tech Mono', monospace" }}>{icon.n}</b>;
  if (icon.kind === "cdn") return <img src={`https://cdn.discordapp.com/emojis/${icon.id}.png`} width={size} height={size} alt="" onError={imgErr} style={{ verticalAlign: "-2px" }} />;
  return <span style={{ fontSize: size }}>{icon.e}</span>;
}

type Mark = { nome: string; pt: string | null; lider: boolean };

export default function MontarPtsBoard({
  grupos, hidden, roubo, marcacoesInit, preferidas, modoInit, siegePtsInit, canEdit, warKey,
}: {
  grupos: GrupoConf[]; hidden: PlayerConf[]; roubo: PlayerConf[]; marcacoesInit: PtRow[]; preferidas: Record<string, string>;
  modoInit: string; siegePtsInit: number; canEdit: boolean; warKey: string | null;
}) {
  const router = useRouter();
  const [marks, setMarks] = useState<Map<string, Mark>>(() => {
    const m = new Map<string, Mark>();
    for (const r of marcacoesInit) m.set(r.chave, { nome: r.familia, pt: r.pt, lider: r.lider });
    return m;
  });
  const [modo, setModo] = useState(modoInit);
  const [siegePts, setSiegePts] = useState(siegePtsInit);
  const [configOpen, setConfigOpen] = useState(false);
  const [savingOps, setSavingOps] = useState(false); // flush de marcações
  const [savingCfg, setSavingCfg] = useState(false); // salvar config (modo/slider)
  const saving = savingOps || savingCfg;
  const [erro, setErro] = useState("");
  const [popup, setPopup] = useState(false);

  // template das PTs conforme o modo (nodewar | siege)
  const pts = useMemo(() => ptsAtivas(modo, siegePts), [modo, siegePts]);
  const cardMin = Math.max(240, 156 + pts.length * 26); // alarga o card conforme o nº de PTs (quadrados)
  const defPorKey = useMemo(() => new Map(pts.map((p) => [p.key, p])), [pts]);
  const ptAtivaSet = useMemo(() => new Set(pts.map((p) => p.key)), [pts]);
  const ptNome = (k: string | null) => (k ? defPorKey.get(k)?.nome ?? k : "");

  // ordem estável dos membros (grupos do bot, reservas, depois roubos) p/ filar as PTs
  const membros = useMemo(() => {
    const out: PlayerConf[] = [];
    const visto = new Set<string>();
    const add = (p: PlayerConf) => { const k = chaveNome(p.nome); if (k && !visto.has(k)) { visto.add(k); out.push(p); } };
    for (const g of grupos) for (const p of g.players) add(p);
    for (const p of hidden) add(p);
    for (const p of roubo) add(p);
    return out;
  }, [grupos, hidden, roubo]);

  // ---- envia DELTAS (ops) por linha — seguro p/ edição concorrente ----
  type PtOp = { familia: string; pt: string | null; lider: boolean };
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const opQueueRef = useRef<PtOp[]>([]);
  const flushingRef = useRef(false);
  async function enviarOps(ops: PtOp[]) {
    if (!ops.length) return;
    opQueueRef.current.push(...ops);
    if (flushingRef.current) return;
    flushingRef.current = true; setSavingOps(true);
    try {
      while (opQueueRef.current.length) {
        const batch = opQueueRef.current; opQueueRef.current = [];
        const res = await fetch("/api/confirmados/pt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ops: batch, warKey }) });
        if (!res.ok) { const j = await res.json().catch(() => ({} as { error?: string })); throw new Error(j.error || `erro ${res.status}`); }
      }
      setErro(""); router.refresh(); // propaga e re-sincroniza
    } catch (e) { setErro((e as Error).message); }
    finally { flushingRef.current = false; setSavingOps(false); }
  }

  // diff entre o estado anterior e o novo → ops (upsert dos mudados; delete dos sumidos)
  function commit(next: Map<string, Mark>) {
    const prev = marksRef.current;
    const ops: PtOp[] = [];
    for (const [k, v] of next) { const old = prev.get(k); if (!old || old.pt !== v.pt || old.lider !== v.lider) ops.push({ familia: v.nome, pt: v.pt, lider: v.lider }); }
    for (const [k, v] of prev) if (!next.has(k)) ops.push({ familia: v.nome, pt: null, lider: false }); // delete
    setMarks(next);
    enviarOps(ops);
  }

  // re-sincroniza do servidor (outro PC editou) FILTRANDO a quem é membro agora; semeia a PT
  // preferida (a "base") só se a chave for válida no template ATIVO. lastSig evita atropelar
  // edição local e loops; sem dep-array re-tenta após o flush e em troca de modo.
  const initSig = useMemo(() => marcacoesInit.map((r) => `${r.chave}:${r.pt}:${r.lider ? 1 : 0}`).join("\n"), [marcacoesInit]);
  const membrosSig = useMemo(() => membros.map((p) => chaveNome(p.nome)).join("\n"), [membros]);
  const prefSig = useMemo(() => JSON.stringify(preferidas), [preferidas]);
  const lastSyncSig = useRef("");
  useEffect(() => {
    const sig = `${initSig}##${membrosSig}##${prefSig}##${modo}:${siegePts}`;
    if (sig === lastSyncSig.current || flushingRef.current) return;
    lastSyncSig.current = sig;
    const scanPorChave = new Map(marcacoesInit.map((r) => [r.chave, r]));
    const m = new Map<string, Mark>();
    for (const p of membros) {
      const k = chaveNome(p.nome);
      const row = scanPorChave.get(k);
      if (row) m.set(k, { nome: p.nome, pt: row.pt, lider: row.lider });
      else if (preferidas[k] && defPorKey.has(preferidas[k])) m.set(k, { nome: p.nome, pt: preferidas[k], lider: false });
    }
    setMarks(m);
  });

  // ---- config do template (modo/siege) — persiste e sincroniza entre PCs ----
  const cfgSavingRef = useRef(false);
  const cfgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function persistConfig(novoModo: string, novoSiege: number) {
    if (!canEdit) return;
    setModo(novoModo); setSiegePts(novoSiege); // otimista
    cfgSavingRef.current = true; setSavingCfg(true);
    try {
      const res = await fetch("/api/confirmados/pt-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modo: novoModo, siegePts: novoSiege }) });
      if (!res.ok) { const j = await res.json().catch(() => ({} as { error?: string })); throw new Error(j.error || "falha ao salvar config"); }
      setErro(""); router.refresh();
    } catch (e) { setErro((e as Error).message); }
    finally { cfgSavingRef.current = false; setSavingCfg(false); }
  }
  function mudarSiege(n: number) { // slider: estado imediato, persiste com debounce
    setSiegePts(n);
    if (cfgTimerRef.current) clearTimeout(cfgTimerRef.current);
    cfgTimerRef.current = setTimeout(() => persistConfig("siege", n), 400);
  }
  const cfgInitSig = `${modoInit}:${siegePtsInit}`;
  const lastCfgSig = useRef(cfgInitSig);
  useEffect(() => {
    if (cfgInitSig === lastCfgSig.current || cfgSavingRef.current) return;
    lastCfgSig.current = cfgInitSig;
    setModo(modoInit); setSiegePts(siegePtsInit);
  });

  function togglePt(p: PlayerConf, ptKey: string) {
    if (!canEdit) return;
    const k = chaveNome(p.nome);
    const cur = marks.get(k);
    const novoPt = cur?.pt === ptKey ? null : ptKey;
    const next = new Map(marks);
    // trocar/limpar o squad zera a coroa — líder é por-PT (re-marque na PT nova se quiser).
    if (!novoPt) next.delete(k); else next.set(k, { nome: p.nome, pt: novoPt, lider: false });
    commit(next);
  }

  function toggleCoroa(p: PlayerConf) {
    if (!canEdit) return;
    const k = chaveNome(p.nome);
    const cur = marks.get(k);
    const novoLider = !cur?.lider;
    const next = new Map(marks);
    if (novoLider && cur?.pt) { // 1 líder por PT: avisa se já tem, e tira a coroa dos outros da mesma PT
      let outro: string | null = null;
      for (const [kk, v] of next) if (kk !== k && v.pt === cur.pt && v.lider) { outro = v.nome; break; }
      if (outro && !confirm(`A ${ptNome(cur.pt)} já tem líder: ${outro}. Trocar a coroa para ${p.nome}?`)) return;
      for (const [kk, v] of next) if (kk !== k && v.pt === cur.pt && v.lider) next.set(kk, { ...v, lider: false });
    }
    const m: Mark = { nome: p.nome, pt: cur?.pt ?? null, lider: novoLider };
    if (!m.pt && !m.lider) next.delete(k); else next.set(k, m);
    commit(next);
  }

  async function resetar() {
    if (!canEdit || !confirm("Limpar todas as marcações de PT (coroas e quadrados)?")) return;
    setMarks(new Map()); opQueueRef.current = []; setSavingOps(true);
    try {
      const res = await fetch("/api/confirmados/pt", { method: "DELETE" });
      if (!res.ok) { const j = await res.json().catch(() => ({} as { error?: string })); throw new Error(j.error || "falha ao limpar"); }
      setErro(""); router.refresh();
    } catch (e) { setErro((e as Error).message); }
    finally { setSavingOps(false); }
  }

  // listas do popup (só PTs do template ativo)
  const ptListas = useMemo(() => pts.map((pt) => {
    const lista = membros.filter((p) => marks.get(chaveNome(p.nome))?.pt === pt.key);
    lista.sort((a, b) => (marks.get(chaveNome(b.nome))?.lider ? 1 : 0) - (marks.get(chaveNome(a.nome))?.lider ? 1 : 0));
    return { pt, dentro: lista.slice(0, VAGAS_PT), fora: lista.slice(VAGAS_PT), total: lista.length };
  }), [membros, marks, pts]);

  // confirmados sem PT ATIVA (precisam entrar em alguma do template atual)
  const foraDasPts = useMemo(() => membros.filter((p) => { const pt = marks.get(chaveNome(p.nome))?.pt; return !pt || !ptAtivaSet.has(pt); }), [membros, marks, ptAtivaSet]);

  const Coroa = ({ p }: { p: PlayerConf }) => {
    const on = !!marks.get(chaveNome(p.nome))?.lider;
    return (
      <button onClick={() => toggleCoroa(p)} disabled={!canEdit} title={on ? "líder da PT" : "marcar como líder"}
        style={{ background: "none", border: "none", padding: 0, lineHeight: 1, fontSize: 14, cursor: canEdit ? "pointer" : "default", opacity: on ? 1 : 0.22, filter: on ? "drop-shadow(0 0 4px rgba(255,210,30,.75))" : "none" }}>👑</button>
    );
  };

  const MemberRow = ({ p }: { p: PlayerConf }) => {
    const k = chaveNome(p.nome);
    const m = marks.get(k);
    const g = p.tag ? GUILD[p.tag] : null;
    return (
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "3px 6px", fontSize: 12.5 }}>
        <Coroa p={p} />
        {g && <img src={g.icon} alt={p.tag ?? ""} width={14} height={14} style={{ borderRadius: 3 }} />}
        <span style={{ color: C.texto, fontWeight: m?.lider ? 700 : 400 }}>{p.nome}</span>
        {p.nota && <span style={{ color: C.mute, fontSize: 11 }}>({p.nota})</span>}
        <span style={{ marginLeft: "auto", display: "inline-flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 3 }}>
          {pts.map((pt) => {
            const active = m?.pt === pt.key;
            return (
              <button key={pt.key} onClick={() => togglePt(p, pt.key)} disabled={!canEdit} title={pt.nome}
                style={{ width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 5, border: `1px solid ${active ? C.verde : C.border2}`, background: active ? C.verdeTint : "transparent", color: active ? C.verde : C.mute, cursor: canEdit ? "pointer" : "default", padding: 0 }}>
                <Glyph icon={pt.icon} />
              </button>
            );
          })}
        </span>
      </div>
    );
  };

  const modoBtn = (m: "nodewar" | "siege", label: string) => (
    <button onClick={() => persistConfig(m, siegePts)} style={{ borderRadius: 8, border: `1px solid ${modo === m ? C.verde : C.border2}`, background: modo === m ? C.verdeTint : "transparent", color: modo === m ? C.verde : C.mute, padding: "5px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{label}</button>
  );

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "14px 16px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <div style={{ color: C.verde, fontWeight: 700, fontSize: 14 }}>Montar PTs <span style={{ color: C.mute, fontWeight: 400, fontSize: 12 }}>({modo === "siege" ? "siege" : "nodewar"})</span></div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {saving && <span style={{ color: C.mute, fontSize: 12 }}>salvando…</span>}
          {canEdit && (
            <button onClick={() => setConfigOpen((o) => !o)} style={{ borderRadius: 8, border: `1px solid ${configOpen ? C.verde : C.border2}`, background: "transparent", color: configOpen ? C.verde : C.mute, padding: "6px 11px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>⚙ Config</button>
          )}
          <button onClick={() => setPopup(true)} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.verdeTint, color: C.verde, padding: "6px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>👁 Visualizar PT&apos;s</button>
          {canEdit && marks.size > 0 && !saving && (
            <button onClick={resetar} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.vermelho, padding: "6px 11px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>↺ Limpar</button>
          )}
        </div>
      </div>

      {configOpen && canEdit && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px 14px", border: `1px solid ${C.border2}`, borderRadius: 10, background: C.inputBg, padding: "10px 13px", marginBottom: 12 }}>
          <span style={{ color: C.mute, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>Tipo de evento</span>
          {modoBtn("nodewar", "Nodewar")}
          {modoBtn("siege", "Siege")}
          {modo === "siege" && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: C.texto, fontSize: 12.5 }}>
              <span style={{ borderLeft: `1px solid ${C.borderSoft}`, paddingLeft: 12 }}>PTs numeradas: <b style={{ color: C.verde }}>{siegePts}</b></span>
              <input type="range" min={SIEGE_MIN} max={SIEGE_MAX} step={1} value={siegePts} onChange={(e) => mudarSiege(Number(e.target.value))} style={{ accentColor: C.verde, cursor: "pointer" }} />
              <span style={{ color: C.mute }}>+ Flanco + Defesa</span>
            </span>
          )}
        </div>
      )}

      <div style={{ color: C.mute, fontSize: 11.5, marginBottom: 12 }}>
        <b style={{ color: C.amarelo }}>Só quem confirmou Participar in-game</b> ({membros.length}). {canEdit
          ? `👑 = líder (1 por PT). Quadrados = squad (${pts.map((p) => p.nome).join(" / ")}). Use ⚙ Config p/ trocar Nodewar/Siege. Marcações resetam com a war.`
          : "Composição montada pela staff. Use “Visualizar PT’s” pra ver as listas."}
      </div>

      {erro && <div style={{ color: C.vermelho, fontSize: 13, marginBottom: 8 }}>⚠ {erro}</div>}

      {/* quem confirmou mas ainda não está em nenhuma PT (do template atual) */}
      {foraDasPts.length > 0 && (
        <div style={{ border: `1px solid ${C.vermelho}`, borderRadius: 10, background: C.inputBg, padding: "9px 13px", marginBottom: 14 }}>
          <div style={{ color: C.vermelho, fontWeight: 700, fontSize: 13, marginBottom: 6 }}>⚠ Fora das PTs ({foraDasPts.length}) <span style={{ color: C.mute, fontWeight: 400, fontSize: 11.5 }}>— confirmaram mas não estão em nenhum squad</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "3px 14px" }}>
            {foraDasPts.map((p, i) => {
              const g = p.tag ? GUILD[p.tag] : null;
              return (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: C.texto }}>
                  {g && <img src={g.icon} alt={p.tag ?? ""} width={14} height={14} style={{ borderRadius: 3 }} />}{p.nome}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {membros.length === 0 ? (
        <div style={{ color: C.mute, fontSize: 13, border: `1px dashed ${C.border2}`, borderRadius: 10, padding: "14px 16px" }}>
          Ninguém confirmou “Participar” in-game ainda — suba os prints na seção <b style={{ color: C.texto }}>Conferir “Participar”</b> acima pra ver quem vai pra war.
        </div>
      ) : (
        /* grupos do bot — só os que têm gente confirmada */
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${cardMin}px, 1fr))`, gap: 12 }}>
          {grupos.filter((g) => g.players.length > 0).map((g) => (
            <div key={g.nome} style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surfaceSolid, padding: "11px 13px" }}>
              <div style={{ color: C.verde, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{g.nome}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {g.players.map((p, i) => <MemberRow key={i} p={p} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* reservas (hidden, como se estivessem no bot) */}
      {hidden.length > 0 && (
        <div style={{ border: `1px dashed ${C.border2}`, borderRadius: 12, background: C.surfaceSolid, padding: "11px 13px", marginTop: 12 }}>
          <div style={{ color: C.amarelo, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Reservas (fora do bot) <span style={{ color: C.mute, fontWeight: 400 }}>({hidden.length})</span></div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${cardMin}px, 1fr))`, gap: "5px 16px" }}>
            {hidden.map((p, i) => <MemberRow key={i} p={p} />)}
          </div>
        </div>
      )}

      {/* roubaram vaga (pós-liberação 20:30 — Participar in-game sem ser oficial) */}
      {roubo.length > 0 && (
        <div style={{ border: `1px dashed ${C.laranja}`, borderRadius: 12, background: C.surfaceSolid, padding: "11px 13px", marginTop: 12 }}>
          <div style={{ color: C.laranja, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>🏴 Roubaram vaga <span style={{ color: C.mute, fontWeight: 400 }}>({roubo.length})</span></div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${cardMin}px, 1fr))`, gap: "5px 16px" }}>
            {roubo.map((p, i) => <MemberRow key={i} p={p} />)}
          </div>
        </div>
      )}

      {/* popup Visualizar PT's */}
      {popup && (
        <div onClick={() => setPopup(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 50, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 1100, border: `1px solid ${C.border2}`, borderRadius: 14, background: C.bg0, padding: "18px 20px", boxShadow: "0 0 40px rgba(0,0,0,.6)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ color: C.amarelo, fontWeight: 800, fontSize: 16, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 1 }}>PTs montadas <span style={{ color: C.mute, fontSize: 12 }}>({modo === "siege" ? "siege" : "nodewar"})</span></div>
              <button onClick={() => setPopup(false)} style={{ background: "none", border: "none", color: C.mute, cursor: "pointer", fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14 }}>
              {ptListas.map(({ pt, dentro, fora, total }) => (
                <div key={pt.key} style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ color: C.verde, fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}><Glyph icon={pt.icon} size={16} /> {pt.nome}</span>
                    <span style={{ color: total > VAGAS_PT ? C.amarelo : C.mute, fontSize: 12 }}>{Math.min(total, VAGAS_PT)}/{VAGAS_PT}</span>
                  </div>
                  {dentro.length === 0 ? <span style={{ color: C.borderSoft, fontSize: 12 }}>—</span> : (
                    <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 2 }}>
                      {dentro.map((p, i) => {
                        const lider = !!marks.get(chaveNome(p.nome))?.lider;
                        const g = p.tag ? GUILD[p.tag] : null;
                        return (
                          <li key={i} style={{ color: C.texto, fontSize: 12.5, fontWeight: lider ? 700 : 400 }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                              {lider && <span style={{ filter: "drop-shadow(0 0 3px rgba(255,210,30,.7))" }}>👑</span>}
                              {g && <img src={g.icon} alt={p.tag ?? ""} width={13} height={13} style={{ borderRadius: 2 }} />}
                              {p.nome}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  {fora.length > 0 && (
                    <div style={{ marginTop: 8, paddingTop: 7, borderTop: `1px solid ${C.borderSoft}`, color: C.amarelo, fontSize: 11.5 }}>
                      Fora ({fora.length}): <span style={{ color: C.mute }}>{fora.map((p) => p.nome).join(", ")}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
