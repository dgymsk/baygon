"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { chaveNome } from "@/lib/nomes";
import type { Funcao } from "@/lib/funcao";
import type { Party } from "@/lib/party";
import type { Preset, MembroInt } from "@/lib/intencaoPreset";

/**
 * Central de definições — cria num lugar só e vale em todo lugar. Três eixos que NÃO se misturam:
 *
 *  FUNÇÃO  — o papel que vira BOTÃO no bot (Shai, Flanco, Ataque…). Uma função junta classes
 *            diferentes; o que importa é quem faz aquele papel.
 *  PARTY   — onde a pessoa fica de fato in-game. É o ALVO da escalação, nunca aparece no bot.
 *  RELÍQUIA— atributo fixo da pessoa. NUNCA aparece no bot; só destaca o card na escalação.
 */
type Jog = { nome: string; reliquia: boolean };
const TIPOS = ["nodewar", "siege"] as const;

export default function ConfigBoard({
  funcoes, parties, presets, membros, jogadores, canEdit,
}: { funcoes: Funcao[]; parties: Party[]; presets: Preset[]; membros: MembroInt[]; jogadores: Jog[]; canEdit: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tipo, setTipo] = useState<string>("nodewar");
  const [nf, setNf] = useState({ nome: "", emoji: "" });
  const [np, setNp] = useState({ nome: "", icone: "" });
  const [npreset, setNpreset] = useState("");
  const [busca, setBusca] = useState("");
  const [buscaRel, setBuscaRel] = useState("");

  const fById = useMemo(() => new Map(funcoes.map((f) => [f.id, f])), [funcoes]);
  const preset = useMemo(() => presets.find((p) => p.tipo === tipo) ?? null, [presets, tipo]);
  const noPreset = useMemo(() => (preset?.funcoes ?? []).map((v) => v.funcao_id), [preset]);
  const membrosTipo = useMemo(() => membros.filter((m) => m.tipo === tipo), [membros, tipo]);
  const funcoesPorChave = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const x of membrosTipo) { const a = m.get(x.chave) ?? []; a.push(x.funcao_id); m.set(x.chave, a); }
    return m;
  }, [membrosTipo]);
  const reliquias = jogadores.filter((j) => j.reliquia);

  async function api(body: Record<string, unknown>, ok?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || (d as { error?: string }).error) throw new Error((d as { error?: string }).error ?? `erro ${res.status}`);
      if (ok) setMsg({ k: "ok", t: ok });
      router.refresh();
    } catch (e) { setMsg({ k: "err", t: (e as Error).message }); }
    finally { setBusy(false); }
  }

  const card = { border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 16, marginBottom: 14 } as const;
  const input = { background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "7px 10px", fontSize: 13, outline: "none" } as const;
  const btn = (cor: string) => ({ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: cor, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" } as const);
  const chip = (on: boolean) => ({ cursor: canEdit ? "pointer" : "default", borderRadius: 999, border: `1px solid ${on ? C.verde : C.border2}`, background: on ? C.verdeTint : C.inputBg, color: on ? C.verde : C.mute, padding: "4px 11px", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit" } as const);

  const mover = (lista: { id: number }[], id: number, dir: -1 | 1, acao: string) => {
    const ids = lista.map((x) => x.id);
    const i = ids.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    api({ acao, ids });
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>

      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 26, letterSpacing: 1, margin: 0, color: C.amarelo }}>
            BAYGON <span style={{ color: C.mute, fontSize: 14, letterSpacing: 2 }}>· DEFINIÇÕES</span>
          </h1>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            {msg && <span style={{ color: msg.k === "ok" ? C.verde : C.vermelho, fontSize: 13 }}>{msg.k === "ok" ? "✓" : "⚠"} {msg.t}</span>}
            <Link className="navlink" href="/hub">← Hub</Link>
          </div>
        </div>

        {/* FUNÇÕES */}
        <div style={card}>
          <Titulo>Funções <Sub>o que vira botão no bot — o papel, não a party</Sub></Titulo>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
            {funcoes.map((f) => (
              <span key={f.id} style={{ display: "inline-flex", alignItems: "center", gap: 3, border: `1px solid ${C.border2}`, borderRadius: 999, padding: "3px 6px 3px 10px", background: C.inputBg }}>
                <Icone raw={f.emoji} /> <span style={{ fontSize: 12.5 }}>{f.nome}</span>
                {canEdit && <>
                  <button onClick={() => mover(funcoes, f.id, -1, "funcao-ordenar")} style={mini} title="esquerda">◀</button>
                  <button onClick={() => mover(funcoes, f.id, 1, "funcao-ordenar")} style={mini} title="direita">▶</button>
                  <button onClick={() => confirm(`Excluir a função ${f.nome}? As marcações dela somem.`) && api({ acao: "funcao-excluir", id: f.id }, "função excluída")} style={{ ...mini, color: C.vermelho }} title="excluir">✕</button>
                </>}
              </span>
            ))}
            {!funcoes.length && <Vazio>Nenhuma função ainda.</Vazio>}
          </div>
          {canEdit && (
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              <input value={nf.nome} onChange={(e) => setNf({ ...nf, nome: e.target.value })} placeholder="Nome (ex.: Flanco)" style={{ ...input, minWidth: 170 }} />
              <input value={nf.emoji} onChange={(e) => setNf({ ...nf, emoji: e.target.value })} placeholder="Emoji ou :nome:" style={{ ...input, width: 150 }} />
              <button disabled={busy || !nf.nome.trim()} onClick={() => { api({ acao: "funcao-criar", nome: nf.nome, emoji: nf.emoji }, "função criada"); setNf({ nome: "", emoji: "" }); }} style={btn(C.verde)}>+ Função</button>
            </div>
          )}
        </div>

        {/* PARTIES */}
        <div style={card}>
          <Titulo>Parties in-game <Sub>onde a pessoa fica de fato — é o alvo da escalação, nunca aparece no bot</Sub></Titulo>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
            {parties.map((p) => (
              <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 3, border: `1px solid ${C.border2}`, borderRadius: 999, padding: "3px 6px 3px 10px", background: C.inputBg }}>
                <Icone raw={p.icone} /> <span style={{ fontSize: 12.5 }}>{p.nome}</span>
                {canEdit && <>
                  <button onClick={() => mover(parties, p.id, -1, "party-ordenar")} style={mini} title="esquerda">◀</button>
                  <button onClick={() => mover(parties, p.id, 1, "party-ordenar")} style={mini} title="direita">▶</button>
                  <button onClick={() => confirm(`Excluir a party ${p.nome}? Quem estava escalado nela volta pro pool.`) && api({ acao: "party-excluir", id: p.id }, "party excluída")} style={{ ...mini, color: C.vermelho }} title="excluir">✕</button>
                </>}
              </span>
            ))}
            {!parties.length && <Vazio>Nenhuma party — a escalação precisa de pelo menos uma.</Vazio>}
          </div>
          {canEdit && (
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              <input value={np.nome} onChange={(e) => setNp({ ...np, nome: e.target.value })} placeholder="Nome (ex.: PT1, Defesa)" style={{ ...input, minWidth: 170 }} />
              <input value={np.icone} onChange={(e) => setNp({ ...np, icone: e.target.value })} placeholder="Ícone ou :nome:" style={{ ...input, width: 150 }} />
              <button disabled={busy || !np.nome.trim()} onClick={() => { api({ acao: "party-criar", nome: np.nome, icone: np.icone }, "party criada"); setNp({ nome: "", icone: "" }); }} style={btn(C.verde)}>+ Party</button>
            </div>
          )}
        </div>

        {/* RELÍQUIAS */}
        <div style={card}>
          <Titulo>Relíquias <Sub>destaque na escalação — <b style={{ color: C.amarelo }}>nunca</b> aparece no bot</Sub></Titulo>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {reliquias.map((j) => (
              <span key={j.nome} style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 999, padding: "3px 6px 3px 10px", fontSize: 12.5, color: C.amarelo, background: "rgba(214,178,42,.12)", border: `1px solid ${C.amarelo}`, boxShadow: `0 0 8px rgba(214,178,42,.35)` }}>
                ✦ {j.nome}
                {canEdit && <button onClick={() => api({ acao: "reliquia", familia: j.nome, valor: false })} style={{ ...mini, color: C.mute }} title="tirar">✕</button>}
              </span>
            ))}
            {!reliquias.length && <Vazio>Ninguém marcado como relíquia.</Vazio>}
          </div>
          {canEdit && (
            <>
              <input value={buscaRel} onChange={(e) => setBuscaRel(e.target.value)} placeholder="buscar jogador p/ marcar…" style={{ ...input, minWidth: 220 }} />
              {buscaRel.trim() && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {jogadores.filter((j) => !j.reliquia && j.nome.toLowerCase().includes(buscaRel.toLowerCase())).slice(0, 14).map((j) => (
                    <button key={j.nome} onClick={() => { api({ acao: "reliquia", familia: j.nome, valor: true }, `${j.nome} virou relíquia`); setBuscaRel(""); }} style={chip(false)}>+ {j.nome}</button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* PRESET DO BOT */}
        <div style={card}>
          <Titulo>Chamada do bot <Sub>quais funções viram botão, em que ordem</Sub></Titulo>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {TIPOS.map((t) => <button key={t} onClick={() => setTipo(t)} style={{ ...chip(tipo === t), cursor: "pointer", textTransform: "capitalize" }}>{t}</button>)}
          </div>

          {!preset ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input value={npreset} onChange={(e) => setNpreset(e.target.value)} placeholder={`Nome da chamada de ${tipo}`} disabled={!canEdit} style={{ ...input, minWidth: 220 }} />
              <button disabled={!canEdit || busy || !npreset.trim()} onClick={() => { api({ acao: "preset-criar", nome: npreset, tipo, funcoes: [] }, "chamada criada"); setNpreset(""); }} style={btn(C.verde)}>Criar</button>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 13 }}><b style={{ color: C.amarelo }}>{preset.nome}</b> — {noPreset.length} função(ões)</span>
                {canEdit && <button disabled={busy || !noPreset.length} onClick={() => api({ acao: "postar", id: preset.id }, "chamada postada no Discord")} style={{ ...btn(C.verde), background: C.verdeTint }}>📢 Postar chamada</button>}
              </div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
                {funcoes.map((f) => {
                  const on = noPreset.includes(f.id);
                  return (
                    <button key={f.id} disabled={!canEdit} style={chip(on)}
                      onClick={() => api({ acao: "preset-editar", id: preset.id, nome: preset.nome, tipo: preset.tipo, funcoes: on ? noPreset.filter((x) => x !== f.id) : [...noPreset, f.id] })}>
                      <Icone raw={f.emoji} /> {f.nome}
                    </button>
                  );
                })}
              </div>
              {!!noPreset.length && <div style={{ color: C.borderSoft, fontSize: 11.5, marginBottom: 12 }}>Ordem dos botões: {noPreset.map((id) => fById.get(id)?.nome ?? id).join(" → ")}</div>}

              <div style={{ borderTop: `1px solid ${C.borderSoft}`, paddingTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <span style={{ color: C.verde, fontWeight: 700, fontSize: 13 }}>Função de casa <Sub>só monta a lista ⬜ de quem não respondeu</Sub></span>
                  <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="filtrar jogador…" style={{ ...input, minWidth: 170, padding: "5px 9px", fontSize: 12.5 }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))", gap: "5px 14px", marginTop: 10 }}>
                  {jogadores.filter((j) => !busca || j.nome.toLowerCase().includes(busca.toLowerCase())).slice(0, 100).map((j) => {
                    const meus = funcoesPorChave.get(chaveNome(j.nome)) ?? [];
                    return (
                      <div key={j.nome} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, flexWrap: "wrap" }}>
                        <span style={{ color: meus.length ? C.texto : C.mute, minWidth: 100 }}>{j.nome}</span>
                        {noPreset.map((id) => {
                          const f = fById.get(id);
                          if (!f) return null;
                          const on = meus.includes(id);
                          return (
                            <button key={id} disabled={!canEdit} title={f.nome}
                              onClick={() => api({ acao: on ? "membro-del" : "membro-add", tipo, familia: j.nome, funcaoId: id })}
                              style={{ cursor: canEdit ? "pointer" : "default", borderRadius: 6, border: `1px solid ${on ? C.verde : C.borderSoft}`, background: on ? C.verdeTint : "transparent", padding: "1px 5px", fontSize: 12, opacity: on ? 1 : 0.5 }}>
                              {f.emoji ? <Icone raw={f.emoji} /> : f.nome.slice(0, 3)}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                {!noPreset.length && <div style={{ color: C.amarelo, fontSize: 12.5, marginTop: 8 }}>Escolha as funções da chamada acima pra poder atribuir.</div>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const mini = { background: "none", border: "none", cursor: "pointer", color: "#8f8f8f", fontSize: 10, padding: "0 1px", lineHeight: 1 } as const;
const Titulo = ({ children }: { children: React.ReactNode }) => <div style={{ color: C.verde, fontWeight: 700, fontSize: 14, marginBottom: 10 }}>{children}</div>;
const Sub = ({ children }: { children: React.ReactNode }) => <span style={{ color: C.mute, fontWeight: 400, fontSize: 11.5 }}>— {children}</span>;
const Vazio = ({ children }: { children: React.ReactNode }) => <span style={{ color: C.borderSoft, fontSize: 12.5 }}>{children}</span>;

/** "<:nome:id>" → imagem do CDN; unicode → o caractere. */
function Icone({ raw }: { raw: string | null }) {
  const m = (raw ?? "").match(/^<a?:\w+:(\d+)>$/);
  if (m) return <img src={`https://cdn.discordapp.com/emojis/${m[1]}.png`} alt="" width={14} height={14} style={{ verticalAlign: "-2px", borderRadius: 3 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />;
  return raw ? <span>{raw}</span> : null;
}
