"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { chaveNome } from "@/lib/nomes";
import type { Preset, MembroInt } from "@/lib/intencaoPreset";
import type { Pt } from "@/lib/participacaoPt";
import type { PostIntencao } from "@/lib/intencao";

/**
 * Config do bot de INTENÇÃO: quais PTs viram botão (o preset) e a "PT de casa" de cada jogador,
 * que aqui pode ser MAIS DE UMA. O catálogo de PTs em si continua sendo criado/editado na tela
 * /participacao — aqui só se escolhe quais entram e em que ordem.
 */
type Props = { presets: Preset[]; pts: Pt[]; membros: MembroInt[]; nomes: string[]; ativos: PostIntencao[]; canEdit: boolean };
const TIPOS = ["nodewar", "siege"] as const;

export default function IntencaoBoard({ presets, pts, membros, nomes, ativos, canEdit }: Props) {
  const router = useRouter();
  const [tipo, setTipo] = useState<string>("nodewar");
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [busca, setBusca] = useState("");

  const ptById = useMemo(() => new Map(pts.map((p) => [p.id, p])), [pts]);
  const preset = useMemo(() => presets.find((p) => p.tipo === tipo) ?? null, [presets, tipo]);
  const selecionadas = useMemo(() => (preset?.pts ?? []).map((v) => v.pt_id), [preset]);
  const membrosTipo = useMemo(() => membros.filter((m) => m.tipo === tipo), [membros, tipo]);
  const ptsPorChave = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const x of membrosTipo) { const a = m.get(x.chave) ?? []; a.push(x.pt_id); m.set(x.chave, a); }
    return m;
  }, [membrosTipo]);
  const ativo = ativos.find((a) => a.tipo === tipo) ?? null;

  async function api(body: Record<string, unknown>, okMsg?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/intencao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((d as { error?: string }).error ?? `erro ${res.status}`);
      if (okMsg) setMsg({ k: "ok", t: okMsg });
      router.refresh();
      return d;
    } catch (e) { setMsg({ k: "err", t: (e as Error).message }); return null; }
    finally { setBusy(false); }
  }

  const togglePt = (ptId: number) => {
    if (!canEdit || !preset) return;
    const novo = selecionadas.includes(ptId) ? selecionadas.filter((x) => x !== ptId) : [...selecionadas, ptId];
    api({ acao: "atualizar", id: preset.id, nome: preset.nome, tipo: preset.tipo, pts: novo });
  };
  const moverPt = (ptId: number, dir: -1 | 1) => {
    if (!canEdit || !preset) return;
    const i = selecionadas.indexOf(ptId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= selecionadas.length) return;
    const novo = [...selecionadas];
    [novo[i], novo[j]] = [novo[j], novo[i]];
    api({ acao: "atualizar", id: preset.id, nome: preset.nome, tipo: preset.tipo, pts: novo });
  };
  const toggleMembro = (familia: string, ptId: number) => {
    if (!canEdit) return;
    const tem = (ptsPorChave.get(chaveNome(familia)) ?? []).includes(ptId);
    api({ acao: tem ? "membro-del" : "membro-add", tipo, familia, ptId });
  };

  const card = { border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 16, marginBottom: 14 } as const;
  const chip = (on: boolean) => ({ cursor: canEdit ? "pointer" : "default", borderRadius: 999, border: `1px solid ${on ? C.verde : C.border2}`, background: on ? C.verdeTint : C.inputBg, color: on ? C.verde : C.mute, padding: "4px 11px", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit" } as const);
  const filtrados = nomes.filter((n) => !busca || n.toLowerCase().includes(busca.toLowerCase())).slice(0, 120);

  return (
    <div style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>

      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 26, letterSpacing: 1, margin: 0, color: C.amarelo }}>
            BAYGON <span style={{ color: C.mute, fontSize: 14, letterSpacing: 2 }}>· INTENÇÃO</span>
          </h1>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            {msg && <span style={{ color: msg.k === "ok" ? C.verde : C.vermelho, fontSize: 13 }}>{msg.k === "ok" ? "✓" : "⚠"} {msg.t}</span>}
            <Link className="navlink" href="/escalacao">Escalação →</Link>
            <Link className="navlink" href="/participacao">Participação (bot antigo)</Link>
            <Link className="navlink" href="/painel">← Painel</Link>
          </div>
        </div>

        <p style={{ color: C.mute, fontSize: 12.5, margin: "0 0 14px" }}>
          O jogador marca <b style={{ color: C.verde }}>em quais PTs pretende jogar</b> clicando nos ícones — pode marcar
          várias, e <b>não há limite de vaga</b>. Quem decide a escalação é você, em <Link href="/escalacao" style={{ color: C.verde }}>Escalação</Link>.
          As PTs em si são criadas em <Link href="/participacao" style={{ color: C.verde }}>Participação</Link>; aqui você escolhe quais viram botão.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {TIPOS.map((t) => (
            <button key={t} onClick={() => setTipo(t)} style={{ ...chip(tipo === t), cursor: "pointer", textTransform: "capitalize" }}>{t}</button>
          ))}
        </div>

        {!preset ? (
          <div style={card}>
            <div style={{ color: C.amarelo, fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Nenhum preset de {tipo}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome do preset (ex.: NODEWAR)" disabled={!canEdit}
                style={{ background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "8px 11px", fontSize: 13.5, outline: "none", minWidth: 240 }} />
              <button disabled={!canEdit || busy || !novoNome.trim()} onClick={() => api({ acao: "criar", nome: novoNome, tipo, pts: [] }, "preset criado")}
                style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: C.verde, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Criar</button>
            </div>
          </div>
        ) : (
          <>
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                <span style={{ color: C.verde, fontWeight: 700, fontSize: 14 }}>Preset <b style={{ color: C.amarelo }}>{preset.nome}</b> — {selecionadas.length} PT(s) viram botão</span>
                {canEdit && (
                  <button disabled={busy || !selecionadas.length} onClick={() => api({ acao: "postar", id: preset.id }, "chamada postada no Discord")}
                    style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.verdeTint, color: C.verde, padding: "7px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    📢 Postar chamada
                  </button>
                )}
              </div>
              {ativo && (
                <div style={{ color: C.mute, fontSize: 12, marginBottom: 10 }}>
                  Rodada ativa de {ativo.criado.slice(0, 16).replace("T", " ")}
                  {ativo.evento_uuid && <> · <Link href={`/escalacao?ev=${ativo.evento_uuid}`} style={{ color: C.verde }}>abrir escalação</Link></>}
                  {ativo.evento_status && ativo.evento_status !== "aberto" && <span style={{ color: C.amarelo }}> · 🔒 {ativo.evento_status}</span>}
                </div>
              )}
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {pts.map((p) => {
                  const on = selecionadas.includes(p.id);
                  return (
                    <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <button onClick={() => togglePt(p.id)} disabled={!canEdit} style={chip(on)} title={on ? "tirar do preset" : "pôr no preset"}>
                        {p.emoji ? <EmojiPt raw={p.emoji} /> : null} {p.nome}
                      </button>
                      {on && canEdit && (
                        <>
                          <button onClick={() => moverPt(p.id, -1)} title="mover p/ esquerda" style={mini}>◀</button>
                          <button onClick={() => moverPt(p.id, 1)} title="mover p/ direita" style={mini}>▶</button>
                        </>
                      )}
                    </span>
                  );
                })}
                {!pts.length && <span style={{ color: C.mute, fontSize: 12.5 }}>Nenhuma PT no catálogo — crie em /participacao.</span>}
              </div>
              {!!selecionadas.length && (
                <div style={{ color: C.borderSoft, fontSize: 11.5, marginTop: 9 }}>
                  Ordem dos botões: {selecionadas.map((id) => ptById.get(id)?.nome ?? id).join(" → ")}
                </div>
              )}
            </div>

            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
                <span style={{ color: C.verde, fontWeight: 700, fontSize: 14 }}>PT de casa <span style={{ color: C.mute, fontWeight: 400, fontSize: 12 }}>(pode marcar várias por pessoa)</span></span>
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="filtrar jogador…"
                  style={{ background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "6px 10px", fontSize: 12.5, outline: "none", minWidth: 180 }} />
              </div>
              <div style={{ color: C.mute, fontSize: 11.5, marginBottom: 10 }}>
                Só serve pra saber quem ainda <b>não respondeu</b> (vira a lista ⬜ na mensagem). Não limita nem obriga nada.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "6px 14px" }}>
                {filtrados.map((n) => {
                  const meus = ptsPorChave.get(chaveNome(n)) ?? [];
                  return (
                    <div key={n} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, flexWrap: "wrap" }}>
                      <span style={{ color: meus.length ? C.texto : C.mute, minWidth: 108 }}>{n}</span>
                      {selecionadas.map((id) => {
                        const p = ptById.get(id);
                        if (!p) return null;
                        const on = meus.includes(id);
                        return (
                          <button key={id} onClick={() => toggleMembro(n, id)} disabled={!canEdit} title={`${p.nome}${on ? " (marcado)" : ""}`}
                            style={{ cursor: canEdit ? "pointer" : "default", borderRadius: 6, border: `1px solid ${on ? C.verde : C.borderSoft}`, background: on ? C.verdeTint : "transparent", padding: "1px 5px", fontSize: 12, lineHeight: 1.5, opacity: on ? 1 : 0.5 }}>
                            {p.emoji ? <EmojiPt raw={p.emoji} /> : p.nome.slice(0, 3)}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              {!selecionadas.length && <div style={{ color: C.amarelo, fontSize: 12.5, marginTop: 8 }}>Escolha as PTs do preset acima pra poder atribuir.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const mini = { background: "none", border: "none", cursor: "pointer", color: "#8f8f8f", fontSize: 10, padding: "0 1px", lineHeight: 1 } as const;

/** "<:nome:id>" → imagem do CDN; unicode → o próprio caractere. */
function EmojiPt({ raw }: { raw: string }) {
  const m = raw.match(/^<a?:\w+:(\d+)>$/);
  if (m) return <img src={`https://cdn.discordapp.com/emojis/${m[1]}.png`} alt="" width={14} height={14} style={{ verticalAlign: "-2px", borderRadius: 3 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />;
  return <span>{raw}</span>;
}
