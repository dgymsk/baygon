"use client";

import { C } from "@/lib/theme";
import type { SituacaoNN, StatusResp, MembroSit } from "@/lib/participacaoSituacao";
import type { EmojiGuild } from "@/lib/discordApi";

/**
 * Render do ROSTER (PTs + listas). Recebe a MESMA SituacaoNN do cálculo ao vivo (montarSituacao) —
 * usado na aba Situação (ao vivo) e na página de detalhe do evento (snapshot congelado). Emojis são
 * opcionais: os PTs guardam a string '<:nome:id>', então o ícone resolve mesmo com emojis=[].
 */
const imgErr = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = "none"; };
function idEmoji(raw: string, emojis: EmojiGuild[]): string | null {
  const m = raw.match(/^<a?:\w+:(\d+)>$/); if (m) return m[1];
  const sc = raw.match(/^:?([\w~]+):?$/); if (sc) { const e = emojis.find((x) => x.name.toLowerCase() === sc[1].toLowerCase()); if (e) return e.id; }
  return null;
}
function GEmoji({ emoji, emojis, size = 15 }: { emoji: string; emojis: EmojiGuild[]; size?: number }) {
  if (!emoji) return null;
  const id = idEmoji(emoji, emojis);
  if (id) return <img src={`https://cdn.discordapp.com/emojis/${id}.png`} width={size} height={size} alt="" onError={imgErr} style={{ verticalAlign: "-2px" }} />;
  if (!/^:?[\w~]+:?$/.test(emoji)) return <span style={{ fontSize: size }}>{emoji}</span>; // unicode/texto → mostra
  return null; // ':nome:' que não resolveu → esconde (não vaza cru)
}
function NomePerfil({ nome, userId, bold }: { nome: string; userId: string | null; bold?: boolean }) {
  const st = { color: bold ? C.texto : C.mute, fontWeight: bold ? 700 : 400 } as const;
  if (!userId) return <span style={st}>{nome}</span>;
  return <a href={`https://discord.com/users/${userId}`} target="_blank" rel="noreferrer" style={{ ...st, color: C.texto, textDecoration: "none" }}>{nome}</a>;
}
const statusIcon = (s: StatusResp) => (s === "can" ? "✅" : s === "espera" ? "⏳" : s === "cant" ? "❌" : "⬜");
const TAG = (g?: string | null) => (g === "RESO" ? "RES" : g === "MANI" ? "MAN" : null); // tag da guilda (null = desconhecida → não rotula)
const ROXO = "#a6a6a6"; // classe → cinza aço (paleta couro/sangue/aço)
// linha do roster: [TAG] nick  GS  [Classe] (monospace p/ alinhar os números)
function Linha({ icon, m }: { icon: string; m: MembroSit }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontFamily: "'Share Tech Mono', monospace" }}>
      <span>{icon}</span>
      {TAG(m.guilda) && <span style={{ color: C.mute }}>[{TAG(m.guilda)}]</span>}
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><NomePerfil nome={m.familia} userId={m.userId} bold /></span>
      <b style={{ color: m.gs != null ? C.verde : C.borderSoft }}>{m.gs ?? "—"}</b>
      {m.classe && <span style={{ color: ROXO }}>[{m.classe}]</span>}
    </span>
  );
}

export default function RosterView({ sit, emojis = [] }: { sit: SituacaoNN; emojis?: EmojiGuild[] }) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 8 }}>
        {sit.pts.map((g) => (
          <div key={g.id} style={{ border: `1px solid ${C.border2}`, borderLeft: `3px solid ${g.cor || C.border2}`, borderRadius: 10, background: C.surfaceSolid, padding: "8px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, paddingBottom: 5, borderBottom: `1px solid ${C.borderSoft}` }}>
              <GEmoji emoji={g.emoji} emojis={emojis} size={16} /><b style={{ color: C.verde, fontSize: 13, flex: 1 }}>{g.nome}</b>
              <span style={{ color: g.limite != null && g.confirmados.length >= g.limite ? C.amarelo : C.mute, fontSize: 12, fontWeight: 700 }}>{g.confirmados.length}{g.limite != null ? `/${g.limite}` : ""}</span>
              {g.gsMedia != null && <span style={{ color: C.mute, fontSize: 11.5, whiteSpace: "nowrap" }}>· GS <b style={{ color: C.texto }}>{g.gsMedia}</b></span>}
            </div>
            {g.confirmados.length === 0 && g.espera.length === 0 ? <span style={{ color: C.borderSoft, fontSize: 12 }}>ninguém confirmou</span> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {g.confirmados.map((m, i) => <Linha key={"c" + i} icon="✅" m={m} />)}
                {g.espera.length > 0 && <span style={{ color: C.amarelo, fontSize: 11, fontWeight: 700, marginTop: 3 }}>⏳ Espera</span>}
                {g.espera.map((m, i) => <Linha key={"e" + i} icon="⏳" m={m} />)}
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
  );
}
