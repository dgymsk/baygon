"use client";

import { useMemo, useState } from "react";
import type { Config } from "@/lib/config";

const GOLD = "#ffd21e";
const PARCH = "#e9f3ec";
const MUTE = "#82a08f";

export default function ConfigForm({ initial }: { initial: Config }) {
  const { metricas } = initial;

  // estado local editável
  const [cores, setCores] = useState<Set<string>>(
    () => new Set(initial.grupos.flatMap((g) => g.players.filter((p) => p.is_core).map((p) => p.nome_familia)))
  );
  const [gm, setGm] = useState<Record<string, Set<string>>>(
    () => Object.fromEntries(initial.grupos.map((g) => [g.grupo, new Set(g.metricas)]))
  );
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "err"; msg?: string }>({ kind: "idle" });

  const rotulo = useMemo(() => Object.fromEntries(metricas.map((m) => [m.metrica, m])), [metricas]);

  const toggleCore = (nome: string) =>
    setCores((prev) => {
      const next = new Set(prev);
      next.has(nome) ? next.delete(nome) : next.add(nome);
      return next;
    });

  const toggleMetric = (grupo: string, metrica: string) =>
    setGm((prev) => {
      const set = new Set(prev[grupo] ?? []);
      set.has(metrica) ? set.delete(metrica) : set.add(metrica);
      return { ...prev, [grupo]: set };
    });

  async function salvar() {
    setStatus({ kind: "saving" });
    try {
      const payload = {
        cores: [...cores],
        gruposMetricas: Object.fromEntries(Object.entries(gm).map(([g, s]) => [g, [...s]])),
      };
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "falha ao salvar");
      setStatus({ kind: "ok", msg: "Configuração salva." });
    } catch (e) {
      setStatus({ kind: "err", msg: (e as Error).message });
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_600px_at_70%_-10%,#103326_0%,#060d0b_60%)] px-6 py-8 text-[#e9f3ec] font-[system-ui]">
      <div className="mx-auto max-w-5xl">
        {/* header */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl font-extrabold tracking-wide" style={{ color: GOLD }}>
              BAYGON · Configuração
            </h1>
            <p className="mt-1 text-sm" style={{ color: MUTE }}>
              Defina as <b style={{ color: PARCH }}>métricas</b> que avaliam cada grupo e quem é{" "}
              <b style={{ color: PARCH }}>core</b> (a régua). O cálculo do score reflete na hora.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {status.kind === "ok" && <span className="text-sm" style={{ color: GOLD }}>✓ {status.msg}</span>}
            {status.kind === "err" && <span className="text-sm" style={{ color: "#ff5240" }}>⚠ {status.msg}</span>}
            <button
              onClick={salvar}
              disabled={status.kind === "saving"}
              className="rounded-lg border px-5 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
              style={{ borderColor: "#2a4a37", background: "#091310", color: GOLD }}
            >
              {status.kind === "saving" ? "Salvando…" : "Salvar configuração"}
            </button>
          </div>
        </div>

        {/* grupos */}
        <div className="flex flex-col gap-5">
          {initial.grupos.map((g) => {
            const indef = g.grupo === "Indefinido";
            const sel = gm[g.grupo] ?? new Set<string>();
            return (
              <section
                key={g.grupo}
                className="rounded-2xl border p-5"
                style={{ borderColor: "#21402f", background: "linear-gradient(180deg,#0f1f18,#0b1611)" }}
              >
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="font-serif text-xl" style={{ color: indef ? MUTE : PARCH }}>
                    {g.grupo}
                  </h2>
                  <span className="text-xs uppercase tracking-widest" style={{ color: MUTE }}>
                    {g.players.length} players · {sel.size} métricas
                  </span>
                </div>

                {indef ? (
                  <p className="text-xs" style={{ color: MUTE }}>
                    Players sem grupo definido — não entram no cálculo de discrepância. Reclassifique-os na origem (planilha).
                  </p>
                ) : (
                  <>
                    {/* métricas do grupo */}
                    <div className="mb-4">
                      <div className="mb-2 text-xs uppercase tracking-widest" style={{ color: MUTE }}>
                        Métricas avaliadas
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {metricas.map((m) => {
                          const on = sel.has(m.metrica);
                          return (
                            <button
                              key={m.metrica}
                              onClick={() => toggleMetric(g.grupo, m.metrica)}
                              title={`${m.direcao}${m.universal ? " · universal" : ""}`}
                              className="rounded-full border px-3 py-1 text-xs transition-colors"
                              style={{
                                borderColor: on ? GOLD : "#2a4a37",
                                background: on ? "rgba(255,210,30,.15)" : "transparent",
                                color: on ? GOLD : MUTE,
                              }}
                            >
                              {m.rotulo}
                              {m.direcao === "menor_melhor" ? " ↓" : ""}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* cores do grupo */}
                    <div>
                      <div className="mb-2 text-xs uppercase tracking-widest" style={{ color: MUTE }}>
                        Cores (régua) — clique para marcar/desmarcar
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {g.players.map((p) => {
                          const on = cores.has(p.nome_familia);
                          return (
                            <button
                              key={p.nome_familia}
                              onClick={() => toggleCore(p.nome_familia)}
                              className="rounded-lg border px-3 py-1.5 text-sm transition-colors"
                              style={{
                                borderColor: on ? GOLD : "#21402f",
                                background: on ? "rgba(255,210,30,.18)" : "#091310",
                                color: on ? GOLD : PARCH,
                                opacity: p.ativo ? 1 : 0.5,
                              }}
                            >
                              {on ? "★ " : ""}
                              {p.nome_familia}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </section>
            );
          })}
        </div>

        <p className="mt-6 text-xs" style={{ color: MUTE }}>
          ★ = core · ↓ = métrica onde menos é melhor (ex.: tempo morto). As mudanças só valem após
          <b style={{ color: PARCH }}> Salvar</b>.
        </p>
      </div>
    </div>
  );
}
