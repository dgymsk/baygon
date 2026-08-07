"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { corTier } from "@/lib/tier";
import { hojeBR } from "@/lib/datas";
import type { Preset } from "@/lib/intencaoPreset";

/**
 * Disparo da chamada direto do hub — escolhe QUAL preset e lança. Postar cria o evento e já
 * o amarra ao preset, então a partir daqui o evento inteiro (escalação, presença, estatística)
 * fica pendurado nessa escolha.
 */
export default function Lancar({ presets, partiesPorPreset }: { presets: Preset[]; partiesPorPreset: Record<number, string[]> }) {
  const router = useRouter();
  const [sel, setSel] = useState<number | null>(presets[0]?.id ?? null);
  // o nome já vem sugerido com a data de hoje, que é como a staff nomeia ("2026-08-07") e o mesmo
  // que a chamada agendada usa. Dá pra trocar aqui, e depois renomear o evento na página dele.
  const [nome, setNome] = useState(() => hojeBR());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);

  const preset = presets.find((p) => p.id === sel) ?? null;
  const pts = sel != null ? partiesPorPreset[sel] ?? [] : [];

  async function lancar() {
    if (!preset) return;
    if (!confirm(`Postar "${preset.nome}" no Discord como evento "${nome.trim() || preset.nome}"?`)) return;
    setBusy(true);
    try {
      // NÃO manda data: quem data o evento é o servidor, no fuso de São Paulo. O relógio do
      // navegador decidindo o dia da guerra seria bug silencioso perto da meia-noite.
      const res = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "postar", id: preset.id, titulo: nome.trim() || null }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || (d as { error?: string }).error) throw new Error((d as { error?: string }).error ?? `erro ${res.status}`);
      setMsg({ k: "ok", t: "chamada postada" });
      const uuid = (d as { eventoUuid?: string }).eventoUuid;
      if (uuid) router.push(`/hub/${uuid}`); else router.refresh();
    } catch (e) { setMsg({ k: "err", t: (e as Error).message }); }
    finally { setBusy(false); }
  }

  if (!presets.length) {
    return (
      <div style={caixa}>
        <span style={{ color: C.amarelo, fontSize: 12.5 }}>
          Nenhuma chamada configurada — crie uma em Definições pra poder lançar.
        </span>
      </div>
    );
  }

  return (
    <div style={caixa}>
      <span style={{ color: C.verde, fontWeight: 700, fontSize: 13 }}>Lançar chamada</span>
      <select value={sel ?? ""} onChange={(e) => setSel(Number(e.target.value))}
        style={{ background: C.inputBg, color: C.texto, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "5px 9px", fontSize: 12.5, fontFamily: "inherit", cursor: "pointer" }}>
        {presets.map((p) => <option key={p.id} value={p.id}>{p.nome} · {p.tipo}</option>)}
      </select>
      {preset?.tier && <span style={{ color: corTier[preset.tier], fontSize: 11, fontWeight: 700, border: `1px solid ${corTier[preset.tier]}`, borderRadius: 999, padding: "1px 8px" }}>{preset.tier}</span>}
      <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder={preset?.nome ?? "nome do evento"}
        title="nome deste evento — vazio usa o nome da chamada; dá pra renomear depois na página do evento"
        style={{ background: C.inputBg, color: C.texto, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "5px 9px", fontSize: 12.5, fontFamily: "inherit", width: 130, outline: "none" }} />
      <span style={{ color: C.mute, fontSize: 11.5 }}>
        {pts.length
          ? <>{pts.join(" · ")}{preset?.tamanho_max ? <span style={{ color: C.amarelo }}> · máx {preset.tamanho_max}</span> : null}</>
          : <span style={{ color: C.amarelo }}>sem PTs — configure antes</span>}
      </span>
      <button onClick={lancar} disabled={busy || !pts.length}
        style={{ marginLeft: "auto", borderRadius: 8, border: `1px solid ${C.border2}`, background: C.verdeTint, color: C.verde, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: pts.length ? "pointer" : "not-allowed", opacity: pts.length ? 1 : 0.5 }}>
        {busy ? "postando…" : "📢 Postar no Discord"}
      </button>
      {msg && <span style={{ color: msg.k === "ok" ? C.verde : C.vermelho, fontSize: 12 }}>{msg.k === "ok" ? "✓" : "⚠"} {msg.t}</span>}
    </div>
  );
}

// a margem de baixo mora no wrapper da faixa de ação, que alinha esta caixa com a de "novo evento"
const caixa = { border: `1px solid ${C.border2}`, borderRadius: 12, background: C.inputBg, padding: "10px 14px", height: "100%", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } as const;
