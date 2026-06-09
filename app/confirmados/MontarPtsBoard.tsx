"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { chaveNome } from "@/lib/nomes";
import { C } from "@/lib/theme";
import type { GrupoConf, PlayerConf } from "@/lib/confirmados";
import type { PtRow } from "@/lib/ptStatus";

const GUILD: Record<string, { label: string; icon: string }> = {
  M: { label: "Manicômio", icon: "/guilds/manicomio.png" },
  R: { label: "Resonance", icon: "/guilds/resonance.png" },
};

// ===== Config das 4 PTs (squads) =====
const FLAME_ID = "1459738870592835584"; // emoji "flame" do bot = ícone do Defesa
// Ícone do UngaBunga = emoji ":ungaungacore:" do bot.
const UNGA: { kind: "emoji"; emoji: string } | { kind: "cdn"; id: string } | { kind: "img"; src: string } = { kind: "cdn", id: "1512543325851353208" };

const PTS = [
  { key: "1", nome: "PT1" },
  { key: "2", nome: "PT2" },
  { key: "defesa", nome: "Defesa" },
  { key: "ungabunga", nome: "UngaBunga" },
] as const;
const VAGAS_PT = 20;

const imgErr = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = "none"; };

function PtGlyph({ k, size = 14 }: { k: string; size?: number }) {
  if (k === "1" || k === "2") return <b style={{ fontSize: size, fontFamily: "'Share Tech Mono', monospace" }}>{k}</b>;
  if (k === "defesa") return <img src={`https://cdn.discordapp.com/emojis/${FLAME_ID}.png`} width={size} height={size} alt="" onError={imgErr} style={{ verticalAlign: "-2px" }} />;
  // ungabunga
  if (UNGA.kind === "emoji") return <span style={{ fontSize: size }}>{UNGA.emoji}</span>;
  if (UNGA.kind === "cdn") return <img src={`https://cdn.discordapp.com/emojis/${UNGA.id}.png`} width={size} height={size} alt="" onError={imgErr} style={{ verticalAlign: "-2px" }} />;
  return <img src={UNGA.src} width={size} height={size} alt="" onError={imgErr} style={{ verticalAlign: "-2px" }} />;
}

type Mark = { nome: string; pt: string | null; lider: boolean };

export default function MontarPtsBoard({
  grupos, hidden, roubo, marcacoesInit, canEdit, warKey,
}: {
  grupos: GrupoConf[]; hidden: PlayerConf[]; roubo: PlayerConf[]; marcacoesInit: PtRow[]; canEdit: boolean; warKey: string | null;
}) {
  const router = useRouter();
  const [marks, setMarks] = useState<Map<string, Mark>>(() => {
    const m = new Map<string, Mark>();
    for (const r of marcacoesInit) m.set(r.chave, { nome: r.familia, pt: r.pt, lider: r.lider });
    return m;
  });
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");
  const [popup, setPopup] = useState(false);

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
    flushingRef.current = true; setSaving(true);
    try {
      while (opQueueRef.current.length) {
        const batch = opQueueRef.current; opQueueRef.current = [];
        const res = await fetch("/api/confirmados/pt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ops: batch, warKey }) });
        if (!res.ok) { const j = await res.json().catch(() => ({} as { error?: string })); throw new Error(j.error || `erro ${res.status}`); }
      }
      setErro(""); router.refresh(); // propaga e re-sincroniza
    } catch (e) { setErro((e as Error).message); }
    finally { flushingRef.current = false; setSaving(false); }
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

  // re-sincroniza do servidor (outro PC editou) FILTRANDO a quem é membro agora. Quem não
  // é mais membro (removido na substituição, ou roubo que sumiu) some da visão sem apagar a
  // marca no banco — assim "desfazer" a substituição traz a marca de volta. lastSig evita
  // atropelar edição local e loops; effect sem dep-array re-tenta após o flush.
  const initSig = useMemo(() => marcacoesInit.map((r) => `${r.chave}:${r.pt}:${r.lider ? 1 : 0}`).join("\n"), [marcacoesInit]);
  const membrosSig = useMemo(() => membros.map((p) => chaveNome(p.nome)).join("\n"), [membros]);
  const lastSyncSig = useRef("");
  useEffect(() => {
    const sig = initSig + "##" + membrosSig;
    if (sig === lastSyncSig.current || flushingRef.current) return; // sem mudança ou edição em voo
    lastSyncSig.current = sig;
    const valid = new Set(membros.map((p) => chaveNome(p.nome)));
    const m = new Map<string, Mark>();
    for (const r of marcacoesInit) if (valid.has(r.chave)) m.set(r.chave, { nome: r.familia, pt: r.pt, lider: r.lider });
    setMarks(m);
  });

  function togglePt(p: PlayerConf, ptKey: string) {
    if (!canEdit) return;
    const k = chaveNome(p.nome);
    const cur = marks.get(k);
    const novoPt = cur?.pt === ptKey ? null : ptKey;
    const next = new Map(marks);
    // trocar/limpar o squad zera a coroa — líder é por-PT (re-marque a coroa na PT nova
    // se quiser). Evita 2 líderes na PT destino e coroa órfã (líder sem PT).
    if (!novoPt) next.delete(k); else next.set(k, { nome: p.nome, pt: novoPt, lider: false });
    commit(next);
  }

  function toggleCoroa(p: PlayerConf) {
    if (!canEdit) return;
    const k = chaveNome(p.nome);
    const cur = marks.get(k);
    const novoLider = !cur?.lider;
    const next = new Map(marks);
    if (novoLider && cur?.pt) { // 1 líder por PT: tira a coroa de outros da mesma PT
      for (const [kk, v] of next) if (kk !== k && v.pt === cur.pt && v.lider) next.set(kk, { ...v, lider: false });
    }
    const m: Mark = { nome: p.nome, pt: cur?.pt ?? null, lider: novoLider };
    if (!m.pt && !m.lider) next.delete(k); else next.set(k, m);
    commit(next);
  }

  async function resetar() {
    if (!canEdit || !confirm("Limpar todas as marcações de PT (coroas e quadrados)?")) return;
    setMarks(new Map()); opQueueRef.current = []; setSaving(true);
    try {
      const res = await fetch("/api/confirmados/pt", { method: "DELETE" });
      if (!res.ok) { const j = await res.json().catch(() => ({} as { error?: string })); throw new Error(j.error || "falha ao limpar"); }
      setErro(""); router.refresh();
    } catch (e) { setErro((e as Error).message); }
    finally { setSaving(false); }
  }

  // listas do popup
  const ptListas = useMemo(() => PTS.map((pt) => {
    const lista = membros.filter((p) => marks.get(chaveNome(p.nome))?.pt === pt.key);
    lista.sort((a, b) => (marks.get(chaveNome(b.nome))?.lider ? 1 : 0) - (marks.get(chaveNome(a.nome))?.lider ? 1 : 0));
    return { pt, dentro: lista.slice(0, VAGAS_PT), fora: lista.slice(VAGAS_PT), total: lista.length };
  }), [membros, marks]);

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
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
        <Coroa p={p} />
        {g && <img src={g.icon} alt={p.tag ?? ""} width={14} height={14} style={{ borderRadius: 3 }} />}
        <span style={{ color: C.texto, fontWeight: m?.lider ? 700 : 400 }}>{p.nome}</span>
        {p.nota && <span style={{ color: C.mute, fontSize: 11 }}>({p.nota})</span>}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 3 }}>
          {PTS.map((pt) => {
            const active = m?.pt === pt.key;
            return (
              <button key={pt.key} onClick={() => togglePt(p, pt.key)} disabled={!canEdit} title={pt.nome}
                style={{ width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 5, border: `1px solid ${active ? C.verde : C.border2}`, background: active ? C.verdeTint : "transparent", color: active ? C.verde : C.mute, cursor: canEdit ? "pointer" : "default", padding: 0 }}>
                <PtGlyph k={pt.key} />
              </button>
            );
          })}
        </span>
      </div>
    );
  };

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "14px 16px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <div style={{ color: C.verde, fontWeight: 700, fontSize: 14 }}>Montar PTs <span style={{ color: C.mute, fontWeight: 400, fontSize: 12 }}>(squads)</span></div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {saving && <span style={{ color: C.mute, fontSize: 12 }}>salvando…</span>}
          <button onClick={() => setPopup(true)} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.verdeTint, color: C.verde, padding: "6px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>👁 Visualizar PT&apos;s</button>
          {canEdit && marks.size > 0 && !saving && (
            <button onClick={resetar} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.vermelho, padding: "6px 11px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>↺ Limpar</button>
          )}
        </div>
      </div>
      <div style={{ color: C.mute, fontSize: 11.5, marginBottom: 12 }}>
        {canEdit
          ? "👑 = líder da PT (1 por PT). Quadrados = em qual squad cada um vai (1 / 2 / Defesa / UngaBunga). Salva e reseta junto com a war."
          : "Composição montada pela staff. Use “Visualizar PT’s” pra ver as listas."}
      </div>

      {erro && <div style={{ color: C.vermelho, fontSize: 13, marginBottom: 8 }}>⚠ {erro}</div>}

      {/* grupos do bot */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {grupos.map((g) => (
          <div key={g.nome} style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surfaceSolid, padding: "11px 13px" }}>
            <div style={{ color: C.verde, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{g.nome}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {g.players.length === 0 ? <span style={{ color: C.borderSoft, fontSize: 12 }}>—</span> : g.players.map((p, i) => <MemberRow key={i} p={p} />)}
            </div>
          </div>
        ))}
      </div>

      {/* reservas (hidden, como se estivessem no bot) */}
      {hidden.length > 0 && (
        <div style={{ border: `1px dashed ${C.border2}`, borderRadius: 12, background: C.surfaceSolid, padding: "11px 13px", marginTop: 12 }}>
          <div style={{ color: C.amarelo, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Reservas (fora do bot) <span style={{ color: C.mute, fontWeight: 400 }}>({hidden.length})</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "5px 16px" }}>
            {hidden.map((p, i) => <MemberRow key={i} p={p} />)}
          </div>
        </div>
      )}

      {/* roubaram vaga (pós-liberação 20:30 — Participar in-game sem ser oficial) */}
      {roubo.length > 0 && (
        <div style={{ border: `1px dashed ${C.laranja}`, borderRadius: 12, background: C.surfaceSolid, padding: "11px 13px", marginTop: 12 }}>
          <div style={{ color: C.laranja, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>🏴 Roubaram vaga <span style={{ color: C.mute, fontWeight: 400 }}>({roubo.length})</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "5px 16px" }}>
            {roubo.map((p, i) => <MemberRow key={i} p={p} />)}
          </div>
        </div>
      )}

      {/* popup Visualizar PT's */}
      {popup && (
        <div onClick={() => setPopup(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 50, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 1100, border: `1px solid ${C.border2}`, borderRadius: 14, background: C.bg0, padding: "18px 20px", boxShadow: "0 0 40px rgba(0,0,0,.6)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ color: C.amarelo, fontWeight: 800, fontSize: 16, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 1 }}>PTs montadas</div>
              <button onClick={() => setPopup(false)} style={{ background: "none", border: "none", color: C.mute, cursor: "pointer", fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14 }}>
              {ptListas.map(({ pt, dentro, fora, total }) => (
                <div key={pt.key} style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ color: C.verde, fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}><PtGlyph k={pt.key} size={16} /> {pt.nome}</span>
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
