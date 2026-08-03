"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import type { Preset } from "@/lib/intencaoPreset";

/**
 * Disparo da chamada direto do hub — escolhe QUAL preset e lança. Postar cria o evento e já
 * o amarra ao preset, então a partir daqui o evento inteiro (escalação, presença, estatística)
 * fica pendurado nessa escolha.
 */
export default function Lancar({ presets, partiesPorPreset }: { presets: Preset[]; partiesPorPreset: Record<number, string[]> }) {
  const router = useRouter();
  const [sel, setSel] = useState<number | null>(presets[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);

  const preset = presets.find((p) => p.id === sel) ?? null;
  const pts = sel != null ? partiesPorPreset[sel] ?? [] : [];

  async function lancar() {
    if (!preset) return;
    if (!confirm(`Postar a chamada "${preset.nome}" no Discord? Isso cria um evento novo.`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "postar", id: preset.id }) });
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

const caixa = { border: `1px solid ${C.border2}`, borderRadius: 12, background: C.inputBg, padding: "10px 14px", marginBottom: 18, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } as const;
