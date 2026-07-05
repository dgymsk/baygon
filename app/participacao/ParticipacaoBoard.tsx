"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { TIPOS, rotuloTipo, type ParticipacaoConfig, type Tipo, type TipoCfg } from "@/lib/participacaoConfig";
import type { DadosTipo } from "./page";

const GUILD: Record<string, { label: string; icon: string }> = {
  MANI: { label: "Manicômio", icon: "/guilds/manicomio.png" },
  RESO: { label: "Resonance", icon: "/guilds/resonance.png" },
};
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const imgErr = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = "none"; };

type Status = { kind: "idle" | "saving" | "ok" | "err"; msg?: string };

export default function ParticipacaoBoard({ cfgInit, dados, canEdit }: { cfgInit: ParticipacaoConfig; dados: Record<Tipo, DadosTipo>; canEdit: boolean }) {
  const router = useRouter();
  const ro = !canEdit;
  const [cfg, setCfg] = useState<ParticipacaoConfig>(cfgInit);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [disparando, setDisparando] = useState<Tipo | null>(null);

  const setField = (t: Tipo, campo: keyof TipoCfg, valor: string) => setCfg((c) => ({ ...c, [t]: { ...c[t], [campo]: valor } }));
  const setAgenda = (t: Tipo, patch: Partial<TipoCfg["agenda"]>) => setCfg((c) => ({ ...c, [t]: { ...c[t], agenda: { ...c[t].agenda, ...patch } } }));
  const toggleDia = (t: Tipo, d: number) => setCfg((c) => {
    const dias = c[t].agenda.dias.includes(d) ? c[t].agenda.dias.filter((x) => x !== d) : [...c[t].agenda.dias, d].sort((a, b) => a - b);
    return { ...c, [t]: { ...c[t], agenda: { ...c[t].agenda, dias } } };
  });

  async function salvar() {
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/participacao/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha ao salvar");
      setCfg(d as ParticipacaoConfig); // reflete o que foi sanitizado no servidor
      setStatus({ kind: "ok", msg: "Config salva." });
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }

  async function disparar(t: Tipo) {
    if (!confirm(`Postar a mensagem de participação da ${rotuloTipo(t)} no Discord agora?`)) return;
    setDisparando(t); setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/participacao/postar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo: t }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha ao postar");
      setStatus({ kind: "ok", msg: `Mensagem da ${rotuloTipo(t)} postada.` });
      router.refresh();
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
    finally { setDisparando(null); }
  }

  const card = { border: `1px solid ${C.border}`, borderRadius: 16, background: C.surface, padding: 18 } as const;
  const input = { background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "7px 10px", fontSize: 13, outline: "none", width: "100%" } as const;
  const label = { color: C.mute, fontSize: 11.5, textTransform: "uppercase" as const, letterSpacing: 1, marginBottom: 4, display: "block" };
  const btn = (color: string = C.verde) => ({ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" } as const);

  return (
    <div style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>

      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/mascot.png" alt="" width={38} height={38} style={{ filter: "drop-shadow(0 0 10px rgba(126,224,70,.45))" }} />
            <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 26, letterSpacing: 1, margin: 0, color: C.amarelo }}>
              BAYGON <span style={{ color: C.mute, fontSize: 14, letterSpacing: 2 }}>· PARTICIPAÇÃO</span>
            </h1>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Link className="navlink" href="/painel">← Painel</Link>
            <Link className="navlink" href="/confirmados">Confirmados</Link>
            <Link className="navlink" href="/membros">Membros</Link>
            {ro && <span style={{ color: C.amarelo, fontSize: 12, border: `1px solid ${C.border2}`, borderRadius: 999, padding: "3px 10px" }}>🔒 somente leitura</span>}
            {status.kind === "ok" && <span style={{ color: C.verde, fontSize: 13 }}>✓ {status.msg}</span>}
            {status.kind === "err" && <span style={{ color: C.vermelho, fontSize: 13 }}>⚠ {status.msg}</span>}
            {canEdit && (
              <button onClick={salvar} disabled={status.kind === "saving"} style={{ ...btn(C.amarelo), padding: "8px 16px", fontSize: 13 }}>
                {status.kind === "saving" ? "Salvando…" : "Salvar config"}
              </button>
            )}
          </div>
        </div>

        <p style={{ color: C.mute, fontSize: 12.5, margin: "4px 0 18px" }}>
          Bot de participação próprio. Configure canal, texto e agenda de cada tipo, dispare a mensagem com botões <b style={{ color: C.verde }}>Can</b>/<b style={{ color: C.vermelho }}>Cant</b>, e veja abaixo quem topou — com a guilda do <Link className="navlink" href="/membros" style={{ color: C.verde }}>painel de membros</Link>.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))", gap: 16 }}>
          {TIPOS.map((t) => {
            const c = cfg[t];
            const d = dados[t];
            const can = d.respostas.filter((r) => r.resposta === "can");
            const cant = d.respostas.filter((r) => r.resposta === "cant");
            return (
              <div key={t} style={card}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 16, fontWeight: 700, color: C.verde, letterSpacing: 1 }}>{rotuloTipo(t).toUpperCase()}</span>
                  {canEdit && (
                    <button onClick={() => disparar(t)} disabled={disparando !== null} style={{ ...btn(C.verde), fontWeight: 700 }}>
                      {disparando === t ? "Postando…" : "📣 Disparar agora"}
                    </button>
                  )}
                </div>

                {/* config */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <div><label style={label}>Canal (ID)</label><input value={c.channelId} readOnly={ro} onChange={(e) => setField(t, "channelId", e.target.value.replace(/[^0-9]/g, ""))} placeholder="1521683409175449640" style={input} /></div>
                  <div><label style={label}>Cargo a mencionar (opcional)</label><input value={c.pingRoleId} readOnly={ro} onChange={(e) => setField(t, "pingRoleId", e.target.value.replace(/[^0-9]/g, ""))} placeholder="ID do cargo (vazio = ninguém)" style={input} /></div>
                </div>
                <div style={{ marginBottom: 10 }}><label style={label}>Título</label><input value={c.titulo} readOnly={ro} onChange={(e) => setField(t, "titulo", e.target.value)} style={input} /></div>
                <div style={{ marginBottom: 10 }}><label style={label}>Mensagem</label><textarea value={c.mensagem} readOnly={ro} onChange={(e) => setField(t, "mensagem", e.target.value)} rows={2} style={{ ...input, resize: "vertical" }} /></div>

                {/* agenda */}
                <div style={{ border: `1px solid ${C.border2}`, borderRadius: 10, padding: "9px 11px", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.texto, fontSize: 12.5, cursor: ro ? "default" : "pointer" }}>
                      <input type="checkbox" checked={c.agenda.ativo} disabled={ro} onChange={(e) => setAgenda(t, { ativo: e.target.checked })} style={{ accentColor: C.verde }} />
                      Agendar automático
                    </label>
                    <select value={String(Number(c.agenda.hora.split(":")[0])).padStart(2, "0")} disabled={ro} onChange={(e) => setAgenda(t, { hora: `${e.target.value}:00` })} style={{ ...input, width: 90 }}>
                      {Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")).map((h) => <option key={h} value={h}>{h}:00</option>)}
                    </select>
                    <span style={{ color: C.mute, fontSize: 11 }}>Brasília, no topo da hora</span>
                  </div>
                  <div style={{ display: "flex", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
                    {DIAS.map((nome, i) => {
                      const on = c.agenda.dias.includes(i);
                      return (
                        <button key={i} onClick={() => !ro && toggleDia(t, i)} disabled={ro}
                          style={{ borderRadius: 7, border: `1px solid ${on ? C.verde : C.border2}`, background: on ? C.verdeTint : "transparent", color: on ? C.verde : C.mute, padding: "3px 8px", fontSize: 12, fontWeight: 600, cursor: ro ? "default" : "pointer" }}>{nome}</button>
                      );
                    })}
                  </div>
                </div>

                {/* listas */}
                <Lista titulo="Can" cor={C.verde} itens={can} vazio="ninguém marcou Can ainda" />
                <div style={{ height: 10 }} />
                <Lista titulo="Cant" cor={C.vermelho} itens={cant} vazio="—" />
                {d.post && <div style={{ color: C.borderSoft, fontSize: 10.5, marginTop: 8 }}>rodada: msg {d.post.message_id}</div>}
                {!d.post && <div style={{ color: C.mute, fontSize: 11, marginTop: 8 }}>Nenhuma mensagem postada ainda — dispare acima ou use <b>/participacao-{t}</b> no Discord.</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Lista({ titulo, cor, itens, vazio }: { titulo: string; cor: string; itens: { user_id: string; username: string; familia: string | null; guilda: string | null }[]; vazio: string }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ color: cor, fontWeight: 700, fontSize: 13 }}>{titulo}</span>
        <span style={{ color: C.mute, fontSize: 12 }}>({itens.length})</span>
      </div>
      {itens.length === 0 ? (
        <span style={{ color: C.borderSoft, fontSize: 12 }}>{vazio}</span>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "3px 12px" }}>
          {itens.map((r) => {
            const g = r.guilda ? GUILD[r.guilda] : null;
            return (
              <span key={r.user_id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: C.texto }}>
                {g && <img src={g.icon} alt={r.guilda ?? ""} width={13} height={13} onError={imgErr} style={{ borderRadius: 2 }} />}
                {r.familia || r.username}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
