"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { chaveNome } from "@/lib/nomes";
import { TIPOS, rotuloTipo, type ParticipacaoConfig, type Tipo, type TipoCfg } from "@/lib/participacaoConfig";
import type { DadosTipo, GrupoVM, AtribVM, RespVM, EmojiGuild } from "./page";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const imgErr = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = "none"; };
type Status = { kind: "idle" | "saving" | "ok" | "err"; msg?: string };

// id do emoji custom a partir de '<:nome:id>' ou ':nome:'/'nome' (via lista do server)
function idEmoji(raw: string, emojis: EmojiGuild[]): string | null {
  const m = raw.match(/^<a?:\w+:(\d+)>$/); if (m) return m[1];
  const sc = raw.match(/^:?([\w~]+):?$/); if (sc) { const e = emojis.find((x) => x.name.toLowerCase() === sc[1].toLowerCase()); if (e) return e.id; }
  return null;
}
function GEmoji({ emoji, emojis, size = 15 }: { emoji: string; emojis: EmojiGuild[]; size?: number }) {
  if (!emoji) return null;
  const id = idEmoji(emoji, emojis);
  if (id) return <img src={`https://cdn.discordapp.com/emojis/${id}.png`} width={size} height={size} alt="" onError={imgErr} style={{ verticalAlign: "-2px" }} />;
  if (!/^:?[\w~]+:?$/.test(emoji)) return <span style={{ fontSize: size }}>{emoji}</span>; // unicode
  return null;
}

// nome clicável → perfil do Discord (só quando temos o user_id de quem clicou)
function NomePerfil({ nome, userId, bold }: { nome: string; userId: string | null; bold?: boolean }) {
  const st = { color: bold ? C.texto : C.mute, fontWeight: bold ? 700 : 400 } as const;
  if (!userId) return <span style={st}>{nome}</span>;
  return <a href={`https://discord.com/users/${userId}`} target="_blank" rel="noreferrer" style={{ ...st, color: C.texto, textDecoration: "none" }} className="navlink2">{nome}</a>;
}

export default function ParticipacaoBoard({
  cfgInit, dados, playersAtivos, emojis, canEdit,
}: {
  cfgInit: ParticipacaoConfig; dados: Record<Tipo, DadosTipo>; playersAtivos: string[]; emojis: EmojiGuild[]; canEdit: boolean;
}) {
  const router = useRouter();
  const ro = !canEdit;
  const [cfg, setCfg] = useState<ParticipacaoConfig>(cfgInit);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [disparando, setDisparando] = useState<Tipo | null>(null);
  const [atrib, setAtrib] = useState<Record<Tipo, Record<string, string>>>(() => {
    const o = {} as Record<Tipo, Record<string, string>>;
    for (const t of TIPOS) { o[t] = {}; for (const a of dados[t].atrib) o[t][a.familia] = String(a.grupo_id); }
    return o;
  });
  const [novoGrupo, setNovoGrupo] = useState<Record<Tipo, { nome: string; emoji: string; limite: string }>>(
    { nodewar: { nome: "", emoji: "", limite: "" }, siege: { nome: "", emoji: "", limite: "" } },
  );
  const [filtro, setFiltro] = useState("");

  const temPost = TIPOS.some((t) => dados[t].post);
  useEffect(() => {
    if (!temPost) return;
    const id = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(id);
  }, [temPost, router]);

  // ---- config ----
  const setField = (t: Tipo, campo: keyof TipoCfg, v: string) => setCfg((c) => ({ ...c, [t]: { ...c[t], [campo]: v } }));
  const setAgenda = (t: Tipo, patch: Partial<TipoCfg["agenda"]>) => setCfg((c) => ({ ...c, [t]: { ...c[t], agenda: { ...c[t].agenda, ...patch } } }));
  const toggleDia = (t: Tipo, d: number) => setCfg((c) => {
    const dias = c[t].agenda.dias.includes(d) ? c[t].agenda.dias.filter((x) => x !== d) : [...c[t].agenda.dias, d].sort((a, b) => a - b);
    return { ...c, [t]: { ...c[t], agenda: { ...c[t].agenda, dias } } };
  });
  async function salvarConfig() {
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/participacao/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha");
      setCfg(d as ParticipacaoConfig); setStatus({ kind: "ok", msg: "Config salva." });
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }
  async function disparar(t: Tipo) {
    if (!confirm(`Postar a participação da ${rotuloTipo(t)} no Discord agora?`)) return;
    setDisparando(t); setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/participacao/postar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo: t }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha");
      setStatus({ kind: "ok", msg: `${rotuloTipo(t)} postada.` }); router.refresh();
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
    finally { setDisparando(null); }
  }

  // ---- grupos ----
  async function grupoOp(init: RequestInit, msg: string) {
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/participacao/grupos", init);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha");
      setStatus({ kind: "ok", msg }); router.refresh();
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }
  const criarGrupo = (t: Tipo) => {
    const g = novoGrupo[t]; if (!g.nome.trim()) return;
    grupoOp({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo: t, nome: g.nome, emoji: g.emoji, limite: g.limite || null }) }, `grupo "${g.nome}" criado.`);
    setNovoGrupo((n) => ({ ...n, [t]: { nome: "", emoji: "", limite: "" } }));
  };
  const editarGrupo = (g: GrupoVM, patch: Partial<{ nome: string; emoji: string; limite: string }>) =>
    grupoOp({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: g.id, nome: patch.nome ?? g.nome, emoji: patch.emoji ?? g.emoji, limite: patch.limite ?? (g.limite_max ?? "") }) }, "grupo atualizado.");
  const excluirGrupo = (g: GrupoVM) => { if (confirm(`Excluir o grupo "${g.nome}"? As atribuições dele são removidas.`)) grupoOp({ method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: g.id }) }, "grupo excluído."); };

  // ---- atribuição ----
  const origAtrib = useMemo(() => {
    const o = {} as Record<Tipo, Record<string, string>>;
    for (const t of TIPOS) { o[t] = {}; for (const a of dados[t].atrib) o[t][a.familia] = String(a.grupo_id); }
    return o;
  }, [dados]);
  const dirtyAtrib = (t: Tipo) => JSON.stringify(atrib[t]) !== JSON.stringify(origAtrib[t]);
  async function salvarAtrib(t: Tipo) {
    const deltas: { familia: string; grupoId: number | null }[] = [];
    const fams = new Set([...Object.keys(atrib[t]), ...Object.keys(origAtrib[t])]);
    for (const f of fams) { const cur = atrib[t][f] ?? ""; if (cur !== (origAtrib[t][f] ?? "")) deltas.push({ familia: f, grupoId: cur ? Number(cur) : null }); }
    if (!deltas.length) return;
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/participacao/membros", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo: t, atribuicoes: deltas }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha");
      setStatus({ kind: "ok", msg: `${deltas.length} atribuição(ões) salvas.` }); router.refresh();
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }

  // ---- situação (agrupada) ----
  const situacao = (t: Tipo) => {
    const d = dados[t];
    const respByChave = new Map<string, RespVM>();
    for (const r of d.respostas) respByChave.set(chaveNome(r.familia), r);
    const porGrupo = new Map<number, AtribVM[]>();
    for (const a of d.atrib) { const arr = porGrupo.get(a.grupo_id) ?? []; arr.push(a); porGrupo.set(a.grupo_id, arr); }
    const chavesAtrib = new Set(d.atrib.map((a) => chaveNome(a.familia)));
    const grupos = d.grupos.map((g) => {
      const membros = (porGrupo.get(g.id) ?? []).map((a) => {
        const r = respByChave.get(chaveNome(a.familia));
        return { familia: a.familia, resposta: r?.resposta ?? null, userId: r?.user_id ?? null };
      }).sort((a, b) => (b.resposta === "can" ? 1 : 0) - (a.resposta === "can" ? 1 : 0));
      return { ...g, membros, confirmados: membros.filter((m) => m.resposta === "can").length };
    });
    const semGrupo = d.respostas.filter((r) => r.resposta === "can" && !chavesAtrib.has(chaveNome(r.familia)));
    const cant = d.respostas.filter((r) => r.resposta === "cant" && !chavesAtrib.has(chaveNome(r.familia)));
    return { grupos, semGrupo, cant };
  };

  const card = { border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 16 } as const;
  const input = { background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "6px 9px", fontSize: 12.5, outline: "none" } as const;
  const label = { color: C.mute, fontSize: 11, textTransform: "uppercase" as const, letterSpacing: 1, marginBottom: 3, display: "block" };
  const btn = (color: string = C.verde) => ({ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" } as const);
  const sec = { color: C.mute, fontSize: 11, textTransform: "uppercase" as const, letterSpacing: 1.5, margin: "14px 0 7px", borderTop: `1px solid ${C.borderSoft}`, paddingTop: 10 } as const;

  const statusIcon = (r: "can" | "cant" | null) => (r === "can" ? "✅" : r === "cant" ? "❌" : "⬜");

  return (
    <div style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}
        a.navlink2:hover{color:${C.verde}}`}</style>

      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
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
            {canEdit && <button onClick={salvarConfig} disabled={status.kind === "saving"} style={{ ...btn(C.amarelo), padding: "8px 15px", fontSize: 13 }}>{status.kind === "saving" ? "Salvando…" : "Salvar config"}</button>}
          </div>
        </div>
        <p style={{ color: C.mute, fontSize: 12.5, margin: "4px 0 18px" }}>
          Defina <b style={{ color: C.verde }}>grupos</b> (com emoji do servidor + limite), <b style={{ color: C.verde }}>atribua</b> os jogadores, e dispare. A mensagem do bot mostra cada grupo e atualiza a cada <b style={{ color: C.verde }}>Can</b>/<b style={{ color: C.vermelho }}>Cant</b>. Nome clicável abre o perfil no Discord.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(540px, 1fr))", gap: 16 }}>
          {TIPOS.map((t) => {
            const c = cfg[t];
            const s = situacao(t);
            const grupos = dados[t].grupos;
            const ng = novoGrupo[t];
            const playersFiltrados = playersAtivos.filter((p) => !filtro || chaveNome(p).includes(chaveNome(filtro)));
            return (
              <div key={t} style={card}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 16, fontWeight: 700, color: C.verde, letterSpacing: 1 }}>{rotuloTipo(t).toUpperCase()}</span>
                  {canEdit && <button onClick={() => disparar(t)} disabled={disparando !== null} style={{ ...btn(C.verde), fontWeight: 700 }}>{disparando === t ? "Postando…" : "📣 Disparar"}</button>}
                </div>

                {/* CONFIG */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div><label style={label}>Canal (ID)</label><input value={c.channelId} readOnly={ro} onChange={(e) => setField(t, "channelId", e.target.value.replace(/[^0-9]/g, ""))} placeholder="ID do canal" style={{ ...input, width: "100%" }} /></div>
                  <div><label style={label}>Cargo a mencionar</label><input value={c.pingRoleId} readOnly={ro} onChange={(e) => setField(t, "pingRoleId", e.target.value.replace(/[^0-9]/g, ""))} placeholder="opcional" style={{ ...input, width: "100%" }} /></div>
                </div>
                <div style={{ marginTop: 8 }}><label style={label}>Título</label><input value={c.titulo} readOnly={ro} onChange={(e) => setField(t, "titulo", e.target.value)} style={{ ...input, width: "100%" }} /></div>
                <div style={{ marginTop: 8 }}><label style={label}>Mensagem</label><textarea value={c.mensagem} readOnly={ro} onChange={(e) => setField(t, "mensagem", e.target.value)} rows={2} style={{ ...input, width: "100%", resize: "vertical" }} /></div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.texto, fontSize: 12.5 }}>
                    <input type="checkbox" checked={c.agenda.ativo} disabled={ro} onChange={(e) => setAgenda(t, { ativo: e.target.checked })} style={{ accentColor: C.verde }} /> Agendar
                  </label>
                  <select value={String(Number(c.agenda.hora.split(":")[0])).padStart(2, "0")} disabled={ro} onChange={(e) => setAgenda(t, { hora: `${e.target.value}:00` })} style={{ ...input }}>
                    {Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")).map((h) => <option key={h} value={h}>{h}:00</option>)}
                  </select>
                  {DIAS.map((nome, i) => {
                    const on = c.agenda.dias.includes(i);
                    return <button key={i} onClick={() => !ro && toggleDia(t, i)} disabled={ro} style={{ ...btn(on ? C.verde : C.mute), background: on ? C.verdeTint : "transparent", padding: "3px 7px" }}>{nome}</button>;
                  })}
                </div>

                {/* GRUPOS */}
                {canEdit && (
                  <>
                    <div style={sec}>Grupos</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {grupos.map((g) => (
                        <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <EmojiPicker emojis={emojis} value={g.emoji} onPick={(v) => editarGrupo(g, { emoji: v })} />
                          <input defaultValue={g.nome} onBlur={(e) => e.target.value.trim() && e.target.value !== g.nome && editarGrupo(g, { nome: e.target.value })} style={{ ...input, flex: 1 }} />
                          <input defaultValue={g.limite_max ?? ""} placeholder="limite" onBlur={(e) => String(e.target.value) !== String(g.limite_max ?? "") && editarGrupo(g, { limite: e.target.value })} style={{ ...input, width: 66 }} />
                          <button onClick={() => excluirGrupo(g)} title="excluir" style={{ ...btn(C.vermelho), padding: "5px 8px" }}>✕</button>
                        </div>
                      ))}
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <EmojiPicker emojis={emojis} value={ng.emoji} onPick={(v) => setNovoGrupo((n) => ({ ...n, [t]: { ...n[t], emoji: v } }))} />
                        <input value={ng.nome} onChange={(e) => setNovoGrupo((n) => ({ ...n, [t]: { ...n[t], nome: e.target.value } }))} onKeyDown={(e) => e.key === "Enter" && criarGrupo(t)} placeholder="novo grupo (ex: PT1)" style={{ ...input, flex: 1 }} />
                        <input value={ng.limite} onChange={(e) => setNovoGrupo((n) => ({ ...n, [t]: { ...n[t], limite: e.target.value.replace(/[^0-9]/g, "") } }))} placeholder="limite" style={{ ...input, width: 66 }} />
                        <button onClick={() => criarGrupo(t)} disabled={!ng.nome.trim()} style={{ ...btn(C.verde), fontWeight: 700 }}>+ add</button>
                      </div>
                    </div>

                    {/* ATRIBUIÇÃO */}
                    {grupos.length > 0 && (
                      <>
                        <div style={{ ...sec, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span>Atribuir jogadores</span>
                          <span style={{ display: "flex", gap: 8, alignItems: "center", textTransform: "none", letterSpacing: 0 }}>
                            <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="filtrar…" style={{ ...input, width: 110, padding: "3px 8px" }} />
                            {dirtyAtrib(t) && <button onClick={() => salvarAtrib(t)} style={{ ...btn(C.amarelo), fontWeight: 700 }}>Salvar atribuições</button>}
                          </span>
                        </div>
                        <div style={{ maxHeight: 220, overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 10px", paddingRight: 4 }}>
                          {playersFiltrados.map((p) => (
                            <div key={p} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                              <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p}</span>
                              <select value={atrib[t][p] ?? ""} onChange={(e) => setAtrib((prev) => ({ ...prev, [t]: { ...prev[t], [p]: e.target.value } }))} style={{ ...input, padding: "3px 6px", maxWidth: 130 }}>
                                <option value="">—</option>
                                {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
                              </select>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* SITUAÇÃO — grupos em boxes; Cant separado em lista simples */}
                <div style={sec}>Situação {dados[t].post ? <span style={{ color: C.verde, textTransform: "none", letterSpacing: 0 }}>● ao vivo</span> : <span style={{ color: C.mute, textTransform: "none", letterSpacing: 0 }}>(sem rodada — dispare ou /participacao-{t})</span>}</div>

                {s.grupos.length === 0 && s.semGrupo.length === 0 && s.cant.length === 0 ? (
                  <span style={{ color: C.borderSoft, fontSize: 12 }}>—</span>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 8 }}>
                      {s.grupos.map((g) => (
                        <div key={g.id} style={{ border: `1px solid ${C.border2}`, borderRadius: 10, background: C.surfaceSolid, padding: "8px 10px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, paddingBottom: 5, borderBottom: `1px solid ${C.borderSoft}` }}>
                            <GEmoji emoji={g.emoji} emojis={emojis} size={16} /><b style={{ color: C.verde, fontSize: 13, flex: 1 }}>{g.nome}</b>
                            <span style={{ color: g.limite_max != null && g.confirmados >= g.limite_max ? C.amarelo : C.mute, fontSize: 12, fontWeight: 700 }}>{g.confirmados}{g.limite_max != null ? `/${g.limite_max}` : ""}</span>
                          </div>
                          {g.membros.length === 0 ? <span style={{ color: C.borderSoft, fontSize: 12 }}>ninguém atribuído</span> : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              {g.membros.map((m, i) => (
                                <span key={i} style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 5 }}>
                                  <span>{statusIcon(m.resposta)}</span><NomePerfil nome={m.familia} userId={m.userId} bold={m.resposta === "can"} />
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {s.semGrupo.length > 0 && (
                      <div style={{ marginTop: 8, border: `1px solid ${C.amarelo}`, borderRadius: 10, background: C.inputBg, padding: "7px 11px", fontSize: 12.5 }}>
                        <b style={{ color: C.amarelo }}>🆕 Sem grupo ({s.semGrupo.length})</b> <span style={{ color: C.mute }}>— confirmaram mas não têm grupo</span>
                        <div style={{ marginTop: 3 }}>{s.semGrupo.map((r, i) => <span key={r.user_id}><NomePerfil nome={r.familia || "?"} userId={r.user_id} bold />{i < s.semGrupo.length - 1 ? ", " : ""}</span>)}</div>
                      </div>
                    )}

                    {s.cant.length > 0 && (
                      <div style={{ marginTop: 10, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 8 }}>
                        <div style={{ color: C.vermelho, fontSize: 12, fontWeight: 700, marginBottom: 3 }}>❌ Não vão ({s.cant.length})</div>
                        <div style={{ fontSize: 12.5, color: C.mute }}>{s.cant.map((r, i) => <span key={r.user_id}><NomePerfil nome={r.familia || "?"} userId={r.user_id} />{i < s.cant.length - 1 ? ", " : ""}</span>)}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// picker de emoji do servidor: botão mostra o emoji atual; abre grid buscável + campo p/ unicode
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
