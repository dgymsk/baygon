"use client";

import Link from "next/link";
import { useState } from "react";
import { C } from "@/lib/theme";
import EmojiPicker from "./EmojiPicker";
import type { EmojiGuild } from "@/lib/discordApi";
import type { EmojiMap } from "@/lib/emojiConfig";

const imgErr = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = "none"; };
function idEmoji(raw: string, emojis: EmojiGuild[]): string | null {
  const m = raw.match(/^<a?:\w+:(\d+)>$/); if (m) return m[1];
  const sc = raw.match(/^:?([\w~]+):?$/); if (sc) { const e = emojis.find((x) => x.name.toLowerCase() === sc[1].toLowerCase()); if (e) return e.id; }
  return null;
}
function GEmoji({ emoji, emojis, size = 18 }: { emoji: string; emojis: EmojiGuild[]; size?: number }) {
  if (!emoji) return null;
  const id = idEmoji(emoji, emojis);
  if (id) return <img src={`https://cdn.discordapp.com/emojis/${id}.png`} width={size} height={size} alt="" onError={imgErr} style={{ verticalAlign: "-3px" }} />;
  if (!/^:?[\w~]+:?$/.test(emoji)) return <span style={{ fontSize: size }}>{emoji}</span>;
  return null;
}

// picker de emoji do servidor (mesma ideia da do buzinador)
export default function EmojiConfigForm({ initial, emojis, classes, guildas, canEdit }: { initial: EmojiMap; emojis: EmojiGuild[]; classes: string[]; guildas: { id: string; tag: string; nome: string }[]; canEdit: boolean }) {
  const [map, setMap] = useState<EmojiMap>({ classes: { ...initial.classes }, guildas: { ...initial.guildas } });
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "err"; msg?: string }>({ kind: "idle" });
  const ro = !canEdit;

  const setC = (nome: string, v: string) => setMap((m) => ({ ...m, classes: { ...m.classes, [nome]: v } }));
  const setG = (k: string, v: string) => setMap((m) => ({ ...m, guildas: { ...m.guildas, [k]: v } }));

  async function salvar() {
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/emoji-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(map) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "falha");
      setStatus({ kind: "ok", msg: "Emojis salvos. Vale no próximo disparo/atualização do bot." });
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }

  const card = { border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 16 } as const;
  const Row = ({ label, value, onPick }: { label: string; value: string; onPick: (v: string) => void }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
      {!ro && <EmojiPicker emojis={emojis} value={value} onPick={onPick} />}
      {ro && <span style={{ width: 28, textAlign: "center" }}><GEmoji emoji={value} emojis={emojis} size={18} /></span>}
      <span style={{ color: C.texto, fontSize: 13.5 }}>{label}</span>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
          <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 26, letterSpacing: 1, margin: 0, color: C.amarelo }}>
            BAYGON <span style={{ color: C.mute, fontSize: 14, letterSpacing: 2 }}>· EMOJIS</span>
          </h1>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Link className="navlink" href="/participacao">← Participação</Link>
            <Link className="navlink" href="/membros">Membros</Link>
            {ro && <span style={{ color: C.amarelo, fontSize: 12, border: `1px solid ${C.border2}`, borderRadius: 999, padding: "3px 10px" }}>🔒 somente leitura</span>}
            {status.kind === "ok" && <span style={{ color: C.verde, fontSize: 13 }}>✓ salvo</span>}
            {status.kind === "err" && <span style={{ color: C.vermelho, fontSize: 13 }}>⚠ {status.msg}</span>}
            {canEdit && <button onClick={salvar} disabled={status.kind === "saving"} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.verdeTint, color: C.verde, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{status.kind === "saving" ? "Salvando…" : "Salvar"}</button>}
          </div>
        </div>
        <p style={{ color: C.mute, fontSize: 12.5, margin: "0 0 16px" }}>
          Emoji de cada <b style={{ color: C.verde }}>guilda</b> e <b style={{ color: C.verde }}>classe</b> pro embed do bot (roster de participação). Onde faltar, o bot mostra o texto (MAN/RES e a classe entre parênteses). Os emojis vêm do servidor do Discord ativo.
        </p>

        <div style={{ ...card, marginBottom: 14 }}>
          <div style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6 }}>Guildas</div>
          {guildas.map((g) => <Row key={g.id} label={`${g.nome} (${g.tag})`} value={map.guildas[g.id] ?? ""} onPick={(v) => setG(g.id, v)} />)}
        </div>

        <div style={card}>
          <div style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6 }}>Classes ({classes.length})</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "0 18px" }}>
            {classes.map((c) => <Row key={c} label={c} value={map.classes[c] ?? ""} onPick={(v) => setC(c, v)} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
