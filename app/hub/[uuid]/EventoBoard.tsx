"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { iconeUrl, type GuildEntry } from "@/lib/guild";

/**
 * Tela do evento. A escalação é o coração: à esquerda o pool AGRUPADO POR FUNÇÃO (o que a pessoa
 * marcou no bot — quem marcou 3 aparece nas 3), à direita uma coluna por PARTY IN-GAME. Arrastar
 * tira a pessoa de todos os grupos de uma vez, porque a party é decisão única.
 *
 * Sinais no card: borda VERDE = confirmou in-game; brilho DOURADO = relíquia (marcação que nunca
 * chega ao bot); ⚠ N = guerras seguidas marcando e não jogando.
 */
export type JogadorVM = {
  chave: string; familia: string; userId: string;
  guilda: string | null; classe: string | null; gs: number | null;
  reliquia: boolean; confirmouIngame: boolean; jogou: boolean | null;
  escaladoEm: number | null; faltas: number | null;
};
export type GrupoVM = { funcaoId: number | null; nome: string; emoji: string | null; jogadores: JogadorVM[] };
export type PartyVM = { id: number; nome: string; icone: string | null };
type Ev = { uuid: string; titulo: string; tipo: string; data: string; status: string; resultado: string | null; temWar: boolean; eventoId: number };

export default function EventoBoard({
  evento, grupos, parties, escalados, canEdit, guildas,
}: { evento: Ev | null; grupos: GrupoVM[]; parties: PartyVM[]; escalados: JogadorVM[]; canEdit: boolean; guildas: GuildEntry[] }) {
  const router = useRouter();
  const [aba, setAba] = useState<"escalacao" | "presenca" | "stats">("escalacao");
  const [local, setLocal] = useState<Record<string, number | null>>({});
  const [sobre, setSobre] = useState<number | "pool" | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const arrastando = useRef<string | null>(null);
  const byId = useMemo(() => new Map(guildas.map((g) => [g.id, g])), [guildas]);

  const todos = useMemo(() => {
    const m = new Map<string, JogadorVM>();
    for (const g of grupos) for (const j of g.jogadores) m.set(j.chave, j);
    for (const j of escalados) if (!m.has(j.chave)) m.set(j.chave, j);
    return m;
  }, [grupos, escalados]);

  const partyDe = (j: JogadorVM) => (j.chave in local ? local[j.chave] : j.escaladoEm);
  const naParty = (id: number) => [...todos.values()].filter((j) => partyDe(j) === id);
  const nEscalados = [...todos.values()].filter((j) => partyDe(j) != null).length;

  async function api(body: Record<string, unknown>) {
    const res = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `erro ${res.status}`);
  }

  async function mover(chave: string, partyId: number | null) {
    if (!canEdit || !evento) return;
    const j = todos.get(chave);
    if (!j || partyDe(j) === partyId) return;
    setLocal((s) => ({ ...s, [chave]: partyId }));
    setSalvando(true);
    try {
      await api({ acao: "escalar", eventoId: evento.eventoId, ops: [{ familia: j.familia, partyId }] });
      setErro(""); router.refresh();
    } catch (e) {
      setErro((e as Error).message);
      setLocal((s) => { const n = { ...s }; delete n[chave]; return n; });
    } finally { setSalvando(false); }
  }

  async function togglePresenca(j: JogadorVM) {
    if (!canEdit || !evento) return;
    try { await api({ acao: "presenca-manual", eventoId: evento.eventoId, familia: j.familia, participar: !j.confirmouIngame }); router.refresh(); }
    catch (e) { setErro((e as Error).message); }
  }

  async function limpar() {
    if (!canEdit || !evento || !confirm("Tirar todo mundo da escalação?")) return;
    setSalvando(true);
    try { await api({ acao: "escalacao-limpar", eventoId: evento.eventoId }); setLocal({}); router.refresh(); }
    catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  const GuildIcon = ({ id }: { id: string | null }) => {
    const g = id ? byId.get(id) : null;
    if (!g) return null;
    const u = iconeUrl(g.icone);
    return u ? <img src={u} alt="" width={13} height={13} style={{ borderRadius: 3 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
      : <span style={{ fontSize: 10, color: C.mute }}>{g.tag}</span>;
  };

  const Card = ({ j }: { j: JogadorVM }) => (
    <div
      draggable={canEdit}
      onDragStart={() => { arrastando.current = j.chave; }}
      onDragEnd={() => { arrastando.current = null; setSobre(null); }}
      title={[j.reliquia ? "RELÍQUIA" : "", j.faltas ? `${j.faltas} guerras marcando e não jogando` : ""].filter(Boolean).join(" · ") || undefined}
      style={{
        // relíquia manda no visual (brilho dourado); confirmou in-game vem em seguida (verde)
        border: `1px solid ${j.reliquia ? C.amarelo : j.confirmouIngame ? C.verde : C.border2}`,
        boxShadow: j.reliquia ? "0 0 9px rgba(214,178,42,.45)" : "none",
        background: j.confirmouIngame ? C.verdeTint : C.inputBg,
        borderRadius: 9, padding: "6px 9px", cursor: canEdit ? "grab" : "default",
        display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, flexWrap: "wrap",
      }}
    >
      {j.reliquia && <span style={{ color: C.amarelo, fontSize: 12 }} title="relíquia">✦</span>}
      <GuildIcon id={j.guilda} />
      <span style={{ color: C.texto, fontWeight: 600 }}>{j.familia}</span>
      {j.classe && <span style={{ color: C.mute, fontSize: 11 }}>{j.classe}</span>}
      {j.gs != null && <span style={{ color: C.amarelo, fontSize: 11 }}>{j.gs}</span>}
      {j.faltas != null && j.faltas > 0 && <span style={{ color: j.faltas >= 3 ? C.vermelho : C.laranja, fontSize: 10.5, fontWeight: 700 }}>⚠ {j.faltas}</span>}
      {canEdit && (
        <button onClick={() => togglePresenca(j)} title={j.confirmouIngame ? "desmarcar confirmação in-game" : "marcar confirmado in-game"}
          style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: j.confirmouIngame ? C.verde : C.borderSoft, fontSize: 12, padding: "0 2px" }}>
          {j.confirmouIngame ? "✅" : "◻"}
        </button>
      )}
    </div>
  );

  const alvo = (id: number | "pool") => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setSobre(id); },
    onDragLeave: () => setSobre((s) => (s === id ? null : s)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setSobre(null); const c = arrastando.current; arrastando.current = null; if (c) mover(c, id === "pool" ? null : id); },
  });
  const realce = (id: number | "pool") => (sobre === id ? { borderColor: C.verde, background: C.verdeTint } : {});

  if (!evento) {
    return <Casca><div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 24, color: C.mute }}>Evento não encontrado, ou ele não teve chamada de intenção.</div></Casca>;
  }

  return (
    <Casca>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
        <div>
          <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 24, letterSpacing: 1, margin: 0, color: C.amarelo }}>{evento.titulo}</h1>
          <div style={{ color: C.mute, fontSize: 12.5, marginTop: 3 }}>
            {new Date(evento.data).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "2-digit" })} · {evento.tipo}
            {evento.status !== "aberto" && <span style={{ color: C.amarelo }}> · 🔒 {evento.status}</span>}
            {evento.resultado && <span style={{ color: evento.resultado === "vitoria" ? C.verde : C.vermelho }}> · {evento.resultado}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          {salvando && <span style={{ color: C.mute, fontSize: 12 }}>salvando…</span>}
          {canEdit && nEscalados > 0 && <button onClick={limpar} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.vermelho, padding: "5px 11px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>↺ Limpar</button>}
          <Link className="navlink" href="/hub">← Hub</Link>
          <Link className="navlink" href={`/eventos/${evento.uuid}`}>Resultado</Link>
        </div>
      </div>

      {erro && <div style={{ color: C.vermelho, fontSize: 13, marginBottom: 8 }}>⚠ {erro}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {([["escalacao", "🧩 Escalação"], ["presenca", "✅ Presença"], ["stats", "📊 Estatísticas"]] as const).map(([k, t]) => (
          <button key={k} onClick={() => setAba(k)} style={{ cursor: "pointer", borderRadius: 8, border: `1px solid ${aba === k ? C.verde : C.border2}`, background: aba === k ? C.verdeTint : "transparent", color: aba === k ? C.verde : C.mute, padding: "6px 13px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" }}>{t}</button>
        ))}
      </div>

      {aba === "escalacao" && (
        <>
          <div style={{ color: C.mute, fontSize: 12, marginBottom: 12 }}>
            <b style={{ color: C.verde }}>{nEscalados}</b> escalados de <b>{todos.size}</b> que marcaram ·
            <span style={{ color: C.amarelo }}> ✦ relíquia</span> · <span style={{ color: C.verde }}>borda verde</span> = confirmou in-game ·
            <span style={{ color: C.laranja }}> ⚠ N</span> = guerras seguidas sem jogar
            {canEdit ? " · arraste da função pra uma party" : " · (só staff edita)"}
          </div>
          {!parties.length ? (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 20, color: C.amarelo, fontSize: 13 }}>
              Nenhuma party in-game cadastrada — crie em <Link href="/hub/config" style={{ color: C.verde }}>Definições</Link> pra poder escalar.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(250px, 330px) 1fr", gap: 14, alignItems: "start" }}>
              {/* pool por FUNÇÃO */}
              <div {...alvo("pool")} style={{ border: `1px dashed ${C.border2}`, borderRadius: 12, background: C.surface, padding: 12, ...realce("pool") }}>
                <div style={{ color: C.amarelo, fontWeight: 700, fontSize: 13, marginBottom: 9 }}>Marcaram, por função</div>
                {grupos.map((g) => {
                  const livres = g.jogadores.filter((j) => partyDe(j) == null);
                  return (
                    <div key={g.funcaoId ?? "sem"} style={{ marginBottom: 11 }}>
                      <div style={{ color: C.verde, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                        <Icone raw={g.emoji} nome={g.nome} /> {g.nome} <span style={{ color: C.mute, fontWeight: 400 }}>{livres.length}</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {livres.map((j) => <Card key={j.chave} j={j} />)}
                        {!livres.length && <span style={{ color: C.borderSoft, fontSize: 11.5 }}>— todos escalados —</span>}
                      </div>
                    </div>
                  );
                })}
                {!grupos.length && <span style={{ color: C.borderSoft, fontSize: 12 }}>Ninguém marcou ainda.</span>}
              </div>

              {/* colunas = PARTIES IN-GAME */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
                {parties.map((p) => {
                  const dentro = naParty(p.id);
                  const gss = dentro.map((j) => j.gs).filter((x): x is number => x != null);
                  const media = gss.length ? Math.round(gss.reduce((a, b) => a + b, 0) / gss.length) : null;
                  return (
                    <div key={p.id} {...alvo(p.id)} style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surfaceSolid, padding: 12, minHeight: 92, ...realce(p.id) }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 6 }}>
                        <span style={{ color: C.verde, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}><Icone raw={p.icone} nome={p.nome} /> {p.nome}</span>
                        <span style={{ color: C.mute, fontSize: 11 }}>{dentro.length}{media != null ? ` · GS ${media}` : ""}</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {dentro.map((j) => <Card key={j.chave} j={j} />)}
                        {!dentro.length && <span style={{ color: C.borderSoft, fontSize: 12 }}>arraste alguém aqui</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {aba === "presenca" && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: 14 }}>
          <div style={{ color: C.mute, fontSize: 12, marginBottom: 12 }}>
            Confirmação in-game deste evento — o passo &quot;vai jogar&quot;. A presença <b>oficial</b> só existe quando as
            estatísticas da war entram. Clique no ◻/✅ pra corrigir na mão.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 6 }}>
            {[...todos.values()].sort((a, b) => a.familia.localeCompare(b.familia)).map((j) => <Card key={j.chave} j={j} />)}
            {!todos.size && <span style={{ color: C.borderSoft, fontSize: 12.5 }}>Ninguém marcou nesta chamada.</span>}
          </div>
        </div>
      )}

      {aba === "stats" && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: 14 }}>
          {!evento.temWar && (
            <div style={{ color: C.amarelo, fontSize: 12.5, marginBottom: 12 }}>
              ⚠ Sem estatística da war ainda. Grave o resultado em <Link href={`/eventos/${evento.uuid}`} style={{ color: C.verde }}>Resultado</Link> pra
              fechar o funil deste evento — sem isso não dá pra dizer quem realmente jogou.
            </div>
          )}
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
                <Th>Jogador</Th><Th>Escalado</Th><Th>In-game</Th><Th>Jogou</Th><Th>Seq. faltas</Th>
              </tr>
            </thead>
            <tbody>
              {[...todos.values()].sort((a, b) => a.familia.localeCompare(b.familia)).map((j) => {
                const p = partyDe(j);
                return (
                  <tr key={j.chave} style={{ borderTop: `1px solid ${C.borderSoft}` }}>
                    <Td>{j.reliquia && <span style={{ color: C.amarelo }}>✦ </span>}<span style={{ color: C.texto }}>{j.familia}</span></Td>
                    <Td>{p != null ? <span style={{ color: C.verde }}>{parties.find((x) => x.id === p)?.nome ?? "sim"}</span> : "—"}</Td>
                    <Td>{j.confirmouIngame ? <span style={{ color: C.verde }}>✅</span> : "—"}</Td>
                    <Td>{j.jogou == null ? <span style={{ color: C.borderSoft }}>?</span> : j.jogou ? <span style={{ color: C.verde }}>sim</span> : <span style={{ color: C.vermelho }}>não</span>}</Td>
                    <Td>{j.faltas == null ? <span style={{ color: C.borderSoft }}>—</span> : <span style={{ color: j.faltas >= 3 ? C.vermelho : j.faltas > 0 ? C.laranja : C.mute }}>{j.faltas}</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Casca>
  );
}

function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>{children}</div>
    </div>
  );
}
const Th = ({ children }: { children: React.ReactNode }) => <th style={{ textAlign: "left", padding: "7px 11px", fontWeight: 600 }}>{children}</th>;
const Td = ({ children }: { children: React.ReactNode }) => <td style={{ padding: "6px 11px", color: C.mute }}>{children}</td>;

function Icone({ raw, nome }: { raw: string | null; nome: string }) {
  const m = (raw ?? "").match(/^<a?:\w+:(\d+)>$/);
  if (m) return <img src={`https://cdn.discordapp.com/emojis/${m[1]}.png`} alt="" width={14} height={14} style={{ verticalAlign: "-2px", borderRadius: 3 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />;
  if (raw) return <span style={{ fontSize: 13 }}>{raw}</span>;
  return <span style={{ fontSize: 10, color: "#8f8f8f" }}>{nome.slice(0, 2).toUpperCase()}</span>;
}
