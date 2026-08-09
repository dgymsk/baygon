"use client";

import Link from "next/link";
import { useState } from "react";
import { C } from "@/lib/theme";
import { iconeUrl, type GuildMeta, type GuildEntry } from "@/lib/guild";

const imgErr = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = "none"; };

function Icone({ icone, size = 26, radius = 6 }: { icone: string; size?: number; radius?: number }) {
  const url = iconeUrl(icone);
  if (url) return <img src={url} width={size} height={size} alt="" onError={imgErr} style={{ borderRadius: radius, objectFit: "cover" }} />;
  if (icone.trim()) return <span style={{ fontSize: size - 4 }}>{icone.trim()}</span>;
  return <span style={{ width: size, height: size, display: "inline-block", borderRadius: radius, background: C.inputBg, border: `1px dashed ${C.border2}` }} />;
}

type Discord = { nome: string; icone: string; banner: string } | null;

export default function GuildConfigForm({ initial, discord, canEdit }: { initial: GuildMeta; discord: Discord; canEdit: boolean }) {
  const [meta, setMeta] = useState<GuildMeta>({ alliance: { ...initial.alliance }, guildas: initial.guildas.map((g) => ({ ...g })) });
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "err"; msg?: string }>({ kind: "idle" });
  const ro = !canEdit;

  const setA = (k: keyof GuildMeta["alliance"], v: string) => setMeta((m) => ({ ...m, alliance: { ...m.alliance, [k]: v } }));
  const setG = (i: number, k: keyof GuildEntry, v: string) => setMeta((m) => ({ ...m, guildas: m.guildas.map((g, j) => (j === i ? { ...g, [k]: v } : g)) }));
  const addG = () => setMeta((m) => ({ ...m, guildas: [...m.guildas, { id: "", tag: "", nome: "", icone: "", cor: "#a6a6a6" }] }));
  const delG = (i: number) => setMeta((m) => ({ ...m, guildas: m.guildas.filter((_, j) => j !== i) }));
  const puxar = () => discord && setMeta((m) => ({ ...m, alliance: { ...m.alliance, nome: discord.nome || m.alliance.nome, icone: discord.icone || m.alliance.icone, banner: discord.banner || m.alliance.banner } }));

  async function salvar() {
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/guild-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "falha");
      const saved = (await res.json()) as GuildMeta;
      setMeta({ alliance: { ...saved.alliance }, guildas: saved.guildas.map((g) => ({ ...g })) });
      setStatus({ kind: "ok", msg: "Identidade salva." });
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }

  const card = { border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 16 } as const;
  const inp = { background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "7px 9px", fontSize: 13, outline: "none", fontFamily: "inherit" } as const;
  const swatch = { width: 34, height: 30, padding: 0, border: `1px solid ${C.border2}`, borderRadius: 6, background: C.inputBg, cursor: ro ? "default" : "pointer" } as const;
  const lbl = { color: C.mute, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 } as const;

  return (
    <div className="pg" style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}
        input:focus{border-color:${C.verde}}`}</style>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
          <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 26, letterSpacing: 1, margin: 0, color: C.verde }}>
            BAYGON <span style={{ color: C.mute, fontSize: 14, letterSpacing: 2 }}>· GUILDAS</span>
          </h1>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Link className="navlink" href="/discord">← Discord</Link>
            <Link className="navlink" href="/emojis">Emojis</Link>
            {ro && <span style={{ color: C.amarelo, fontSize: 12, border: `1px solid ${C.border2}`, borderRadius: 999, padding: "3px 10px" }}>🔒 somente leitura</span>}
            {status.kind === "ok" && <span style={{ color: C.verde, fontSize: 13 }}>✓ {status.msg}</span>}
            {status.kind === "err" && <span style={{ color: C.vermelho, fontSize: 13 }}>⚠ {status.msg}</span>}
            {canEdit && <button onClick={salvar} disabled={status.kind === "saving"} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.verdeTint, color: C.verde, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{status.kind === "saving" ? "Salvando…" : "Salvar"}</button>}
          </div>
        </div>
        <p style={{ color: C.mute, fontSize: 12.5, margin: "0 0 16px" }}>
          Identidade da <b style={{ color: C.verde }}>aliança</b> e das <b style={{ color: C.verde }}>guildas</b> participantes. A marca da aliança substitui o BAYGON no topo/login. Ícone/banner podem ser <b style={{ color: C.texto }}>puxados do Discord</b>. Cada guilda tem uma <b style={{ color: C.texto }}>tag</b> (a letra que o Apollo põe no apelido, ex. <code>[M]</code>).
        </p>

        {/* ALIANÇA */}
        <div style={{ ...card, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2 }}>Aliança (marca do app)</div>
            {canEdit && <button onClick={puxar} disabled={!discord} title={discord ? "preencher com o ícone/banner/nome do servidor do Discord" : "bot/servidor não configurado no /discord"} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: discord ? C.verde : C.mute, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: discord ? "pointer" : "not-allowed" }}>⤓ Puxar do Discord</button>}
          </div>
          {meta.alliance.banner && <img src={meta.alliance.banner} alt="" onError={imgErr} style={{ width: "100%", maxHeight: 130, objectFit: "cover", borderRadius: 10, marginBottom: 12, border: `1px solid ${C.border}` }} />}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
            <div><Icone icone={meta.alliance.icone} size={48} radius={12} /></div>
            <div style={{ flex: "1 1 160px" }}><label style={lbl}>Nome</label><input value={meta.alliance.nome} disabled={ro} onChange={(e) => setA("nome", e.target.value)} style={{ ...inp, width: "100%" }} /></div>
            <div><label style={lbl}>Cor</label><input type="color" value={meta.alliance.cor || "#cc0000"} disabled={ro} onChange={(e) => setA("cor", e.target.value)} style={swatch} /></div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
            <div style={{ flex: "1 1 260px" }}><label style={lbl}>Ícone (URL, /caminho ou :emoji:)</label><input value={meta.alliance.icone} disabled={ro} onChange={(e) => setA("icone", e.target.value)} placeholder="https://… ou <:tag:123>" style={{ ...inp, width: "100%" }} /></div>
            <div style={{ flex: "1 1 260px" }}><label style={lbl}>Banner (URL)</label><input value={meta.alliance.banner} disabled={ro} onChange={(e) => setA("banner", e.target.value)} placeholder="https://…" style={{ ...inp, width: "100%" }} /></div>
          </div>
        </div>

        {/* GUILDAS */}
        <div style={card}>
          <div style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>Guildas participantes ({meta.guildas.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {meta.guildas.map((g, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap", padding: "8px 0", borderTop: i ? `1px solid ${C.borderSoft}` : "none" }}>
                <div style={{ paddingBottom: 4 }}><Icone icone={g.icone} size={30} /></div>
                <div style={{ width: 92 }}><label style={lbl}>Chave</label><input value={g.id} disabled={ro} onChange={(e) => setG(i, "id", e.target.value)} title="chave estável (vai pro banco: players.guilda)" style={{ ...inp, width: "100%", textTransform: "uppercase" }} /></div>
                <div style={{ width: 56 }}><label style={lbl}>Tag</label><input value={g.tag} disabled={ro} onChange={(e) => setG(i, "tag", e.target.value)} title="letra que o Apollo marca no apelido, ex [M]" style={{ ...inp, width: "100%", textTransform: "uppercase" }} /></div>
                <div style={{ flex: "1 1 140px" }}><label style={lbl}>Nome</label><input value={g.nome} disabled={ro} onChange={(e) => setG(i, "nome", e.target.value)} style={{ ...inp, width: "100%" }} /></div>
                <div style={{ flex: "1 1 180px" }}><label style={lbl}>Ícone</label><input value={g.icone} disabled={ro} onChange={(e) => setG(i, "icone", e.target.value)} placeholder="URL / :emoji:" style={{ ...inp, width: "100%" }} /></div>
                <div><label style={lbl}>Cor</label><input type="color" value={g.cor || "#a6a6a6"} disabled={ro} onChange={(e) => setG(i, "cor", e.target.value)} style={swatch} /></div>
                {canEdit && <button onClick={() => delG(i)} title="remover guilda" style={{ height: 30, width: 34, borderRadius: 6, border: `1px solid ${C.border2}`, background: "transparent", color: C.vermelho, cursor: "pointer", fontSize: 14 }}>🗑</button>}
              </div>
            ))}
          </div>
          {canEdit && <button onClick={addG} style={{ marginTop: 12, borderRadius: 8, border: `1px dashed ${C.border2}`, background: "transparent", color: C.mute, padding: "7px 14px", fontSize: 13, cursor: "pointer" }}>+ Adicionar guilda</button>}
          <p style={{ color: C.mute, fontSize: 11.5, marginTop: 12, lineHeight: 1.5 }}>
            A <b style={{ color: C.texto }}>chave</b> é o identificador gravado no banco (não mude a de guildas já existentes sem migrar os dados). A <b style={{ color: C.texto }}>tag</b> precisa bater com o que o bot Apollo escreve nos apelidos pra as pessoas dessa guilda aparecerem nos confirmados.
          </p>
        </div>
      </div>
    </div>
  );
}
