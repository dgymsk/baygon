"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { TIPOS } from "@/lib/participacaoConfig";
import type { Evento } from "@/lib/eventos";
import type { TemplateOpt } from "./page";

const rotulo = (t: string) => (t === "siege" ? "Siege" : t === "nodewar" ? "Nodewar" : t);
function statusBadge(s: string) {
  const map: Record<string, { txt: string; cor: string }> = {
    aberto: { txt: "● aberto", cor: C.verde },
    travado: { txt: "🔒 travado", cor: C.amarelo },
    finalizado: { txt: "🏁 finalizado", cor: C.mute },
  };
  const m = map[s] ?? { txt: s, cor: C.mute };
  return <span style={{ color: m.cor, fontSize: 11.5, fontWeight: 700, border: `1px solid ${C.border2}`, borderRadius: 999, padding: "2px 9px" }}>{m.txt}</span>;
}

export default function EventosBoard({ ativos, historico, templates, filtros, aba, canEdit }: {
  ativos: Evento[]; historico: Evento[]; templates: TemplateOpt[]; filtros: { q: string; tipo: string; de: string; ate: string }; aba: "ativos" | "historico"; canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [f, setF] = useState(filtros);
  const [disp, setDisp] = useState<Record<string, string>>({});
  const [disparando, setDisparando] = useState(false);

  async function disparar(t: string) {
    const templateId = Number(disp[t]);
    if (!templateId) return;
    if (!confirm(`Disparar ${rotulo(t)} agora? Cria um novo evento e posta a mensagem no Discord.`)) return;
    setDisparando(true);
    try {
      const res = await fetch("/api/participacao/postar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) alert(d.error || "falha ao disparar");
      else { setDisp((s) => ({ ...s, [t]: "" })); router.refresh(); }
    } finally { setDisparando(false); }
  }

  async function acao(id: number, kind: "travar" | "finalizar") {
    const desc = kind === "travar" ? "TRAVAR (nenhuma participação extra será registrada)" : "FINALIZAR (congela o resultado no histórico e tira os botões da mensagem)";
    if (!confirm(`Confirmar ${desc}?`)) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/eventos/${id}/${kind}`, { method: "POST" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "falha na ação"); }
      else router.refresh();
    } finally { setBusy(null); }
  }

  function buscar() {
    const p = new URLSearchParams({ aba: "historico" });
    if (f.q.trim()) p.set("q", f.q.trim());
    if (f.tipo) p.set("tipo", f.tipo);
    if (f.de) p.set("de", f.de);
    if (f.ate) p.set("ate", f.ate);
    router.push(`/eventos?${p.toString()}`);
  }

  const card = { border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 14 } as const;
  const input = { background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "6px 9px", fontSize: 12.5, outline: "none" } as const;
  const btn = (color: string = C.verde) => ({ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" } as const);
  const abaBtn = (a: "ativos" | "historico", txt: string) => (
    <Link href={a === "ativos" ? "/eventos" : "/eventos?aba=historico"} style={{ textDecoration: "none", borderRadius: 8, border: `1px solid ${aba === a ? C.verde : C.border2}`, background: aba === a ? C.verdeTint : "transparent", color: aba === a ? C.verde : C.mute, padding: "7px 15px", fontSize: 13, fontWeight: 700 }}>{txt}</Link>
  );

  function Cartao({ e, acoes }: { e: Evento; acoes: boolean }) {
    return (
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
          <span style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>{rotulo(e.tipo)} · {e.data}</span>
          {statusBadge(e.status)}
        </div>
        <Link href={`/eventos/${e.uuid}`} style={{ color: C.texto, fontSize: 15, fontWeight: 700, textDecoration: "none" }}>{e.titulo || "(sem título)"}</Link>
        <div style={{ color: C.borderSoft, fontSize: 11, marginTop: 4, fontFamily: "'Share Tech Mono', monospace" }}>{e.uuid}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <Link href={`/eventos/${e.uuid}`} style={{ ...btn(C.amarelo), textDecoration: "none" }}>Abrir →</Link>
          {acoes && canEdit && e.status === "aberto" && <button onClick={() => acao(e.id, "travar")} disabled={busy === e.id} style={btn(C.amarelo)}>🔒 Travar</button>}
          {acoes && canEdit && e.status !== "finalizado" && <button onClick={() => acao(e.id, "finalizar")} disabled={busy === e.id} style={btn(C.verde)}>🏁 Finalizar</button>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/mascot.png" alt="" width={38} height={38} style={{ filter: "drop-shadow(0 0 10px rgba(126,224,70,.45))" }} />
            <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 26, letterSpacing: 1, margin: 0, color: C.amarelo }}>BAYGON <span style={{ color: C.mute, fontSize: 14, letterSpacing: 2 }}>· EVENTOS</span></h1>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Link className="navlink" href="/painel">← Painel</Link>
            <Link className="navlink" href="/participacao">Participação</Link>
            <Link className="navlink" href="/confirmados">Confirmados</Link>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {abaBtn("ativos", `Ativos (${ativos.length})`)}
          {abaBtn("historico", "Histórico")}
        </div>

        {aba === "ativos" ? (
          <>
            {canEdit && (
              <div style={{ ...card, marginBottom: 14 }}>
                <div style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>Disparar novo evento</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10 }}>
                  {TIPOS.map((t) => {
                    const tpl = templates.filter((x) => x.tipo === t);
                    return (
                      <div key={t} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ color: C.verde, fontSize: 12.5, fontWeight: 700, width: 64 }}>{rotulo(t)}</span>
                        <select value={disp[t] ?? ""} onChange={(e) => setDisp((s) => ({ ...s, [t]: e.target.value }))} style={{ ...input, flex: 1 }}>
                          <option value="">— escolha o template —</option>
                          {tpl.map((x) => <option key={x.id} value={x.id}>{x.nome}{x.tamanhoMax != null ? ` (máx ${x.tamanhoMax})` : ""}</option>)}
                        </select>
                        <button onClick={() => disparar(t)} disabled={disparando || !disp[t]} style={{ ...btn(C.verde), fontWeight: 700 }}>{disparando ? "…" : "📣 Disparar"}</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {ativos.length === 0 ? <div style={{ color: C.borderSoft, fontSize: 13 }}>Nenhum evento ativo — dispare um acima.</div> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
                {ativos.map((e) => <Cartao key={e.id} e={e} acoes />)}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ ...card, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
              <div><div style={{ color: C.mute, fontSize: 11, marginBottom: 3 }}>Buscar (título / uuid)</div><input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} onKeyDown={(e) => e.key === "Enter" && buscar()} placeholder="ex: NW Sáb" style={{ ...input, width: 180 }} /></div>
              <div><div style={{ color: C.mute, fontSize: 11, marginBottom: 3 }}>Tipo</div><select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} style={input}><option value="">todos</option><option value="nodewar">Nodewar</option><option value="siege">Siege</option></select></div>
              <div><div style={{ color: C.mute, fontSize: 11, marginBottom: 3 }}>De</div><input type="date" value={f.de} onChange={(e) => setF({ ...f, de: e.target.value })} style={input} /></div>
              <div><div style={{ color: C.mute, fontSize: 11, marginBottom: 3 }}>Até</div><input type="date" value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} style={input} /></div>
              <button onClick={buscar} style={{ ...btn(C.verde), fontWeight: 700 }}>Buscar</button>
              {(f.q || f.tipo || f.de || f.ate) && <button onClick={() => { setF({ q: "", tipo: "", de: "", ate: "" }); router.push("/eventos?aba=historico"); }} style={btn(C.mute)}>limpar</button>}
            </div>
            {historico.length === 0 ? <div style={{ color: C.borderSoft, fontSize: 13 }}>Nenhum evento no histórico com esses filtros.</div> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
                {historico.map((e) => <Cartao key={e.id} e={e} acoes={false} />)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
