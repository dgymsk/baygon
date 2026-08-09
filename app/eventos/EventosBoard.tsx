"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import type { Evento } from "@/lib/eventos";

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

// Registro (read-only): navega e abre o detalhe. Operar (disparar/travar/finalizar) é em /participacao.
export default function EventosBoard({ ativos, historico, filtros, aba, canEdit }: {
  ativos: Evento[]; historico: Evento[]; filtros: { q: string; tipo: string; de: string; ate: string }; aba: "ativos" | "historico"; canEdit: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState(filtros);
  const [novo, setNovo] = useState<{ tipo: string; data: string; titulo: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function criarRetroativo() {
    if (!novo || salvando) return;
    setSalvando(true);
    try {
      const res = await fetch("/api/eventos/criar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(novo) });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.uuid) router.push(`/eventos/${d.uuid}`);
      else { alert(d.error || "falha ao criar"); setSalvando(false); }
    } catch { setSalvando(false); }
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

  function Cartao({ e }: { e: Evento }) {
    return (
      <Link href={`/eventos/${e.uuid}`} style={{ ...card, display: "block", textDecoration: "none" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
          <span style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>{rotulo(e.tipo)} · {e.data}</span>
          {statusBadge(e.status)}
        </div>
        <div style={{ color: C.texto, fontSize: 15, fontWeight: 700 }}>{e.titulo || "(sem título)"}</div>
        <div style={{ color: C.dim, fontSize: 11, marginTop: 4, fontFamily: "'Share Tech Mono', monospace" }}>{e.uuid}</div>
        <div style={{ color: C.amarelo, fontSize: 12, marginTop: 8 }}>Abrir →</div>
      </Link>
    );
  }

  return (
    <div className="pg" style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/mascot.png" alt="" width={38} height={38} style={{ filter: "drop-shadow(0 0 10px rgba(204,0,0,.45))" }} />
            <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 26, letterSpacing: 1, margin: 0, color: C.amarelo }}>BAYGON <span style={{ color: C.mute, fontSize: 14, letterSpacing: 2 }}>· EVENTOS</span></h1>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Link className="navlink" href="/painel">← Painel</Link>
            <Link className="navlink" href="/participacao">Participação (operar)</Link>
            <Link className="navlink" href="/confirmados">Confirmados</Link>
          </div>
        </div>

        <p style={{ color: C.mute, fontSize: 12.5, margin: "0 0 14px" }}>
          Registro dos eventos. Para <b style={{ color: C.verde }}>disparar</b>, <b style={{ color: C.verde }}>acompanhar ao vivo</b> e <b style={{ color: C.verde }}>travar/finalizar</b>, use a aba <Link href="/participacao" style={{ color: C.verde }}>Disparo/Situação</Link> da Participação.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
          {abaBtn("ativos", `Ativos (${ativos.length})`)}
          {abaBtn("historico", "Histórico")}
          {canEdit && <button onClick={() => setNovo(novo ? null : { tipo: "nodewar", data: "", titulo: "" })} style={{ ...btn(novo ? C.amarelo : C.verde), fontWeight: 700, marginLeft: "auto" }}>{novo ? "× cancelar" : "＋ Novo evento (retroativo)"}</button>}
        </div>

        {canEdit && novo && (
          <div style={{ ...card, marginBottom: 16, borderColor: C.verde }}>
            <div style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>Novo evento retroativo — sem disparo (para pendurar o resultado de uma war passada)</div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div><div style={{ color: C.mute, fontSize: 11, marginBottom: 3 }}>Tipo</div><select value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value })} style={input}><option value="nodewar">Nodewar</option><option value="siege">Siege</option></select></div>
              <div><div style={{ color: C.mute, fontSize: 11, marginBottom: 3 }}>Data</div><input type="date" value={novo.data} onChange={(e) => setNovo({ ...novo, data: e.target.value })} style={input} /></div>
              <div style={{ flex: 1, minWidth: 180 }}><div style={{ color: C.mute, fontSize: 11, marginBottom: 3 }}>Título</div><input value={novo.titulo} onChange={(e) => setNovo({ ...novo, titulo: e.target.value })} placeholder="ex: NW Sáb — Nó 40" style={{ ...input, width: "100%" }} /></div>
              <button onClick={criarRetroativo} disabled={salvando} style={{ ...btn(C.verde), fontWeight: 700, opacity: salvando ? 0.6 : 1 }}>{salvando ? "criando…" : "Criar"}</button>
            </div>
            <div style={{ color: C.dim, fontSize: 11, marginTop: 8 }}>Cria já finalizado (sem snapshot). Data em branco = hoje.</div>
          </div>
        )}

        {aba === "ativos" ? (
          ativos.length === 0 ? <div style={{ color: C.dim, fontSize: 13 }}>Nenhum evento ativo. Dispare na <Link href="/participacao" style={{ color: C.verde }}>Participação</Link>.</div> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))", gap: 12 }}>
              {ativos.map((e) => <Cartao key={e.id} e={e} />)}
            </div>
          )
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
            {historico.length === 0 ? <div style={{ color: C.dim, fontSize: 13 }}>Nenhum evento no histórico com esses filtros.</div> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))", gap: 12 }}>
                {historico.map((e) => <Cartao key={e.id} e={e} />)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
