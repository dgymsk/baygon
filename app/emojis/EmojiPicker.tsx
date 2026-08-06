"use client";

import { useState } from "react";
import { C } from "@/lib/theme";
import type { EmojiGuild } from "@/lib/discordApi";

/**
 * Seletor de emoji do Discord — o mesmo de /emojis, agora compartilhado.
 *
 * Existe porque digitar `:nome:` na mão só funciona se você souber o nome exato: errou uma letra e
 * o campo guarda o texto cru, que depois aparece como `<:TAMER:15263…>` na tela em vez do ícone.
 * Aqui você vê e clica.
 *
 * A lista vem de TODOS os servidores do bot (lib/discordApi.listarEmojisGuild), com os do servidor
 * ativo primeiro — um bot pode usar emoji de qualquer guild da qual participa.
 */
const imgErr = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = "none"; };

/** Renderiza o valor guardado: `<:nome:id>` vira imagem, `:nome:` casa pelo catálogo, unicode fica texto. */
export function EmojiVal({ emoji, emojis, size = 18 }: { emoji: string; emojis: EmojiGuild[]; size?: number }) {
  const raw = (emoji || "").trim();
  if (!raw) return null;
  const full = raw.match(/^<(a?):\w+:(\d+)>$/);
  const id = full ? full[2] : emojis.find((x) => x.name.toLowerCase() === raw.replace(/^:|:$/g, "").toLowerCase())?.id;
  if (id) return <img src={`https://cdn.discordapp.com/emojis/${id}.png`} width={size} height={size} alt="" onError={imgErr} style={{ verticalAlign: "-3px" }} />;
  return <span style={{ fontSize: size - 2 }}>{raw}</span>;
}

export default function EmojiPicker({ emojis, value, onPick, titulo = "escolher emoji" }: {
  emojis: EmojiGuild[]; value: string; onPick: (v: string) => void; titulo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inp = { background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "6px 9px", fontSize: 12.5, outline: "none" } as const;
  const casam = emojis.filter((e) => !q.trim() || e.name.toLowerCase().includes(q.trim().toLowerCase()));
  const filt = casam.slice(0, 120);
  const escolher = (v: string) => { onPick(v); setOpen(false); setQ(""); };

  return (
    <div style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} title={titulo}
        style={{ width: 42, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 2, borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, cursor: "pointer", color: C.mute, fontSize: 12 }}>
        {value ? <EmojiVal emoji={value} emojis={emojis} size={16} /> : "😀"} ▾
      </button>
      {open && (
        <div style={{ position: "absolute", top: 34, left: 0, zIndex: 30, width: 236, border: `1px solid ${C.border2}`, borderRadius: 10, background: C.bg0, boxShadow: "0 6px 24px rgba(0,0,0,.5)", padding: 8 }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); escolher(q.trim()); } }}
            placeholder="buscar :emoji: ou colar unicode" style={{ ...inp, width: "100%", marginBottom: 6 }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, maxHeight: 180, overflowY: "auto" }}>
            {filt.map((e) => (
              <button key={e.id} type="button" title={`:${e.name}: — ${e.guilda}`}
                onClick={() => escolher(`<${e.animated ? "a" : ""}:${e.name}:${e.id}>`)}
                style={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "1px solid transparent", background: "transparent", cursor: "pointer" }}>
                <img src={`https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "png"}`} width={20} height={20} alt={e.name} onError={imgErr} />
              </button>
            ))}
            {filt.length === 0 && <span style={{ color: C.mute, fontSize: 12, padding: 6 }}>nenhum emoji com esse nome — cole um unicode acima</span>}
          </div>
          <div style={{ color: C.mute, fontSize: 10.5, marginTop: 5 }}>
            {casam.length > filt.length ? `${filt.length} de ${casam.length} — refine a busca` : `${casam.length} emoji(s) dos servidores do bot`}
          </div>
          <button type="button" onClick={() => escolher("")}
            style={{ marginTop: 6, width: "100%", borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.mute, padding: "4px", fontSize: 12, cursor: "pointer" }}>
            sem emoji
          </button>
        </div>
      )}
    </div>
  );
}
