"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { TIERS, corTier } from "@/lib/tier";
import { chaveNome } from "@/lib/nomes";
import type { Funcao } from "@/lib/funcao";
import type { Party } from "@/lib/party";
import type { Preset, PlayerFuncao } from "@/lib/intencaoPreset";
import type { IntencaoConfig } from "@/lib/intencaoConfig";

/**
 * Central de definições — cria num lugar só e vale em todo lugar. Três eixos que NÃO se misturam:
 *
 *  FUNÇÃO  — o papel que vira BOTÃO no bot (Shai, Flanco, Ataque…). Uma função junta classes
 *            diferentes; o que importa é quem faz aquele papel.
 *  PARTY   — onde a pessoa fica de fato in-game. É o ALVO da escalação, nunca aparece no bot.
 *  LENDÁRIO— atributo fixo da pessoa. NUNCA aparece no bot; só destaca o card na escalação.
 */
type Jog = { nome: string; lendario: boolean };
const TIPOS = ["nodewar", "siege"] as const;

export default function ConfigBoard({
  funcoes, parties, presets, membros, jogadores, canais, canEdit,
}: { funcoes: Funcao[]; parties: Party[]; presets: Preset[]; membros: PlayerFuncao[]; jogadores: Jog[]; canais: IntencaoConfig; canEdit: boolean }) {
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
  // vários presets por tipo (T1, T2, siege A…) — o selecionado é o que se edita
  const doTipo = useMemo(() => presets.filter((p) => p.tipo === tipo), [presets, tipo]);
  const [presetId, setPresetId] = useState<number | null>(null);
  const preset = useMemo(() => doTipo.find((p) => p.id === presetId) ?? doTipo[0] ?? null, [doTipo, presetId]);
  const noPreset = useMemo(() => (preset?.parties ?? []).map((v) => v.party_id), [preset]);
  const membrosTipo = membros; // função do jogador é global — não depende de tipo nem de preset
  const funcoesPorChave = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const x of membrosTipo) { const a = m.get(x.chave) ?? []; a.push(x.funcao_id); m.set(x.chave, a); }
    return m;
  }, [membrosTipo]);
  const lendarios = jogadores.filter((j) => j.lendario);

  // lista de jogadores em ORDEM ALFABÉTICA (localeCompare pra acento não ir pro fim) e filtrada.
  // Sem busca corta no TETO — 111 nomes × N botões é lento de renderizar e pior de ler; com busca
  // não corta, senão o que você procurou pode cair fora do corte.
  const TETO = 60;
  const listaJogadores = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const orden = [...jogadores].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    const filtrados = q ? orden.filter((j) => j.nome.toLowerCase().includes(q)) : orden;
    return q ? filtrados : filtrados.slice(0, TETO);
  }, [jogadores, busca]);
  const comFuncao = useMemo(() => new Set(membros.map((m) => m.chave)).size, [membros]);

  async function api(body: Record<string, unknown>, ok?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || (d as { error?: string }).error) throw new Error((d as { error?: string }).error ?? `erro ${res.status}`);
      if (ok) setMsg({ k: "ok", t: ok });
      router.refresh();
      return d as Record<string, unknown>;
    } catch (e) { setMsg({ k: "err", t: (e as Error).message }); return null; }
    finally { setBusy(false); }
  }

  const card = { border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 16, marginBottom: 14 } as const;
  const input = { background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "7px 10px", fontSize: 13, outline: "none" } as const;
  const btn = (cor: string) => ({ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: cor, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" } as const);
  const chip = (on: boolean) => ({ cursor: canEdit ? "pointer" : "default", borderRadius: 999, border: `1px solid ${on ? C.verde : C.border2}`, background: on ? C.verdeTint : C.inputBg, color: on ? C.verde : C.mute, padding: "4px 11px", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit" } as const);

  /** Salva um canal sozinho — mescla no que já existe pra não zerar o outro campo. */
  const salvarCanal = (tipo: string, campo: string, valor: string) => {
    if (!canEdit) return;
    const novo = JSON.parse(JSON.stringify(canais)) as Record<string, Record<string, string>>;
    if (!novo[tipo]) novo[tipo] = { canalChamada: "", canalLista: "" };
    if (novo[tipo][campo] === valor.replace(/[^0-9]/g, "")) return; // nada mudou
    novo[tipo][campo] = valor;
    api({ acao: "canais", canais: novo }, "canal salvo");
  };

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

        {/* CANAIS — dois, de propósito: a chamada é pra todo mundo responder, a lista é o resultado */}
        <div style={card}>
          <Titulo>Canais do Discord <Sub>onde sai o convite e onde sai a escalação pronta</Sub></Titulo>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
            {TIPOS.map((t) => (
              <div key={t} style={{ border: `1px solid ${C.border2}`, borderRadius: 10, padding: "10px 12px", background: C.inputBg }}>
                <div style={{ color: C.amarelo, fontSize: 12.5, fontWeight: 700, textTransform: "capitalize", marginBottom: 8 }}>{t}</div>
                {([["canalChamada", "Chamada (marcar função)"], ["canalLista", "Lista (escalação pronta)"]] as const).map(([k, rot]) => (
                  <div key={k} style={{ marginBottom: 7 }}>
                    <label style={{ color: C.mute, fontSize: 11, display: "block", marginBottom: 3 }}>{rot}</label>
                    <input defaultValue={canais?.[t]?.[k] ?? ""} disabled={!canEdit} placeholder="ID do canal"
                      onBlur={(e) => salvarCanal(t, k, e.target.value)}
                      style={{ ...input, width: "100%", padding: "5px 9px", fontSize: 12.5 }} />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div style={{ color: C.borderSoft, fontSize: 11, marginTop: 6 }}>
            Lista vazia → cai no canal da chamada. Chamada vazia → cai no canal da tela <Link href="/participacao" style={{ color: C.verde }}>Participação</Link>.
          </div>
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

        {/* LENDÁRIOS */}
        <div style={card}>
          <Titulo>Lendários <Sub>destaque na escalação — <b style={{ color: C.amarelo }}>nunca</b> aparece no bot</Sub></Titulo>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {lendarios.map((j) => (
              <span key={j.nome} style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 999, padding: "3px 6px 3px 10px", fontSize: 12.5, color: C.amarelo, background: "rgba(214,178,42,.12)", border: `1px solid ${C.amarelo}`, boxShadow: `0 0 8px rgba(214,178,42,.35)` }}>
                ✦ {j.nome}
                {canEdit && <button onClick={() => api({ acao: "lendario", familia: j.nome, valor: false })} style={{ ...mini, color: C.mute }} title="tirar">✕</button>}
              </span>
            ))}
            {!lendarios.length && <Vazio>Ninguém marcado como lendário.</Vazio>}
          </div>
          {canEdit && (
            <>
              <input value={buscaRel} onChange={(e) => setBuscaRel(e.target.value)} placeholder="buscar jogador p/ marcar…" style={{ ...input, minWidth: 220 }} />
              {buscaRel.trim() && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {jogadores.filter((j) => !j.lendario && j.nome.toLowerCase().includes(buscaRel.toLowerCase()))
                    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).slice(0, 14).map((j) => (
                    <button key={j.nome} onClick={() => { api({ acao: "lendario", familia: j.nome, valor: true }, `${j.nome} virou lendário`); setBuscaRel(""); }} style={chip(false)}>+ {j.nome}</button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* PRESET DO BOT */}
        <div style={card}>
          <Titulo>Preset da guerra <Sub>quais PTs entram em campo e quanta gente cabe — o bot mostra <b>todas</b> as funções, independente disto</Sub></Titulo>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {TIPOS.map((t) => <button key={t} onClick={() => setTipo(t)} style={{ ...chip(tipo === t), cursor: "pointer", textTransform: "capitalize" }}>{t}</button>)}
          </div>

          {/* dá pra ter várias chamadas do mesmo tipo (T1, T2…) — escolha qual editar */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            {doTipo.map((p) => (
              <button key={p.id} onClick={() => setPresetId(p.id)} style={chip(preset?.id === p.id)}>{p.nome}</button>
            ))}
            {canEdit && (
              <>
                <input value={npreset} onChange={(e) => setNpreset(e.target.value)} placeholder={`nova chamada de ${tipo}`}
                  style={{ ...input, minWidth: 170, padding: "5px 9px", fontSize: 12.5 }} />
                <button disabled={busy || !npreset.trim()} onClick={async () => { const d = await api({ acao: "preset-criar", nome: npreset, tipo, funcoes: [] }, "chamada criada"); const nid = (d as { id?: number } | null)?.id; if (nid) setPresetId(nid); setNpreset(""); }} style={btn(C.verde)}>+ Criar</button>
              </>
            )}
          </div>

          {!preset ? (
            <Vazio>Nenhuma chamada de {tipo} ainda — crie uma acima.</Vazio>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 13 }}><b style={{ color: C.amarelo }}>{preset.nome}</b> — {noPreset.length} função(ões)</span>
                <span style={{ display: "flex", gap: 8 }}>
                  {canEdit && <button disabled={busy} onClick={() => confirm(`Excluir a chamada ${preset.nome}?`) && api({ acao: "preset-excluir", id: preset.id }, "chamada excluída")} style={btn(C.vermelho)}>Excluir</button>}
                  {canEdit && <button disabled={busy || !noPreset.length} onClick={() => api({ acao: "postar", id: preset.id }, "chamada postada no Discord")} style={{ ...btn(C.verde), background: C.verdeTint }}>📢 Postar chamada</button>}
                </span>
              </div>
              {/* o preset é composto de PTs — elas viram as colunas da escalação */}
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
                {parties.map((p) => {
                  const on = noPreset.includes(p.id);
                  return (
                    <button key={p.id} disabled={!canEdit} style={chip(on)}
                      onClick={() => api({ acao: "preset-editar", id: preset.id, nome: preset.nome, tipo: preset.tipo, parties: on ? noPreset.filter((x) => x !== p.id) : [...noPreset, p.id] })}>
                      <Icone raw={p.icone} /> {p.nome}
                    </button>
                  );
                })}
                {!parties.length && <Vazio>Nenhuma party criada ainda — crie acima.</Vazio>}
                <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: C.mute, fontSize: 11.5 }}>tier:</span>
                  <select defaultValue={preset.tier ?? ""} disabled={!canEdit}
                    onChange={(e) => api({ acao: "preset-editar", id: preset.id, tier: e.target.value || null }, "tier salvo")}
                    title="T1/T2/T3 — porte da guerra; o evento nasce com este valor e pode ser trocado depois"
                    style={{ ...input, width: 78, padding: "5px 8px", fontSize: 12.5, cursor: canEdit ? "pointer" : "default", color: preset.tier ? corTier[preset.tier] : C.mute }}>
                    <option value="">—</option>
                    {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <span style={{ color: C.mute, fontSize: 11.5 }}>canal:</span>
                  <input defaultValue={preset.canal_id ?? ""} disabled={!canEdit} placeholder="do tipo"
                    onBlur={(e) => api({ acao: "preset-editar", id: preset.id, nome: preset.nome, tipo: preset.tipo, canalId: e.target.value }, "canal do preset salvo")}
                    title="canal desta chamada específica; vazio = usa o canal do tipo"
                    style={{ ...input, width: 150, padding: "5px 8px", fontSize: 12.5 }} />
                  <span style={{ color: C.mute, fontSize: 11.5 }}>máx:</span>
                  <input type="number" min={1} max={500} defaultValue={preset.tamanho_max ?? ""} disabled={!canEdit} placeholder="—"
                    onBlur={(e) => api({ acao: "preset-editar", id: preset.id, nome: preset.nome, tipo: preset.tipo, tamanhoMax: e.target.value || null }, "teto salvo")}
                    title="quantas pessoas cabem nesta guerra — referência da escalação, o bot não corta ninguém"
                    style={{ ...input, width: 70, padding: "5px 8px", fontSize: 12.5 }} />
                </span>
              </div>
              {!!noPreset.length && <div style={{ color: C.borderSoft, fontSize: 11.5, marginBottom: 12 }}>Colunas da escalação: {noPreset.map((id) => parties.find((x) => x.id === id)?.nome ?? id).join(" → ")}</div>}

            </>
          )}
        </div>


        {/* FUNÇÃO DO JOGADOR — card próprio: é atributo da pessoa, não depende de preset nem de
            tipo. Ficava aninhado no bloco do preset, então sumia quando não havia preset de siege. */}
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
            <Titulo>Função do jogador <Sub>o que ele sabe fazer — vale em todo preset, várias por pessoa</Sub></Titulo>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="buscar jogador…" autoComplete="off"
              style={{ ...input, minWidth: 200, padding: "6px 10px", fontSize: 12.5 }} />
          </div>
          <div style={{ color: C.mute, fontSize: 11.5, marginBottom: 10 }}>
            {comFuncao} de {jogadores.length} jogadores com função atribuída
            {busca && ` · ${listaJogadores.length} no filtro`}
            {!busca && jogadores.length > TETO && ` · mostrando os ${TETO} primeiros, use a busca`}
          </div>
          {!funcoes.length ? (
            <div style={{ color: C.amarelo, fontSize: 12.5 }}>Crie ao menos uma função lá em cima pra poder atribuir.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: "5px 16px" }}>
              {listaJogadores.map((j) => {
                const meus = funcoesPorChave.get(chaveNome(j.nome)) ?? [];
                return (
                  <div key={j.nome} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, flexWrap: "wrap" }}>
                    <span style={{ color: meus.length ? C.texto : C.mute, minWidth: 108 }}>{j.nome}</span>
                    {funcoes.map((f) => {
                      const on = meus.includes(f.id);
                      return (
                        <button key={f.id} disabled={!canEdit} title={`${f.nome}${on ? " (marcado)" : ""}`}
                          onClick={() => api({ acao: on ? "membro-del" : "membro-add", familia: j.nome, funcaoId: f.id })}
                          style={{ cursor: canEdit ? "pointer" : "default", borderRadius: 6, border: `1px solid ${on ? C.verde : C.borderSoft}`, background: on ? C.verdeTint : "transparent", padding: "1px 5px", fontSize: 12, opacity: on ? 1 : 0.45 }}>
                          {f.emoji ? <Icone raw={f.emoji} /> : f.nome.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {!listaJogadores.length && <Vazio>Nenhum jogador com “{busca}”.</Vazio>}
            </div>
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
