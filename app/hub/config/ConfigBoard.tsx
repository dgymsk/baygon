"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { TIPOS_GUERRA as TIPOS, rotuloGuerra } from "@/lib/tiposGuerra";
import EmojiPicker from "@/app/emojis/EmojiPicker";
import type { EmojiGuild } from "@/lib/discordApi";
import { iconeUrl, type GuildEntry } from "@/lib/guild";
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
type Jog = { nome: string; lendario: boolean; ativo: boolean; guilda: string | null };


export default function ConfigBoard({
  funcoes, parties, presets, membros, jogadores, canais, guildas, roles = [], emojis = [], canEdit,
}: { funcoes: Funcao[]; parties: Party[]; presets: Preset[]; membros: PlayerFuncao[]; jogadores: Jog[]; canais: IntencaoConfig; guildas: GuildEntry[]; roles?: { id: string; name: string }[]; emojis?: EmojiGuild[]; canEdit: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tipo, setTipo] = useState<string>("nodewar");
  const [nf, setNf] = useState({ nome: "", emoji: "" });
  const [np, setNp] = useState({ nome: "", icone: "" });
  const [busca, setBusca] = useState("");
  const [buscaRel, setBuscaRel] = useState("");

  const fById = useMemo(() => new Map(funcoes.map((f) => [f.id, f])), [funcoes]);
  // vários presets por tipo (T1, T2, siege A…) — o selecionado é o que se edita
  const membrosTipo = membros; // função do jogador é global — não depende de tipo nem de preset
  const funcoesPorChave = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const x of membrosTipo) { const a = m.get(x.chave) ?? []; a.push(x.funcao_id); m.set(x.chave, a); }
    return m;
  }, [membrosTipo]);
  // quem saiu da guilda não tem função a atribuir nem entra em escalação nenhuma — antes a lista
  // vinha com os 111 do cadastro, e a maioria já estava marcada como "Saiu"
  const ativos = useMemo(() => jogadores.filter((j) => j.ativo), [jogadores]);
  const guildaPorId = useMemo(() => new Map(guildas.map((g) => [g.id, g])), [guildas]);
  // lendário inativo continua à mostra pra dar pra desmarcar; quem some é o candidato novo
  const lendarios = jogadores.filter((j) => j.lendario);

  // lista de jogadores em ORDEM ALFABÉTICA (localeCompare pra acento não ir pro fim) e filtrada.
  // Sem busca corta no TETO — 111 nomes × N botões é lento de renderizar e pior de ler; com busca
  // não corta, senão o que você procurou pode cair fora do corte.
  const TETO = 60;
  const listaJogadores = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const orden = [...ativos].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    const filtrados = q ? orden.filter((j) => j.nome.toLowerCase().includes(q)) : orden;
    return q ? filtrados : filtrados.slice(0, TETO);
  }, [ativos, busca]);
  // só conta função de quem está ativo: o denominador e o numerador têm que falar da mesma gente
  const chavesAtivas = useMemo(() => new Set(ativos.map((j) => chaveNome(j.nome))), [ativos]);
  const comFuncao = useMemo(() => new Set(membros.map((m) => m.chave).filter((k) => chavesAtivas.has(k))).size, [membros, chavesAtivas]);

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
          <div style={{ color: C.mute, fontSize: 11.5, marginBottom: 8 }}>
            🔒 = só quem tem o cargo do Discord consegue marcar. Deixe <b style={{ color: C.texto }}>aberta</b> pra qualquer um.
            {!roles.length && <span style={{ color: C.amarelo }}> · não consegui ler os cargos do servidor (bot sem permissão?)</span>}
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
            {funcoes.map((f) => (
              <span key={f.id} style={{ display: "inline-flex", alignItems: "center", gap: 3, border: `1px solid ${C.border2}`, borderRadius: 999, padding: "3px 6px 3px 10px", background: C.inputBg }}>
                {canEdit
                  ? <EmojiPicker emojis={emojis} value={f.emoji} titulo="trocar o emoji" onPick={(v) => api({ acao: "funcao-editar", id: f.id, nome: f.nome, emoji: v }, "emoji salvo")} />
                  : <Icone raw={f.emoji} />}
                <span style={{ fontSize: 12.5 }}>{f.nome}</span>
                {/* cargo exigido: quem não tem, não consegue marcar essa função no bot */}
                {canEdit && roles.length > 0 && (
                  <select value={f.role_id ?? ""} disabled={busy}
                    onChange={(e) => api({ acao: "funcao-editar", id: f.id, roleId: e.target.value || null }, e.target.value ? `${f.nome}: só quem tem o cargo` : `${f.nome}: aberta a todos`)}
                    title="só quem tem este cargo consegue marcar esta função no bot; vazio = aberta a todos"
                    style={{ background: "transparent", border: "none", color: f.role_id ? C.amarelo : C.borderSoft, fontSize: 11, fontFamily: "inherit", cursor: "pointer", maxWidth: 130, outline: "none" }}>
                    <option value="">🔓 aberta</option>
                    {roles.map((r) => <option key={r.id} value={r.id}>🔒 {r.name}</option>)}
                  </select>
                )}
                {!canEdit && f.role_id && <span title="restrita por cargo" style={{ color: C.amarelo, fontSize: 10 }}>🔒</span>}
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
              <EmojiPicker emojis={emojis} value={nf.emoji} onPick={(v) => setNf({ ...nf, emoji: v })} titulo="emoji da função" />
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
                <div style={{ color: C.amarelo, fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{rotuloGuerra(t)}</div>
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
                {canEdit
                  ? <EmojiPicker emojis={emojis} value={p.icone} titulo="trocar o ícone" onPick={(v) => api({ acao: "party-editar", id: p.id, nome: p.nome, icone: v }, "ícone salvo")} />
                  : <Icone raw={p.icone} />}
                <span style={{ fontSize: 12.5 }}>{p.nome}</span>
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
              <EmojiPicker emojis={emojis} value={np.icone} onPick={(v) => setNp({ ...np, icone: v })} titulo="ícone da party" />
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
                  {ativos.filter((j) => !j.lendario && j.nome.toLowerCase().includes(buscaRel.toLowerCase()))
                    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).slice(0, 14).map((j) => (
                    <button key={j.nome} onClick={() => { api({ acao: "lendario", familia: j.nome, valor: true }, `${j.nome} virou lendário`); setBuscaRel(""); }} style={chip(false)}>+ {j.nome}</button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* CHAMADAS — moradia própria em /hub/presets: uma chamada é a soma de função, party,
            tier, teto e canal, e montar isso num card espremido entre outros seis era o motivo de
            metade dos campos passar despercebida. Aqui fica só o ponteiro. */}
        <div style={card}>
          <Titulo>Chamadas <Sub>quais botões e PTs entram em cada guerra</Sub></Titulo>
          <div style={{ color: C.mute, fontSize: 12.5 }}>
            As chamadas têm tela própria — lá você escolhe quais das funções abaixo viram botão, quais PTs viram coluna, o tier, o teto e o canal.{" "}
            <Link href="/hub/presets" style={{ color: C.verde, fontWeight: 700 }}>Abrir Chamadas →</Link>
          </div>
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
            {comFuncao} de {ativos.length} jogadores ativos com função atribuída
            {busca && ` · ${listaJogadores.length} no filtro`}
            {!busca && ativos.length > TETO && ` · mostrando os ${TETO} primeiros, use a busca`}
          </div>
          {!funcoes.length ? (
            <div style={{ color: C.amarelo, fontSize: 12.5 }}>Crie ao menos uma função lá em cima pra poder atribuir.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: "5px 16px" }}>
              {listaJogadores.map((j) => {
                const meus = funcoesPorChave.get(chaveNome(j.nome)) ?? [];
                return (
                  <div key={j.nome} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, flexWrap: "wrap" }}>
                    <BrasaoGuilda g={guildaPorId.get(j.guilda ?? "")} />
                    <span style={{ color: meus.length ? C.texto : C.mute, minWidth: 98 }}>{j.nome}</span>
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

/** Brasão da guilda do jogador. Sem ícone configurado cai na tag; sem guilda, não ocupa espaço. */
function BrasaoGuilda({ g }: { g?: GuildEntry }) {
  if (!g) return <span style={{ width: 14, flexShrink: 0 }} />;
  const u = iconeUrl(g.icone);
  return u
    ? <img src={u} alt={g.nome} title={g.nome} width={14} height={14} style={{ flexShrink: 0, borderRadius: 3 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
    : <span title={g.nome} style={{ flexShrink: 0, width: 14, fontSize: 9, color: g.cor, fontWeight: 700, textAlign: "center" }}>{g.tag}</span>;
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
