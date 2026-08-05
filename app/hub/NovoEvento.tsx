"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { TIERS, corTier, type Tier } from "@/lib/tier";
import type { Preset } from "@/lib/intencaoPreset";

/**
 * Evento criado à mão, sem passar pelo Discord — war combinada por fora, treino, siege marcada na
 * hora. Nasce ABERTO (ao contrário do retroativo de /eventos, que nasce finalizado só pra pendurar
 * o resultado de uma war passada), porque aqui o objetivo é escalar e confirmar presença.
 *
 * A chamada é obrigatória e não é burocracia: são as PTs dela que viram as colunas da escalação.
 * Sem ela o evento abriria sem coluna nenhuma. O tipo vem do preset em vez de virar um campo —
 * pedir os dois deixaria criar uma siege regida por um preset de nodewar.
 */
export default function NovoEvento({ presets, partiesPorPreset }: { presets: Preset[]; partiesPorPreset: Record<number, string[]> }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  // tier em branco = herda o da chamada; explícito = essa guerra caiu noutro nó
  const [f, setF] = useState<{ presetId: string; data: string; titulo: string; tier: string }>({ presetId: String(presets.find((p) => (partiesPorPreset[p.id] ?? []).length > 0)?.id ?? ""), data: "", titulo: "", tier: "" });

  // chamada sem PT não serve: as PTs dela é que viram as colunas da escalação
  const usaveis = presets.filter((p) => (partiesPorPreset[p.id] ?? []).length > 0);
  const preset = usaveis.find((p) => String(p.id) === f.presetId) ?? null;
  const pts = preset ? partiesPorPreset[preset.id] ?? [] : [];
  // tier em branco no formulário = herda o da chamada
  const tierEfetivo = (f.tier || preset?.tier || null) as Tier | null;

  async function criar() {
    if (!preset || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/hub", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "evento-criar", presetId: preset.id, data: f.data || undefined, titulo: f.titulo, tier: f.tier || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || (d as { error?: string }).error) throw new Error((d as { error?: string }).error ?? `erro ${res.status}`);
      router.push(`/hub/${(d as { uuid: string }).uuid}`);
    } catch (e) { setErro((e as Error).message); setBusy(false); }
  }

  if (!aberto) {
    return (
      <button onClick={() => setAberto(true)} title="cria um evento sem postar nada no Discord"
        style={{ ...caixa, cursor: "pointer", color: C.amarelo, fontWeight: 700, fontSize: 12.5, fontFamily: "inherit" }}>
        ＋ Novo evento
      </button>
    );
  }

  return (
    <div style={{ ...caixa, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ color: C.amarelo, fontWeight: 700, fontSize: 13 }}>Novo evento <span style={{ color: C.mute, fontWeight: 400, fontSize: 11.5 }}>— sem chamada no Discord</span></span>
        <button onClick={() => { setAberto(false); setErro(""); }} style={{ background: "none", border: "none", color: C.mute, cursor: "pointer", fontSize: 12 }}>× cancelar</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Campo rot="Chamada (define as PTs)">
          <select value={f.presetId} onChange={(e) => setF({ ...f, presetId: e.target.value })} style={{ ...input, cursor: "pointer" }}>
            {!usaveis.length && <option value="">nenhuma chamada com PT configurada</option>}
            {usaveis.map((p) => <option key={p.id} value={p.id}>{p.nome} · {p.tipo}</option>)}
          </select>
        </Campo>
        <Campo rot="Tier">
          <select value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })}
            style={{ ...input, width: 110, cursor: "pointer", color: tierEfetivo ? corTier[tierEfetivo] : C.mute }}>
            <option value="">{preset?.tier ? `da chamada (${preset.tier})` : "—"}</option>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Campo>
        <Campo rot="Data (vazio = hoje)">
          <input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} style={{ ...input, width: 145 }} />
        </Campo>
        <Campo rot="Título (opcional)">
          <input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder={preset?.nome ?? "ex: NW Sáb — Nó 40"} style={{ ...input, width: 200 }} />
        </Campo>
        <button onClick={criar} disabled={busy || !preset}
          style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.verdeTint, color: C.verde, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: preset ? "pointer" : "not-allowed", opacity: preset ? 1 : 0.5 }}>
          {busy ? "criando…" : "Criar e abrir"}
        </button>
      </div>
      {pts.length > 0 && <span style={{ color: C.mute, fontSize: 11.5 }}>PTs: {pts.join(" · ")}{preset?.tamanho_max ? <span style={{ color: C.amarelo }}> · máx {preset.tamanho_max}</span> : null}</span>}
      {erro && <span style={{ color: C.vermelho, fontSize: 12 }}>⚠ {erro}</span>}
      {!usaveis.length && <span style={{ color: C.amarelo, fontSize: 11.5 }}>Nenhuma chamada tem PT associada — configure em Definições, é de lá que saem as colunas da escalação.</span>}
    </div>
  );
}

const Campo = ({ rot, children }: { rot: string; children: React.ReactNode }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
    <span style={{ color: C.mute, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.8 }}>{rot}</span>
    {children}
  </label>
);

const caixa = { border: `1px solid ${C.border2}`, borderRadius: 12, background: C.inputBg, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } as const;
const input = { background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "6px 9px", fontSize: 12.5, fontFamily: "inherit", outline: "none" } as const;
