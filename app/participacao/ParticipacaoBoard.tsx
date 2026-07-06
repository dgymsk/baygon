"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { TIPOS, rotuloTipo, type ParticipacaoConfig, type Tipo, type TipoCfg } from "@/lib/participacaoConfig";
import type { PtVM, MembroVM, TemplateVM, SituacaoVM, MembroSit, EmojiGuild } from "./page";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const imgErr = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = "none"; };
type Status = { kind: "idle" | "saving" | "ok" | "err"; msg?: string };
type Aba = "disparo" | "pts" | "templates" | "atribuicao";

function idEmoji(raw: string, emojis: EmojiGuild[]): string | null {
  const m = raw.match(/^<a?:\w+:(\d+)>$/); if (m) return m[1];
  const sc = raw.match(/^:?([\w~]+):?$/); if (sc) { const e = emojis.find((x) => x.name.toLowerCase() === sc[1].toLowerCase()); if (e) return e.id; }
  return null;
}
function GEmoji({ emoji, emojis, size = 15 }: { emoji: string; emojis: EmojiGuild[]; size?: number }) {
  if (!emoji) return null;
  const id = idEmoji(emoji, emojis);
  if (id) return <img src={`https://cdn.discordapp.com/emojis/${id}.png`} width={size} height={size} alt="" onError={imgErr} style={{ verticalAlign: "-2px" }} />;
  if (!/^:?[\w~]+:?$/.test(emoji)) return <span style={{ fontSize: size }}>{emoji}</span>;
  return null;
}
function NomePerfil({ nome, userId, bold }: { nome: string; userId: string | null; bold?: boolean }) {
  const st = { color: bold ? C.texto : C.mute, fontWeight: bold ? 700 : 400 } as const;
  if (!userId) return <span style={st}>{nome}</span>;
  return <a href={`https://discord.com/users/${userId}`} target="_blank" rel="noreferrer" style={{ ...st, color: C.texto, textDecoration: "none" }} className="navlink2">{nome}</a>;
}
const statusIcon = (s: MembroSit["status"]) => (s === "can" ? "✅" : s === "espera" ? "⏳" : s === "cant" ? "❌" : "⬜");

export default function ParticipacaoBoard({
  cfgInit, pts, membros, templates, situacao, playersAtivos, emojis, canEdit,
}: {
  cfgInit: ParticipacaoConfig; pts: PtVM[]; membros: MembroVM[]; templates: TemplateVM[]; situacao: Record<Tipo, SituacaoVM>;
  playersAtivos: string[]; emojis: EmojiGuild[]; canEdit: boolean;
}) {
  const router = useRouter();
  const ro = !canEdit;
  const [aba, setAba] = useState<Aba>("disparo");
  const [cfg, setCfg] = useState<ParticipacaoConfig>(cfgInit);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [disparando, setDisparando] = useState(false);
  const [disparoSel, setDisparoSel] = useState<Record<Tipo, string>>({ nodewar: "", siege: "" });
  const [novoPt, setNovoPt] = useState({ nome: "", emoji: "" });
  const [novoTpl, setNovoTpl] = useState<{ nome: string; tipo: Tipo; tamanhoMax: string; pts: { pt_id: number; limite: number | null }[] }>({ nome: "", tipo: "nodewar", tamanhoMax: "", pts: [] });
  const [tipoAtrib, setTipoAtrib] = useState<Tipo>("nodewar");
  const [filtro, setFiltro] = useState("");
  const [atrib, setAtrib] = useState<Record<Tipo, Record<string, string>>>(() => {
    const o = { nodewar: {}, siege: {} } as Record<Tipo, Record<string, string>>;
    for (const m of membros) o[m.tipo as Tipo][m.familia] = String(m.pt_id);
    return o;
  });
  const [tplDrafts, setTplDrafts] = useState<TemplateVM[]>(templates);
  useEffect(() => { setTplDrafts(templates); }, [templates]); // ressincroniza após refresh

  const temPost = TIPOS.some((t) => situacao[t]);
  useEffect(() => {
    if (!temPost) return;
    const id = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(id);
  }, [temPost, router]);

  async function api(url: string, init: RequestInit, msg: string) {
    setStatus({ kind: "saving" });
    try {
      const res = await fetch(url, init);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((d as { error?: string }).error ?? "falha");
      setStatus({ kind: "ok", msg }); router.refresh();
      return true;
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); return false; }
  }
  const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  // ---- config / disparo ----
  const setField = (t: Tipo, campo: keyof TipoCfg, v: string) => setCfg((c) => ({ ...c, [t]: { ...c[t], [campo]: v } }));
  const setAgenda = (t: Tipo, patch: Partial<TipoCfg["agenda"]>) => setCfg((c) => ({ ...c, [t]: { ...c[t], agenda: { ...c[t].agenda, ...patch } } }));
  const toggleDia = (t: Tipo, d: number) => setCfg((c) => {
    const dias = c[t].agenda.dias.includes(d) ? c[t].agenda.dias.filter((x) => x !== d) : [...c[t].agenda.dias, d].sort((a, b) => a - b);
    return { ...c, [t]: { ...c[t], agenda: { ...c[t].agenda, dias } } };
  });
  async function salvarConfig() {
    if (await api("/api/participacao/config", jsonInit("PUT", cfg), "Config salva.")) { /* refletido pelo refresh */ }
  }
  async function disparar(t: Tipo) {
    const templateId = Number(disparoSel[t]);
    if (!templateId) { setStatus({ kind: "err", msg: "escolha um template" }); return; }
    if (!confirm(`Disparar a participação da ${rotuloTipo(t)} no Discord agora?`)) return;
    setDisparando(true);
    await api("/api/participacao/postar", jsonInit("POST", { templateId }), `${rotuloTipo(t)} postada.`);
    setDisparando(false);
  }

  // ---- PTs ----
  const criarPt = () => { if (!novoPt.nome.trim()) return; api("/api/participacao/pts", jsonInit("POST", novoPt), `PT "${novoPt.nome}" criado.`); setNovoPt({ nome: "", emoji: "" }); };
  const editarPt = (p: PtVM, patch: Partial<{ nome: string; emoji: string }>) => api("/api/participacao/pts", jsonInit("PATCH", { id: p.id, nome: patch.nome ?? p.nome, emoji: patch.emoji ?? p.emoji }), "PT atualizado.");
  const excluirPt = (p: PtVM) => { if (confirm(`Excluir o PT "${p.nome}"? Sai dos templates e das atribuições.`)) api("/api/participacao/pts", jsonInit("DELETE", { id: p.id }), "PT excluído."); };

  // ---- templates ----
  const ptsPayload = (arr: { pt_id: number; limite: number | null }[]) => arr.map((x) => ({ ptId: x.pt_id, limite: x.limite }));
  const criarTpl = () => { if (!novoTpl.nome.trim()) return; api("/api/participacao/templates", jsonInit("POST", { nome: novoTpl.nome, tipo: novoTpl.tipo, tamanhoMax: novoTpl.tamanhoMax || null, pts: ptsPayload(novoTpl.pts) }), `template "${novoTpl.nome}" criado.`); setNovoTpl({ nome: "", tipo: "nodewar", tamanhoMax: "", pts: [] }); };
  const salvarTpl = (t: TemplateVM) => api("/api/participacao/templates", jsonInit("PATCH", { id: t.id, nome: t.nome, tipo: t.tipo, tamanhoMax: t.tamanho_max, pts: ptsPayload(t.pts) }), "template atualizado.");
  const editarTpl = (t: TemplateVM, patch: Partial<TemplateVM>) => { const novo = { ...t, ...patch }; setTplDrafts((ds) => ds.map((d) => (d.id === t.id ? novo : d))); salvarTpl(novo); };
  const togglePtTpl = (t: TemplateVM, ptId: number) => editarTpl(t, { pts: t.pts.some((x) => x.pt_id === ptId) ? t.pts.filter((x) => x.pt_id !== ptId) : [...t.pts, { pt_id: ptId, limite: null }] });
  const setLimTpl = (t: TemplateVM, ptId: number, limStr: string) => { const lim = limStr ? Number(limStr) : null; editarTpl(t, { pts: t.pts.map((x) => (x.pt_id === ptId ? { ...x, limite: lim } : x)) }); };
  // novo template (mesmos toggles, mas no estado novoTpl)
  const toggleNovoPt = (ptId: number) => setNovoTpl((n) => ({ ...n, pts: n.pts.some((x) => x.pt_id === ptId) ? n.pts.filter((x) => x.pt_id !== ptId) : [...n.pts, { pt_id: ptId, limite: null }] }));
  const setLimNovo = (ptId: number, limStr: string) => setNovoTpl((n) => ({ ...n, pts: n.pts.map((x) => (x.pt_id === ptId ? { ...x, limite: limStr ? Number(limStr) : null } : x)) }));
  const excluirTpl = (t: TemplateVM) => { if (confirm(`Excluir o template "${t.nome}"?`)) api("/api/participacao/templates", jsonInit("DELETE", { id: t.id }), "template excluído."); };

  // ---- atribuição ----
  const origAtrib: Record<Tipo, Record<string, string>> = { nodewar: {}, siege: {} };
  for (const m of membros) origAtrib[m.tipo as Tipo][m.familia] = String(m.pt_id);
  const dirtyAtrib = (t: Tipo) => JSON.stringify(atrib[t]) !== JSON.stringify(origAtrib[t]);
  async function salvarAtrib(t: Tipo) {
    const deltas: { familia: string; ptId: number | null }[] = [];
    const fams = new Set([...Object.keys(atrib[t]), ...Object.keys(origAtrib[t])]);
    for (const f of fams) { const cur = atrib[t][f] ?? ""; if (cur !== (origAtrib[t][f] ?? "")) deltas.push({ familia: f, ptId: cur ? Number(cur) : null }); }
    if (!deltas.length) return;
    await api("/api/participacao/membros", jsonInit("PUT", { tipo: t, atribuicoes: deltas }), `${deltas.length} atribuição(ões) salvas.`);
  }

  // estilos
  const card = { border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 16 } as const;
  const input = { background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "6px 9px", fontSize: 12.5, outline: "none" } as const;
  const label = { color: C.mute, fontSize: 11, textTransform: "uppercase" as const, letterSpacing: 1, marginBottom: 3, display: "block" };
  const btn = (color: string = C.verde) => ({ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" } as const);
  const abaBtn = (a: Aba, txt: string) => (
    <button onClick={() => setAba(a)} style={{ borderRadius: 8, border: `1px solid ${aba === a ? C.verde : C.border2}`, background: aba === a ? C.verdeTint : "transparent", color: aba === a ? C.verde : C.mute, padding: "7px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{txt}</button>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}} a.navlink2:hover{color:${C.verde}}`}</style>

      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
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
          </div>
        </div>

        {/* abas */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {abaBtn("disparo", "Disparo / Situação")}
          {abaBtn("pts", "PTs")}
          {abaBtn("templates", "Templates")}
          {abaBtn("atribuicao", "Atribuição")}
        </div>

        {/* ===================== DISPARO / SITUAÇÃO ===================== */}
        {aba === "disparo" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(520px, 1fr))", gap: 16 }}>
            {TIPOS.map((t) => {
              const c = cfg[t];
              const sit = situacao[t];
              const tpisTipo = templates.filter((x) => x.tipo === t);
              return (
                <div key={t} style={card}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 16, fontWeight: 700, color: C.verde, letterSpacing: 1 }}>{rotuloTipo(t).toUpperCase()}</span>
                    {canEdit && <button onClick={salvarConfig} disabled={status.kind === "saving"} style={{ ...btn(C.amarelo) }}>Salvar config</button>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div><label style={label}>Canal (ID)</label><input value={c.channelId} readOnly={ro} onChange={(e) => setField(t, "channelId", e.target.value.replace(/[^0-9]/g, ""))} placeholder="ID do canal" style={{ ...input, width: "100%" }} /></div>
                    <div><label style={label}>Cargo a mencionar</label><input value={c.pingRoleId} readOnly={ro} onChange={(e) => setField(t, "pingRoleId", e.target.value.replace(/[^0-9]/g, ""))} placeholder="opcional" style={{ ...input, width: "100%" }} /></div>
                  </div>
                  <div style={{ marginTop: 8 }}><label style={label}>Mensagem (descrição)</label><textarea value={c.mensagem} readOnly={ro} onChange={(e) => setField(t, "mensagem", e.target.value)} rows={2} style={{ ...input, width: "100%", resize: "vertical" }} /></div>
                <div style={{ marginTop: 8 }}><label style={label}>Imagem no final (URL, opcional)</label><input value={c.imagem} readOnly={ro} onChange={(e) => setField(t, "imagem", e.target.value)} placeholder="https://…" style={{ ...input, width: "100%" }} /></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.texto, fontSize: 12.5 }}>
                      <input type="checkbox" checked={c.agenda.ativo} disabled={ro} onChange={(e) => setAgenda(t, { ativo: e.target.checked })} style={{ accentColor: C.verde }} /> Agendar
                    </label>
                    <select value={String(Number(c.agenda.hora.split(":")[0])).padStart(2, "0")} disabled={ro} onChange={(e) => setAgenda(t, { hora: `${e.target.value}:00` })} style={input}>
                      {Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")).map((h) => <option key={h} value={h}>{h}:00</option>)}
                    </select>
                    {DIAS.map((nome, i) => { const on = c.agenda.dias.includes(i); return <button key={i} onClick={() => !ro && toggleDia(t, i)} disabled={ro} style={{ ...btn(on ? C.verde : C.mute), background: on ? C.verdeTint : "transparent", padding: "3px 7px" }}>{nome}</button>; })}
                  </div>

                  {/* disparo por template */}
                  {canEdit && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.borderSoft}` }}>
                      <select value={disparoSel[t]} onChange={(e) => setDisparoSel((s) => ({ ...s, [t]: e.target.value }))} style={{ ...input, flex: 1 }}>
                        <option value="">— escolha o template —</option>
                        {tpisTipo.map((x) => <option key={x.id} value={x.id}>{x.nome}{x.tamanho_max != null ? ` (máx ${x.tamanho_max})` : ""}</option>)}
                      </select>
                      <button onClick={() => disparar(t)} disabled={disparando || !disparoSel[t]} style={{ ...btn(C.verde), fontWeight: 700 }}>{disparando ? "Postando…" : "📣 Disparar"}</button>
                    </div>
                  )}

                  {/* situação ao vivo */}
                  <div style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, margin: "14px 0 7px", borderTop: `1px solid ${C.borderSoft}`, paddingTop: 10 }}>
                    Situação {sit ? <span style={{ color: C.verde, textTransform: "none", letterSpacing: 0 }}>● {sit.templateNome} — {sit.totalConfirmados}{sit.tamanhoMax != null ? `/${sit.tamanhoMax}` : ""}{sit.totalEspera > 0 ? ` · ⏳ ${sit.totalEspera} espera` : ""}</span> : <span style={{ color: C.mute, textTransform: "none", letterSpacing: 0 }}>(sem rodada — dispare acima)</span>}
                  </div>
                  {!sit ? <span style={{ color: C.borderSoft, fontSize: 12 }}>—</span> : (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                        {sit.pts.map((g) => (
                          <div key={g.id} style={{ border: `1px solid ${C.border2}`, borderRadius: 10, background: C.surfaceSolid, padding: "8px 10px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, paddingBottom: 5, borderBottom: `1px solid ${C.borderSoft}` }}>
                              <GEmoji emoji={g.emoji} emojis={emojis} size={16} /><b style={{ color: C.verde, fontSize: 13, flex: 1 }}>{g.nome}</b><span style={{ color: g.limite != null && g.confirmados.length >= g.limite ? C.amarelo : C.mute, fontSize: 12, fontWeight: 700 }}>{g.confirmados.length}{g.limite != null ? `/${g.limite}` : ""}</span>
                            </div>
                            {g.confirmados.length === 0 && g.espera.length === 0 ? <span style={{ color: C.borderSoft, fontSize: 12 }}>ninguém confirmou</span> : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                {g.confirmados.map((m, i) => <span key={"c" + i} style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 5 }}>✅ <NomePerfil nome={m.familia} userId={m.userId} bold /></span>)}
                                {g.espera.length > 0 && <span style={{ color: C.amarelo, fontSize: 11, fontWeight: 700, marginTop: 3 }}>⏳ Espera</span>}
                                {g.espera.map((m, i) => <span key={"e" + i} style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 5 }}>⏳ <NomePerfil nome={m.familia} userId={m.userId} /></span>)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      {sit.semPt.length > 0 && (
                        <div style={{ marginTop: 8, border: `1px solid ${C.amarelo}`, borderRadius: 10, background: C.inputBg, padding: "7px 11px", fontSize: 12.5 }}>
                          <b style={{ color: C.amarelo }}>🆕 Sem PT ({sit.semPt.length})</b>
                          <div style={{ marginTop: 3 }}>{sit.semPt.map((r, i) => <span key={r.userId ?? i}>{statusIcon(r.status)} <NomePerfil nome={r.familia || "?"} userId={r.userId} bold />{i < sit.semPt.length - 1 ? "  " : ""}</span>)}</div>
                        </div>
                      )}
                      {sit.naoDecididos.length > 0 && (
                        <div style={{ marginTop: 8, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 8 }}>
                          <div style={{ color: C.mute, fontSize: 12, fontWeight: 700, marginBottom: 3 }}>⬜ Não decididos ({sit.naoDecididos.length})</div>
                          <div style={{ fontSize: 12.5, color: C.mute }}>{sit.naoDecididos.map((r, i) => <span key={r.familia + i}>{r.familia}{i < sit.naoDecididos.length - 1 ? ", " : ""}</span>)}</div>
                        </div>
                      )}
                      {sit.cant.length > 0 && (
                        <div style={{ marginTop: 8, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 8 }}>
                          <div style={{ color: C.vermelho, fontSize: 12, fontWeight: 700, marginBottom: 3 }}>❌ Não vão ({sit.cant.length})</div>
                          <div style={{ fontSize: 12.5, color: C.mute }}>{sit.cant.map((r, i) => <span key={r.userId ?? i}><NomePerfil nome={r.familia || "?"} userId={r.userId} />{i < sit.cant.length - 1 ? ", " : ""}</span>)}</div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ===================== PTs ===================== */}
        {aba === "pts" && (
          <div style={{ ...card, maxWidth: 620 }}>
            <div style={{ color: C.mute, fontSize: 12.5, marginBottom: 12 }}>Catálogo de PTs (nome + emoji do servidor). Depois use nos <b style={{ color: C.verde }}>templates</b> e na <b style={{ color: C.verde }}>atribuição</b>.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {pts.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <EmojiPicker emojis={emojis} value={p.emoji} onPick={(v) => canEdit && editarPt(p, { emoji: v })} />
                  <input defaultValue={p.nome} readOnly={ro} onBlur={(e) => canEdit && e.target.value.trim() && e.target.value !== p.nome && editarPt(p, { nome: e.target.value })} style={{ ...input, flex: 1 }} />
                  {canEdit && <button onClick={() => excluirPt(p)} title="excluir" style={{ ...btn(C.vermelho), padding: "5px 9px" }}>✕</button>}
                </div>
              ))}
              {pts.length === 0 && <span style={{ color: C.borderSoft, fontSize: 12.5 }}>nenhum PT ainda.</span>}
              {canEdit && (
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4, paddingTop: 8, borderTop: `1px solid ${C.borderSoft}` }}>
                  <EmojiPicker emojis={emojis} value={novoPt.emoji} onPick={(v) => setNovoPt((n) => ({ ...n, emoji: v }))} />
                  <input value={novoPt.nome} onChange={(e) => setNovoPt((n) => ({ ...n, nome: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && criarPt()} placeholder="novo PT (ex: Flanco)" style={{ ...input, flex: 1 }} />
                  <button onClick={criarPt} disabled={!novoPt.nome.trim()} style={{ ...btn(C.verde), fontWeight: 700 }}>+ criar</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================== TEMPLATES ===================== */}
        {aba === "templates" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
            {tplDrafts.map((t) => (
              <div key={t.id} style={card}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <input defaultValue={t.nome} readOnly={ro} onBlur={(e) => { const v = e.target.value.trim(); if (canEdit && v && v !== t.nome) editarTpl(t, { nome: v }); }} style={{ ...input, flex: 1, fontWeight: 700 }} />
                  {canEdit && <button onClick={() => excluirTpl(t)} title="excluir" style={{ ...btn(C.vermelho), padding: "5px 9px" }}>✕</button>}
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <select value={t.tipo} disabled={ro} onChange={(e) => editarTpl(t, { tipo: e.target.value })} style={{ ...input, flex: 1 }}>
                    <option value="nodewar">Nodewar</option><option value="siege">Siege</option>
                  </select>
                  <input defaultValue={t.tamanho_max ?? ""} readOnly={ro} placeholder="tamanho máx" onBlur={(e) => { const v = e.target.value.replace(/[^0-9]/g, ""); const nv = v ? Number(v) : null; if (canEdit && nv !== t.tamanho_max) editarTpl(t, { tamanho_max: nv }); }} style={{ ...input, width: 100 }} />
                </div>
                <div style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>PTs + limite de players</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {pts.map((p) => {
                    const tp = t.pts.find((x) => x.pt_id === p.id);
                    const on = !!tp;
                    return (
                      <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button disabled={ro} onClick={() => canEdit && togglePtTpl(t, p.id)}
                          style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "flex-start", gap: 4, borderRadius: 8, border: `1px solid ${on ? C.verde : C.border2}`, background: on ? C.verdeTint : "transparent", color: on ? C.verde : C.mute, padding: "4px 9px", fontSize: 12, cursor: ro ? "default" : "pointer" }}>
                          <GEmoji emoji={p.emoji} emojis={emojis} size={13} />{p.nome}</button>
                        {on && <input key={`${t.id}-${p.id}`} defaultValue={tp!.limite ?? ""} readOnly={ro} onBlur={(e) => canEdit && setLimTpl(t, p.id, e.target.value.replace(/[^0-9]/g, ""))} placeholder="limite" style={{ ...input, width: 62 }} />}
                      </div>
                    );
                  })}
                  {pts.length === 0 && <span style={{ color: C.borderSoft, fontSize: 12 }}>crie PTs primeiro (aba PTs).</span>}
                </div>
              </div>
            ))}

            {canEdit && (
              <div style={{ ...card, borderStyle: "dashed" }}>
                <div style={{ color: C.verde, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>+ Novo template</div>
                <input value={novoTpl.nome} onChange={(e) => setNovoTpl((n) => ({ ...n, nome: e.target.value }))} placeholder="nome (ex: Nodewar Padrão)" style={{ ...input, width: "100%", marginBottom: 8 }} />
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <select value={novoTpl.tipo} onChange={(e) => setNovoTpl((n) => ({ ...n, tipo: e.target.value as Tipo }))} style={{ ...input, flex: 1 }}>
                    <option value="nodewar">Nodewar</option><option value="siege">Siege</option>
                  </select>
                  <input value={novoTpl.tamanhoMax} onChange={(e) => setNovoTpl((n) => ({ ...n, tamanhoMax: e.target.value.replace(/[^0-9]/g, "") }))} placeholder="tamanho máx" style={{ ...input, width: 100 }} />
                </div>
                <div style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>PTs + limite de players</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {pts.map((p) => {
                    const tp = novoTpl.pts.find((x) => x.pt_id === p.id);
                    const on = !!tp;
                    return (
                      <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button onClick={() => toggleNovoPt(p.id)}
                          style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "flex-start", gap: 4, borderRadius: 8, border: `1px solid ${on ? C.verde : C.border2}`, background: on ? C.verdeTint : "transparent", color: on ? C.verde : C.mute, padding: "4px 9px", fontSize: 12, cursor: "pointer" }}>
                          <GEmoji emoji={p.emoji} emojis={emojis} size={13} />{p.nome}</button>
                        {on && <input value={tp!.limite ?? ""} onChange={(e) => setLimNovo(p.id, e.target.value.replace(/[^0-9]/g, ""))} placeholder="limite" style={{ ...input, width: 62 }} />}
                      </div>
                    );
                  })}
                  {pts.length === 0 && <span style={{ color: C.borderSoft, fontSize: 12 }}>crie PTs primeiro (aba PTs).</span>}
                </div>
                <button onClick={criarTpl} disabled={!novoTpl.nome.trim()} style={{ ...btn(C.verde), fontWeight: 700, marginTop: 10 }}>Criar template</button>
              </div>
            )}
          </div>
        )}

        {/* ===================== ATRIBUIÇÃO ===================== */}
        {aba === "atribuicao" && (
          <div style={{ ...card, maxWidth: 760 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <span style={{ color: C.mute, fontSize: 12 }}>Atribuir por tipo:</span>
              {TIPOS.map((t) => <button key={t} onClick={() => setTipoAtrib(t)} style={{ ...btn(tipoAtrib === t ? C.verde : C.mute), background: tipoAtrib === t ? C.verdeTint : "transparent" }}>{rotuloTipo(t)}</button>)}
              <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="filtrar jogador…" style={{ ...input, width: 140, marginLeft: "auto" }} />
              {canEdit && dirtyAtrib(tipoAtrib) && <button onClick={() => salvarAtrib(tipoAtrib)} style={{ ...btn(C.amarelo), fontWeight: 700 }}>Salvar</button>}
            </div>
            {pts.length === 0 ? <span style={{ color: C.borderSoft, fontSize: 12.5 }}>crie PTs primeiro (aba PTs).</span> : (
              <div style={{ maxHeight: "60vh", overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
                {playersAtivos.filter((p) => !filtro || p.toLowerCase().includes(filtro.toLowerCase())).map((p) => (
                  <div key={p} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                    <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p}</span>
                    <select value={atrib[tipoAtrib][p] ?? ""} disabled={ro} onChange={(e) => setAtrib((prev) => ({ ...prev, [tipoAtrib]: { ...prev[tipoAtrib], [p]: e.target.value } }))} style={{ ...input, padding: "3px 6px", maxWidth: 150 }}>
                      <option value="">—</option>
                      {pts.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// picker de emoji do servidor
function EmojiPicker({ emojis, value, onPick }: { emojis: EmojiGuild[]; value: string; onPick: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inp = { background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "6px 9px", fontSize: 12.5, outline: "none" } as const;
  const filt = emojis.filter((e) => !q.trim() || e.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 60);
  const escolher = (v: string) => { onPick(v); setOpen(false); setQ(""); };
  return (
    <div style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} title="escolher emoji"
        style={{ width: 42, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 2, borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, cursor: "pointer", color: C.mute, fontSize: 12 }}>
        {value ? <GEmoji emoji={value} emojis={emojis} size={16} /> : "😀"} ▾
      </button>
      {open && (
        <div style={{ position: "absolute", top: 36, left: 0, zIndex: 30, width: 236, border: `1px solid ${C.border2}`, borderRadius: 10, background: C.bg0, boxShadow: "0 6px 24px rgba(0,0,0,.5)", padding: 8 }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); escolher(q.trim()); } }} placeholder="buscar :emoji: ou colar unicode" style={{ ...inp, width: "100%", marginBottom: 6 }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, maxHeight: 180, overflowY: "auto" }}>
            {filt.map((e) => (
              <button key={e.id} type="button" title={`:${e.name}:`} onClick={() => escolher(`<${e.animated ? "a" : ""}:${e.name}:${e.id}>`)}
                style={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "1px solid transparent", background: "transparent", cursor: "pointer" }}>
                <img src={`https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "png"}`} width={20} height={20} alt={e.name} onError={imgErr} />
              </button>
            ))}
            {filt.length === 0 && <span style={{ color: C.mute, fontSize: 12, padding: 6 }}>nenhum emoji — cole um unicode acima</span>}
          </div>
          <button type="button" onClick={() => escolher("")} style={{ marginTop: 6, width: "100%", borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.mute, padding: "4px", fontSize: 12, cursor: "pointer" }}>sem emoji</button>
        </div>
      )}
    </div>
  );
}
