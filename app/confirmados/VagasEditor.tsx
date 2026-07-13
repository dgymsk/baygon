"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Vagas } from "@/lib/vagas";
import { iconeUrl, type GuildEntry } from "@/lib/guild";
import { C } from "@/lib/theme";

type Status = { kind: "idle" | "saving" | "ok" | "err"; msg?: string };

export default function VagasEditor({ vagasInit, canEdit, guildas }: { vagasInit: Vagas; canEdit: boolean; guildas: GuildEntry[] }) {
  const router = useRouter();
  const [vagas, setVagas] = useState<Vagas>(vagasInit);
  const [saved, setSaved] = useState(() => JSON.stringify(vagasInit));
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const dirty = JSON.stringify(vagas) !== saved;
  const ro = !canEdit;

  // re-sincroniza do servidor (outro PC salvou vagas) — só quando não há edição pendente
  const vagasSig = JSON.stringify(vagasInit);
  const lastSig = useRef(vagasSig);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => { // sem dep-array: re-tenta a cada render (pega o update quando não está dirty)
    if (vagasSig === lastSig.current || dirtyRef.current) return;
    lastSig.current = vagasSig;
    setVagas(vagasInit); setSaved(vagasSig);
  });

  const setVaga = (g: string, patch: Partial<{ hidden: number; texto: string }>) => {
    if (ro) return;
    setVagas((prev) => ({ ...prev, [g]: { ...(prev[g] ?? { hidden: 0, texto: "" }), ...patch } }));
  };

  async function salvar() {
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/vagas", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(vagas) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha ao salvar vagas");
      setVagas(d); setSaved(JSON.stringify(d));
      setStatus({ kind: "ok", msg: "Vagas salvas." });
      router.refresh(); // recomputa offBot + reconciliação no servidor
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }

  const inp = { background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "6px 8px", fontSize: 13 } as const;

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "14px 16px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <div style={{ color: C.amarelo, fontWeight: 700, fontSize: 14 }}>Vagas fora do bot</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {status.kind === "ok" && <span style={{ color: C.verde, fontSize: 12 }}>✓ {status.msg}</span>}
          {status.kind === "err" && <span style={{ color: C.vermelho, fontSize: 12 }}>⚠ {status.msg}</span>}
          {canEdit && (
            <button onClick={salvar} disabled={!dirty || status.kind === "saving"} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: dirty ? C.verdeTint : C.inputBg, color: C.verde, padding: "6px 14px", fontSize: 13, fontWeight: 700, cursor: dirty ? "pointer" : "default", opacity: dirty ? 1 : 0.6 }}>
              {status.kind === "saving" ? "Salvando…" : `Salvar vagas${dirty ? " •" : ""}`}
            </button>
          )}
        </div>
      </div>
      <p style={{ color: C.mute, fontSize: 11.5, marginTop: 0, marginBottom: 12 }}>
        Vagas que não passam pelo bot (Apollo). <b style={{ color: C.texto }}>Reservadas</b> = nº de vagas ocultas por guilda. <b style={{ color: C.texto }}>Nomes</b> = quem ocupa vaga fora do bot (1 por linha) — esses <b style={{ color: C.texto }}>não</b> caem no “deve retirar” da conferência.
        {ro && <span style={{ color: C.amarelo }}> Só staff edita.</span>}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        {guildas.map((g) => { const u = iconeUrl(g.icone); const v = vagas[g.id] ?? { hidden: 0, texto: "" }; return (
          <div key={g.id} style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.inputBg, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              {u ? <img src={u} alt="" width={18} height={18} style={{ borderRadius: 4 }} /> : <span style={{ fontSize: 16 }}>{g.icone || g.tag}</span>}
              <span style={{ color: C.texto, fontWeight: 700 }}>{g.nome}</span>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13, color: C.mute }}>
              Vagas reservadas
              <input type="number" min={0} max={999} value={v.hidden} disabled={ro}
                onChange={(e) => setVaga(g.id, { hidden: Math.max(0, Math.min(999, Math.trunc(Number(e.target.value) || 0))) })}
                style={{ ...inp, width: 70 }} />
            </label>
            <div style={{ fontSize: 11, color: C.mute, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Nomes fora do bot (1 por linha)</div>
            <textarea value={v.texto} disabled={ro} rows={4} placeholder={"Fulano\nBeltrano"}
              onChange={(e) => setVaga(g.id, { texto: e.target.value })}
              style={{ ...inp, width: "100%", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
        ); })}
      </div>
    </div>
  );
}
