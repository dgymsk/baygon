"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";

const LABELS: Record<string, string> = { derrota: "Derrota", participacao: "Participação", vitoria: "Vitória" };
const CORES: Record<string, string> = { derrota: C.vermelho, participacao: C.amarelo, vitoria: C.verde };

// Resultado MANUAL (derrota/participacao/vitoria) + apagar evento. Client (o detalhe é Server Component).
export default function EventoAcoes({ id, resultadoInicial, canEdit }: { id: number; resultadoInicial: string | null; canEdit: boolean }) {
  const router = useRouter();
  const [resultado, setResultado] = useState(resultadoInicial);
  const [busy, setBusy] = useState(false);

  async function setR(r: string) {
    if (!canEdit || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/eventos/${id}/resultado`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resultado: r }) });
      if (res.ok) { setResultado(r); router.refresh(); } else { const d = await res.json().catch(() => ({})); alert(d.error || "falha"); }
    } finally { setBusy(false); }
  }
  async function deletar() {
    if (!canEdit) return;
    if (!confirm("Apagar este evento? (os stats de guerra em wars/desempenho permanecem)")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/eventos/${id}`, { method: "DELETE" });
      if (res.ok) router.push("/eventos");
      else { const d = await res.json().catch(() => ({})); alert(d.error || "falha"); setBusy(false); }
    } catch { setBusy(false); }
  }
  const btn = (r: string) => ({ borderRadius: 8, border: `1px solid ${resultado === r ? CORES[r] : C.border2}`, background: resultado === r ? C.inputBg : "transparent", color: resultado === r ? CORES[r] : C.mute, padding: "7px 15px", fontSize: 13, fontWeight: 700, cursor: canEdit ? "pointer" : "default", opacity: !canEdit && resultado !== r ? 0.5 : 1 } as const);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {["derrota", "participacao", "vitoria"].map((r) => <button key={r} onClick={() => setR(r)} disabled={!canEdit || busy} style={btn(r)}>{LABELS[r]}</button>)}
        {!resultado && <span style={{ color: C.dim, fontSize: 12 }}>{canEdit ? "escolha o resultado" : "sem resultado"}</span>}
      </div>
      {canEdit && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.borderSoft}` }}>
          <button onClick={deletar} disabled={busy} style={{ borderRadius: 8, border: `1px solid ${C.vermelho}`, background: "transparent", color: C.vermelho, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>🗑 Apagar evento</button>
        </div>
      )}
    </div>
  );
}
