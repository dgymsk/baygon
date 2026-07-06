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
type Aba = "disparo" | "pts" | "templates" | "atribuicao" | "buzinador";

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
  cfgInit, pts, membros, templates, situacao, playersAtivos, emojis, roles, imagens, canEdit,
}: {
  cfgInit: ParticipacaoConfig; pts: PtVM[]; membros: MembroVM[]; templates: TemplateVM[]; situacao: Record<Tipo, SituacaoVM>;
  playersAtivos: string[]; emojis: EmojiGuild[]; roles: { id: string; name: string }[]; imagens: { url: string; nome: string }[]; canEdit: boolean;
}) {
  const router = useRouter();
  const ro = !canEdit;
  const [aba, setAba] = useState<Aba>("disparo");
  const [cfg, setCfg] = useState<ParticipacaoConfig>(cfgInit);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [disparando, setDisparando] = useState(false);
  const [disparoSel, setDisparoSel] = useState<Record<Tipo, string>>({ nodewar: "", siege: "" });
  const [novoPt, setNovoPt] = useState({ nome: "", emoji: "", cor: "" });
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

  // Buzinador (disparo de DM em massa)
  const [buz, setBuz] = useState<{ mensagem: string; imagem: string; tipo: "role" | "todos" | "lista"; roleId: string; userIds: string; canal: string; opcoes: { label: string; estilo: number; emoji: string }[]; textoLivre: boolean }>({ mensagem: "", imagem: "", tipo: "role", roleId: "", userIds: "", canal: "", opcoes: [], textoLivre: false });
  const [buzProg, setBuzProg] = useState<{ ativo: boolean; total: number; enviados: number; falhas: number; pendentes: number; concluido: boolean; reportOk?: boolean; naoEncontrados?: string[]; casados?: { de: string; para: string }[]; erro?: string } | null>(null);
  const setBuzF = <K extends keyof typeof buz>(k: K, v: (typeof buz)[K]) => setBuz((b) => ({ ...b, [k]: v }));
  const addOpcao = () => setBuz((b) => (b.opcoes.length >= 25 ? b : { ...b, opcoes: [...b.opcoes, { label: "", estilo: 2, emoji: "" }] }));
  const setOpcao = (i: number, patch: Partial<{ label: string; estilo: number; emoji: string }>) => setBuz((b) => ({ ...b, opcoes: b.opcoes.map((o, j) => (j === i ? { ...o, ...patch } : o)) }));
  const rmOpcao = (i: number) => setBuz((b) => ({ ...b, opcoes: b.opcoes.filter((_, j) => j !== i) }));

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
  async function enviarImagem(t: Tipo, file: File) {
    setStatus({ kind: "saving" });
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/participacao/imagem", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha no upload");
      setField(t, "imagem", d.url); // seleciona a nova
      setStatus({ kind: "ok", msg: "imagem enviada — salve a config" });
      router.refresh(); // recarrega a lista
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }
  const colarImagem = (t: Tipo, e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (file) { e.preventDefault(); enviarImagem(t, file); }
  };

  // ---- Buzinador ----
  async function buzinar() {
    if (!canEdit || (buzProg?.ativo)) return;
    if (!buz.mensagem.trim()) { setStatus({ kind: "err", msg: "escreva a mensagem" }); return; }
    if (!buz.canal.trim()) { setStatus({ kind: "err", msg: "informe o canal do relatório" }); return; }
    if (buz.tipo === "role" && !buz.roleId.trim()) { setStatus({ kind: "err", msg: "informe o cargo" }); return; }
    if (buz.tipo === "lista" && !buz.userIds.trim()) { setStatus({ kind: "err", msg: "cole os IDs na lista" }); return; }
    const alvo = buz.tipo === "role" ? "todos do cargo" : buz.tipo === "todos" ? "TODOS os membros do servidor" : "a lista informada";
    if (!confirm(`Buzinar ${alvo}? Cada um recebe uma DM privada do bot.`)) return;
    setBuzProg({ ativo: true, total: 0, enviados: 0, falhas: 0, pendentes: 0, concluido: false });
    try {
      const res = await fetch("/api/buzinador/criar", jsonInit("POST", {
        mensagem: buz.mensagem, imagemUrl: buz.imagem || undefined, canalReportId: buz.canal,
        audiencia: { tipo: buz.tipo, roleId: buz.roleId, userIds: buz.userIds },
        opcoes: buz.opcoes.filter((o) => o.label.trim()).map((o) => ({ label: o.label, estilo: o.estilo, emoji: o.emoji || undefined })),
        textoLivre: buz.textoLivre,
      }));
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setBuzProg({ ativo: false, total: 0, enviados: 0, falhas: 0, pendentes: 0, concluido: false, erro: d.error || "falha ao criar" }); return; }
      const { envioId, total, naoEncontrados, casados } = d as { envioId: number; total: number; naoEncontrados?: string[]; casados?: { de: string; para: string }[] };
      setBuzProg({ ativo: true, total, enviados: 0, falhas: 0, pendentes: total, concluido: false, naoEncontrados, casados });
      for (let i = 0; i < 1000; i++) {
        const pr = await fetch("/api/buzinador/processar", jsonInit("POST", { envioId }));
        const p = await pr.json().catch(() => ({}));
        if (!pr.ok) { setBuzProg((b) => ({ ...(b ?? { total, enviados: 0, falhas: 0, pendentes: total, concluido: false }), ativo: false, erro: p.error || "falha no lote" })); return; }
        setBuzProg({ ativo: !p.concluido, total: p.total, enviados: p.enviados, falhas: p.falhas, pendentes: p.pendentes, concluido: p.concluido, reportOk: p.reportOk, naoEncontrados, casados });
        if (p.concluido) break;
      }
      setStatus({ kind: "ok", msg: "buzinada concluída" });
    } catch (e) {
      setBuzProg((b) => ({ ...(b ?? { total: 0, enviados: 0, falhas: 0, pendentes: 0, concluido: false }), ativo: false, erro: (e as Error).message }));
    }
  }

  // ---- PTs ----
  const criarPt = () => { if (!novoPt.nome.trim()) return; api("/api/participacao/pts", jsonInit("POST", novoPt), `PT "${novoPt.nome}" criado.`); setNovoPt({ nome: "", emoji: "", cor: "" }); };
  const editarPt = (p: PtVM, patch: Partial<{ nome: string; emoji: string; cor: string }>) => api("/api/participacao/pts", jsonInit("PATCH", { id: p.id, nome: patch.nome ?? p.nome, emoji: patch.emoji ?? p.emoji, cor: patch.cor ?? p.cor }), "PT atualizado.");
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
            <Link className="navlink" href="/discord">Discord</Link>
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
          {abaBtn("buzinador", "📢 Buzinador")}
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
                <div style={{ marginTop: 8 }} onPaste={(e) => canEdit && colarImagem(t, e)}>
                  <label style={label}>Imagem no final (opcional)</label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <select value={c.imagem} disabled={ro} onChange={(e) => setField(t, "imagem", e.target.value)} style={{ ...input, flex: 1 }}>
                      <option value="">— sem imagem —</option>
                      {imagens.map((img) => <option key={img.url} value={img.url}>{img.nome}</option>)}
                      {c.imagem && !imagens.some((i) => i.url === c.imagem) && <option value={c.imagem}>(atual)</option>}
                    </select>
                    {canEdit && <label style={{ ...btn(C.verde), cursor: "pointer" }}>📎 Enviar<input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) enviarImagem(t, f); e.currentTarget.value = ""; }} /></label>}
                    {c.imagem && <img src={c.imagem} alt="" style={{ height: 34, borderRadius: 6, border: `1px solid ${C.border2}` }} />}
                  </div>
                  {canEdit && <div style={{ color: C.borderSoft, fontSize: 11, marginTop: 3 }}>Escolha uma enviada, ou clique aqui e cole (Ctrl+V) / use 📎 Enviar. Depois salve a config.</div>}
                </div>
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
                          <div key={g.id} style={{ border: `1px solid ${C.border2}`, borderLeft: `3px solid ${g.cor || C.border2}`, borderRadius: 10, background: C.surfaceSolid, padding: "8px 10px" }}>
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
            <div style={{ color: C.mute, fontSize: 12.5, marginBottom: 12 }}>Catálogo de PTs (nome + emoji + <b style={{ color: C.verde }}>cor do card</b>). A cor é a barra do card no embed; sem cor, usa uma paleta automática. Depois use nos <b style={{ color: C.verde }}>templates</b> e na <b style={{ color: C.verde }}>atribuição</b>.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {pts.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <EmojiPicker emojis={emojis} value={p.emoji} onPick={(v) => canEdit && editarPt(p, { emoji: v })} />
                  <input type="color" value={p.cor || "#5865f2"} disabled={ro} onChange={(e) => canEdit && editarPt(p, { cor: e.target.value })} title={p.cor ? `cor ${p.cor}` : "cor automática (clique p/ definir)"} style={{ width: 34, height: 30, padding: 0, border: `1px solid ${C.border2}`, borderRadius: 6, background: C.inputBg, cursor: ro ? "default" : "pointer", opacity: p.cor ? 1 : 0.45 }} />
                  {canEdit && p.cor && <button onClick={() => editarPt(p, { cor: "" })} title="voltar p/ cor automática" style={{ ...btn(C.mute), padding: "4px 7px", fontSize: 10.5 }}>auto</button>}
                  <input defaultValue={p.nome} readOnly={ro} onBlur={(e) => canEdit && e.target.value.trim() && e.target.value !== p.nome && editarPt(p, { nome: e.target.value })} style={{ ...input, flex: 1 }} />
                  {canEdit && <button onClick={() => excluirPt(p)} title="excluir" style={{ ...btn(C.vermelho), padding: "5px 9px" }}>✕</button>}
                </div>
              ))}
              {pts.length === 0 && <span style={{ color: C.borderSoft, fontSize: 12.5 }}>nenhum PT ainda.</span>}
              {canEdit && (
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4, paddingTop: 8, borderTop: `1px solid ${C.borderSoft}` }}>
                  <EmojiPicker emojis={emojis} value={novoPt.emoji} onPick={(v) => setNovoPt((n) => ({ ...n, emoji: v }))} />
                  <input type="color" value={novoPt.cor || "#5865f2"} onChange={(e) => setNovoPt((n) => ({ ...n, cor: e.target.value }))} title="cor do card (opcional)" style={{ width: 34, height: 30, padding: 0, border: `1px solid ${C.border2}`, borderRadius: 6, background: C.inputBg, cursor: "pointer", opacity: novoPt.cor ? 1 : 0.45 }} />
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

        {/* ===================== BUZINADOR ===================== */}
        {aba === "buzinador" && (
          <div style={{ ...card, maxWidth: 720 }}>
            <div style={{ color: C.mute, fontSize: 12.5, marginBottom: 12 }}>
              Envia uma <b style={{ color: C.verde }}>DM privada</b> pra cada jogador da audiência e registra quem recebeu / quem falhou (DM fechada) num relatório postado no canal escolhido. Sem botões — só entrega.
            </div>

            <label style={label}>Mensagem</label>
            <textarea value={buz.mensagem} readOnly={ro} onChange={(e) => setBuzF("mensagem", e.target.value)} rows={4} placeholder="Texto que cada um vai receber na DM…" style={{ ...input, width: "100%", resize: "vertical" }} />

            <div style={{ marginTop: 10 }}>
              <label style={label}>Imagem (opcional)</label>
              <select value={buz.imagem} disabled={ro} onChange={(e) => setBuzF("imagem", e.target.value)} style={{ ...input, width: "100%" }}>
                <option value="">— sem imagem —</option>
                {imagens.map((img) => <option key={img.url} value={img.url}>{img.nome}</option>)}
                {buz.imagem && !imagens.some((i) => i.url === buz.imagem) && <option value={buz.imagem}>(atual)</option>}
              </select>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={label}>Audiência</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {([["role", "Por cargo"], ["todos", "Todos os membros"], ["lista", "Lista de IDs"]] as const).map(([v, txt]) => (
                  <button key={v} onClick={() => !ro && setBuzF("tipo", v)} disabled={ro} style={{ ...btn(buz.tipo === v ? C.verde : C.mute), background: buz.tipo === v ? C.verdeTint : "transparent" }}>{txt}</button>
                ))}
              </div>
              {buz.tipo === "role" && (
                <select value={buz.roleId} disabled={ro} onChange={(e) => setBuzF("roleId", e.target.value)} style={{ ...input, width: "100%", marginTop: 8 }}>
                  <option value="">{roles.length ? "— escolha o cargo —" : "— nenhum cargo carregado (bot/guild?) —"}</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              )}
              {buz.tipo === "lista" && <textarea value={buz.userIds} readOnly={ro} onChange={(e) => setBuzF("userIds", e.target.value)} rows={3} placeholder="Cole IDs ou menções separados por espaço, vírgula ou linha" style={{ ...input, width: "100%", marginTop: 8, resize: "vertical" }} />}
              {buz.tipo === "todos" && <div style={{ color: C.amarelo, fontSize: 11.5, marginTop: 6 }}>⚠ Envia pra TODOS os membros (menos bots). Requer o &quot;Server Members Intent&quot; ativo no bot.</div>}
              {buz.tipo === "role" && <div style={{ color: C.borderSoft, fontSize: 11, marginTop: 4 }}>Requer o &quot;Server Members Intent&quot; ativo no bot (Developer Portal → Bot).</div>}
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={label}>Canal do relatório (ID)</label>
              <input value={buz.canal} readOnly={ro} onChange={(e) => setBuzF("canal", e.target.value.replace(/[^0-9]/g, ""))} placeholder="onde o bot posta quem recebeu / falhou" style={{ ...input, width: "100%" }} />
            </div>

            {canEdit && (
              <div style={{ marginTop: 12 }}>
                <label style={label}>Botões / votação (opcional)</label>
                <div style={{ color: C.borderSoft, fontSize: 11, marginBottom: 6 }}>Cada botão grava a escolha de quem clica (voto único, trocável); o relatório mostra os votos. A cor é o estilo do Discord. Até 25 botões.</div>
                {buz.opcoes.map((o, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <EmojiPicker emojis={emojis} value={o.emoji} onPick={(v) => setOpcao(i, { emoji: v })} />
                    <input value={o.label} onChange={(e) => setOpcao(i, { label: e.target.value })} maxLength={80} placeholder={`botão ${i + 1} (ex: Confirmo)`} style={{ ...input, flex: 1 }} />
                    <select value={o.estilo} onChange={(e) => setOpcao(i, { estilo: Number(e.target.value) })} style={{ ...input, width: 120 }}>
                      <option value={1}>🔵 Azul</option>
                      <option value={3}>🟢 Verde</option>
                      <option value={4}>🔴 Vermelho</option>
                      <option value={2}>⚪ Cinza</option>
                    </select>
                    <button onClick={() => rmOpcao(i)} title="remover" style={{ ...btn(C.vermelho), padding: "5px 9px" }}>✕</button>
                  </div>
                ))}
                {buz.opcoes.length < 25 && <button onClick={addOpcao} style={{ ...btn(C.verde), fontSize: 12 }}>+ adicionar botão</button>}
                <label style={{ display: "flex", alignItems: "center", gap: 7, color: C.texto, fontSize: 12.5, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.borderSoft}` }}>
                  <input type="checkbox" checked={buz.textoLivre} onChange={(e) => setBuzF("textoLivre", e.target.checked)} style={{ accentColor: C.verde }} />
                  <span>Permitir <b style={{ color: C.verde }}>resposta escrita</b> (botão “✍ Responder” → texto livre; cada resposta vai pro canal de log com um código)</span>
                </label>
              </div>
            )}

            {canEdit && (
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={buzinar} disabled={!!buzProg?.ativo} style={{ ...btn(C.verde), fontWeight: 700, fontSize: 13, padding: "7px 16px" }}>{buzProg?.ativo ? "Buzinando…" : "📢 Buzinar"}</button>
                {buzProg?.ativo && <span style={{ color: C.mute, fontSize: 12 }}>{buzProg.enviados + buzProg.falhas}/{buzProg.total} processados</span>}
              </div>
            )}

            {buzProg && (
              <div style={{ marginTop: 14, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 12 }}>
                {buzProg.erro ? (
                  <div style={{ color: C.vermelho, fontSize: 12.5 }}>⚠ {buzProg.erro}</div>
                ) : (
                  <>
                    <div style={{ height: 8, borderRadius: 999, background: C.inputBg, overflow: "hidden", border: `1px solid ${C.border2}` }}>
                      <div style={{ height: "100%", width: `${buzProg.total ? Math.round(((buzProg.enviados + buzProg.falhas) / buzProg.total) * 100) : 0}%`, background: C.verde, transition: "width .3s" }} />
                    </div>
                    <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12.5, flexWrap: "wrap" }}>
                      <span style={{ color: C.verde }}>✅ {buzProg.enviados} receberam</span>
                      <span style={{ color: C.vermelho }}>❌ {buzProg.falhas} falharam</span>
                      <span style={{ color: C.mute }}>⏳ {buzProg.pendentes} restantes · {buzProg.total} total</span>
                    </div>
                    {buzProg.concluido && (
                      <div style={{ color: C.amarelo, fontSize: 12.5, marginTop: 8 }}>
                        🏁 Concluído. {buzProg.reportOk === false ? "⚠ Não consegui postar o relatório no canal (confira permissão/ID)." : "Relatório postado no canal."}
                      </div>
                    )}
                    {buzProg.casados && buzProg.casados.length > 0 && (
                      <div style={{ color: C.mute, fontSize: 12, marginTop: 8 }}>≈ {buzProg.casados.length} casado(s) por similaridade: {buzProg.casados.map((x) => `${x.de}→${x.para}`).join(", ")}</div>
                    )}
                    {buzProg.naoEncontrados && buzProg.naoEncontrados.length > 0 && (
                      <div style={{ color: C.amarelo, fontSize: 12, marginTop: 8 }}>⚠ {buzProg.naoEncontrados.length} nome(s) não encontrado(s) no servidor (ignorados): {buzProg.naoEncontrados.join(", ")}</div>
                    )}
                  </>
                )}
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
