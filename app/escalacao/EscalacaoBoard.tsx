"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { iconeUrl, type GuildEntry } from "@/lib/guild";

/**
 * Painel de escalação: o pool de quem marcou intenção à esquerda, uma coluna por PT à direita,
 * e o jogador vai de um pro outro ARRASTANDO. Drag-and-drop nativo do HTML5 — o repo não tem
 * biblioteca de DnD e este caso (uma lista, N alvos) não justifica uma.
 *
 * Cada card mostra o que a staff precisa pra decidir: classe, GS, em quais PTs a pessoa se
 * ofereceu, se já confirmou in-game (borda verde) e há quantas guerras ela marca e não joga.
 */
export type PtVM = { id: number; nome: string; emoji: string | null };
export type JogadorVM = {
  chave: string; familia: string; userId: string;
  guilda: string | null; classe: string | null; gs: number | null;
  marcou: number[];              // PTs em que se ofereceu
  escaladoEm: number | null;     // PT em que a staff o pôs (null = ainda no pool)
  confirmouIngame: boolean;
  faltas: number | null;         // null = sem histórico avaliável (nenhuma war com estatística)
};
type EvLite = { uuid: string; titulo: string; tipo: string; data: string; status: string };

export default function EscalacaoBoard({
  eventos, eventoUuid, eventoId, pts, jogadores, canEdit, guildas, travado, vazio,
}: {
  eventos: EvLite[]; eventoUuid: string | null; eventoId: number | null; pts: PtVM[];
  jogadores: JogadorVM[]; canEdit: boolean; guildas: GuildEntry[]; travado?: string | null; vazio?: string;
}) {
  const router = useRouter();
  const [local, setLocal] = useState<Record<string, number | null>>({});
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [sobre, setSobre] = useState<number | "pool" | null>(null);
  const arrastando = useRef<string | null>(null);
  const byTag = useMemo(() => new Map(guildas.map((g) => [g.id, g])), [guildas]);

  // estado efetivo = servidor + o que acabou de mudar aqui (otimista, sem esperar o refresh)
  const ptDe = (j: JogadorVM) => (j.chave in local ? local[j.chave] : j.escaladoEm);
  const pool = jogadores.filter((j) => ptDe(j) == null);
  const doPt = (id: number) => jogadores.filter((j) => ptDe(j) === id);

  async function mover(chave: string, ptId: number | null) {
    if (!canEdit || !eventoId) return;
    const j = jogadores.find((x) => x.chave === chave);
    if (!j || ptDe(j) === ptId) return;
    setLocal((s) => ({ ...s, [chave]: ptId }));
    setSalvando(true);
    try {
      const res = await fetch("/api/escalacao", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventoId, ops: [{ familia: j.familia, ptId }] }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `erro ${res.status}`);
      setErro("");
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
      setLocal((s) => { const n = { ...s }; delete n[chave]; return n; }); // desfaz o otimista
    } finally { setSalvando(false); }
  }

  async function limpar() {
    if (!canEdit || !eventoId || !confirm("Tirar todo mundo da escalação?")) return;
    setSalvando(true);
    try {
      await fetch(`/api/escalacao?eventoId=${eventoId}`, { method: "DELETE" });
      setLocal({}); router.refresh();
    } finally { setSalvando(false); }
  }

  async function togglePresenca(j: JogadorVM) {
    if (!canEdit || !eventoId) return;
    await fetch("/api/escalacao", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventoId, presenca: "manual", familia: j.familia, participar: !j.confirmouIngame }),
    });
    router.refresh();
  }

  const GuildIcon = ({ id }: { id: string | null }) => {
    const g = id ? byTag.get(id) : null;
    if (!g) return null;
    const u = iconeUrl(g.icone);
    return u ? <img src={u} alt="" width={13} height={13} style={{ borderRadius: 3 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
      : g.icone ? <span style={{ fontSize: 12 }}>{g.icone}</span> : <span style={{ fontSize: 10, color: C.mute }}>{g.tag}</span>;
  };

  const Card = ({ j }: { j: JogadorVM }) => (
    <div
      draggable={canEdit}
      onDragStart={() => { arrastando.current = j.chave; }}
      onDragEnd={() => { arrastando.current = null; setSobre(null); }}
      title={j.faltas != null && j.faltas > 0 ? `Marcou e não jogou nas ${j.faltas} últimas` : undefined}
      style={{
        border: `1px solid ${j.confirmouIngame ? C.verde : C.border2}`,
        background: j.confirmouIngame ? C.verdeTint : C.inputBg,
        borderRadius: 9, padding: "6px 9px", cursor: canEdit ? "grab" : "default",
        display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, flexWrap: "wrap",
      }}
    >
      <GuildIcon id={j.guilda} />
      <span style={{ color: C.texto, fontWeight: 600 }}>{j.familia}</span>
      {j.classe && <span style={{ color: C.mute, fontSize: 11 }}>{j.classe}</span>}
      {j.gs != null && <span style={{ color: C.amarelo, fontSize: 11 }}>{j.gs}</span>}
      {j.faltas != null && j.faltas > 0 && (
        <span style={{ color: j.faltas >= 3 ? C.vermelho : C.laranja, fontSize: 10.5, fontWeight: 700 }}>⚠ {j.faltas} sem jogar</span>
      )}
      <span style={{ marginLeft: "auto", display: "inline-flex", gap: 3, alignItems: "center" }}>
        {j.marcou.map((id) => { const p = pts.find((x) => x.id === id); return p ? <EmojiPt key={id} raw={p.emoji} nome={p.nome} /> : null; })}
        {canEdit && (
          <button onClick={() => togglePresenca(j)} title={j.confirmouIngame ? "desmarcar confirmação in-game" : "marcar como confirmado in-game"}
            style={{ background: "none", border: "none", cursor: "pointer", color: j.confirmouIngame ? C.verde : C.borderSoft, fontSize: 12, padding: "0 2px" }}>
            {j.confirmouIngame ? "✅" : "◻"}
          </button>
        )}
      </span>
    </div>
  );

  const alvo = (id: number | "pool") => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setSobre(id); },
    onDragLeave: () => setSobre((s) => (s === id ? null : s)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setSobre(null); const c = arrastando.current; arrastando.current = null; if (c) mover(c, id === "pool" ? null : id); },
  });
  const realce = (id: number | "pool") => (sobre === id ? { borderColor: C.verde, background: C.verdeTint } : {});

  const escalados = jogadores.filter((j) => ptDe(j) != null).length;

  return (
    <div style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>

      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 26, letterSpacing: 1, margin: 0, color: C.amarelo }}>
            BAYGON <span style={{ color: C.mute, fontSize: 14, letterSpacing: 2 }}>· ESCALAÇÃO</span>
          </h1>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            {eventos.length > 1 && (
              <select value={eventoUuid ?? ""} onChange={(e) => router.push(`/escalacao?ev=${e.target.value}`)}
                style={{ background: C.inputBg, color: C.texto, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "5px 9px", fontSize: 12.5, fontFamily: "inherit", cursor: "pointer" }}>
                {eventos.map((e) => <option key={e.uuid} value={e.uuid}>{e.data.slice(0, 10)} · {e.titulo}{e.status !== "aberto" ? ` (${e.status})` : ""}</option>)}
              </select>
            )}
            {salvando && <span style={{ color: C.mute, fontSize: 12 }}>salvando…</span>}
            {canEdit && escalados > 0 && <button onClick={limpar} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.vermelho, padding: "5px 11px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>↺ Limpar</button>}
            <Link className="navlink" href="/intencao">← Intenção</Link>
            <Link className="navlink" href="/painel">Painel</Link>
          </div>
        </div>

        {erro && <div style={{ color: C.vermelho, fontSize: 13, marginBottom: 8 }}>⚠ {erro}</div>}
        {vazio && <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 24, color: C.mute }}>{vazio}</div>}
        {travado && <div style={{ color: C.amarelo, fontSize: 12.5, marginBottom: 10 }}>🔒 Evento {travado} — somente leitura.</div>}

        {!vazio && (
          <>
            <div style={{ color: C.mute, fontSize: 12, marginBottom: 12 }}>
              <b style={{ color: C.verde }}>{escalados}</b> escalados de <b>{jogadores.length}</b> que marcaram ·
              borda <span style={{ color: C.verde }}>verde</span> = confirmou in-game ·
              <b style={{ color: C.laranja }}> ⚠ N sem jogar</b> = marcou nas N últimas e não teve estatística
              {canEdit ? " · arraste o jogador pra uma PT" : " · (só staff edita)"}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 320px) 1fr", gap: 14, alignItems: "start" }}>
              {/* pool */}
              <div {...alvo("pool")} style={{ border: `1px dashed ${C.border2}`, borderRadius: 12, background: C.surface, padding: 12, ...realce("pool") }}>
                <div style={{ color: C.amarelo, fontWeight: 700, fontSize: 13, marginBottom: 9 }}>Marcaram — {pool.length}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {pool.map((j) => <Card key={j.chave} j={j} />)}
                  {!pool.length && <span style={{ color: C.borderSoft, fontSize: 12 }}>— todo mundo escalado —</span>}
                </div>
              </div>

              {/* colunas por PT */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                {pts.map((p) => {
                  const dentro = doPt(p.id);
                  const gss = dentro.map((j) => j.gs).filter((x): x is number => x != null);
                  const media = gss.length ? Math.round(gss.reduce((a, b) => a + b, 0) / gss.length) : null;
                  return (
                    <div key={p.id} {...alvo(p.id)} style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surfaceSolid, padding: 12, minHeight: 96, ...realce(p.id) }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 6 }}>
                        <span style={{ color: C.verde, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}>
                          <EmojiPt raw={p.emoji} nome={p.nome} /> {p.nome}
                        </span>
                        <span style={{ color: C.mute, fontSize: 11 }}>{dentro.length}{media != null ? ` · GS ${media}` : ""}</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {dentro.map((j) => <Card key={j.chave} j={j} />)}
                        {!dentro.length && <span style={{ color: C.borderSoft, fontSize: 12 }}>arraste alguém aqui</span>}
                      </div>
                    </div>
                  );
                })}
                {!pts.length && <span style={{ color: C.mute, fontSize: 12.5 }}>O preset desta chamada não tem PTs.</span>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** "<:nome:id>" → imagem do CDN; unicode → o caractere; sem emoji → iniciais do nome. */
function EmojiPt({ raw, nome }: { raw: string | null; nome: string }) {
  const m = (raw ?? "").match(/^<a?:\w+:(\d+)>$/);
  if (m) return <img src={`https://cdn.discordapp.com/emojis/${m[1]}.png`} alt="" width={14} height={14} style={{ verticalAlign: "-2px", borderRadius: 3 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />;
  if (raw) return <span style={{ fontSize: 13 }}>{raw}</span>;
  return <span style={{ fontSize: 10, color: "#8f8f8f" }}>{nome.slice(0, 2).toUpperCase()}</span>;
}
