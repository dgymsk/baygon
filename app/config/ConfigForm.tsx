"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Config } from "@/lib/config";
import { C } from "@/lib/theme";

type Status = { kind: "idle" | "saving" | "ok" | "err"; msg?: string };

const initCores = (c: Config) => new Set(c.grupos.flatMap((g) => g.players.filter((p) => p.is_core).map((p) => p.nome_familia)));
const initGm = (c: Config): Record<string, Set<string>> => Object.fromEntries(c.grupos.map((g) => [g.grupo, new Set(g.metricas)]));
const snap = (cs: Set<string>, g: Record<string, Set<string>>) =>
  JSON.stringify({ c: [...cs].sort(), g: Object.fromEntries(Object.entries(g).map(([k, v]) => [k, [...v].sort()])) });

export default function ConfigForm({ initial }: { initial: Config }) {
  const [cfg, setCfg] = useState<Config>(initial);
  const [cores, setCores] = useState<Set<string>>(() => initCores(initial));
  const [gm, setGm] = useState<Record<string, Set<string>>>(() => initGm(initial));
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const metricas = cfg.metricas;
  const baseSnap = useMemo(() => snap(initCores(cfg), initGm(cfg)), [cfg]);
  const dirtyConfig = snap(cores, gm) !== baseSnap;

  function resetEditors(c: Config) { setCores(initCores(c)); setGm(initGm(c)); }
  async function reload() {
    const c = (await fetch("/api/config").then((r) => r.json())) as Config;
    setCfg(c); resetEditors(c);
  }

  const toggleCore = (nome: string) => setCores((prev) => { const n = new Set(prev); n.has(nome) ? n.delete(nome) : n.add(nome); return n; });
  const toggleMetric = (grupo: string, metrica: string) => setGm((prev) => { const s = new Set(prev[grupo] ?? []); s.has(metrica) ? s.delete(metrica) : s.add(metrica); return { ...prev, [grupo]: s }; });

  async function salvar() {
    setStatus({ kind: "saving" });
    try {
      const payload = { cores: [...cores], gruposMetricas: Object.fromEntries(Object.entries(gm).map(([g, s]) => [g, [...s]])) };
      const res = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha ao salvar");
      await reload(); // recarrega do servidor pra UI bater exatamente com o que foi gravado
      setStatus({ kind: "ok", msg: "Configuração salva." });
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }

  // ---- grupos ----
  async function grupoOp(init: RequestInit, url: string, msg: string) {
    setStatus({ kind: "saving" });
    try {
      const res = await fetch(url, init);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha");
      await reload();
      setStatus({ kind: "ok", msg });
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }
  // avisa do descarte ANTES de pedir o nome, pra ordem de UX fazer sentido
  const confirmDiscard = () => !dirtyConfig || confirm("Há alterações de cores/métricas não salvas que serão descartadas ao mexer nos grupos. Continuar?");
  const criarGrupo = () => { if (!confirmDiscard()) return; const nome = prompt("Nome do novo grupo:")?.trim(); if (nome) grupoOp({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome }) }, "/api/grupos", `grupo "${nome}" criado.`); };
  const renomear = (g: string) => { if (!confirmDiscard()) return; const to = prompt(`Renomear "${g}" para: (se o destino já existir, funde os dois)`, g)?.trim(); if (to && to !== g) grupoOp({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: g, to }) }, "/api/grupos", `"${g}" → "${to}".`); };
  const excluir = (g: string) => { if (!confirmDiscard()) return; if (confirm(`Excluir o grupo "${g}"? Os membros vão para "Indefinido".`)) grupoOp({ method: "DELETE" }, `/api/grupos/${encodeURIComponent(g)}`, `grupo "${g}" excluído.`); };

  const card = { border: `1px solid ${C.border}`, borderRadius: 16, background: C.surface, padding: 18 } as const;
  const btn = (color: string = C.verde) => ({ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" } as const);

  return (
    <div style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>

      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/mascot.png" alt="" width={38} height={38} style={{ filter: "drop-shadow(0 0 10px rgba(126,224,70,.45))" }} />
            <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 26, letterSpacing: 1, margin: 0, color: C.amarelo }}>
              BAYGON <span style={{ color: C.mute, fontSize: 14, letterSpacing: 2 }}>· CONFIGURAÇÃO</span>
            </h1>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <Link className="navlink" href="/painel">← Painel</Link>
            <Link className="navlink" href="/membros">Membros</Link>
            <Link className="navlink" href="/evolucao">Evolução</Link>
            {status.kind === "ok" && <span style={{ color: C.verde, fontSize: 13 }}>✓ {status.msg}</span>}
            {status.kind === "err" && <span style={{ color: C.vermelho, fontSize: 13 }}>⚠ {status.msg}</span>}
            <button onClick={salvar} disabled={status.kind === "saving"} style={{ ...btn(C.amarelo), padding: "8px 16px", fontSize: 13, opacity: dirtyConfig ? 1 : 0.7 }}>
              {status.kind === "saving" ? "Salvando…" : "Salvar config"}
            </button>
          </div>
        </div>
        <p style={{ color: C.mute, fontSize: 13, marginTop: 2, marginBottom: 18 }}>
          Gerencie os <b style={{ color: C.texto }}>grupos</b>, as <b style={{ color: C.texto }}>métricas</b> que avaliam cada um e quem é <b style={{ color: C.texto }}>core</b> (a régua). O score reflete na hora.
        </p>

        {/* gerenciar grupos */}
        <div style={{ ...card, marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 17, margin: 0, color: C.verde }}>Grupos</h2>
            <button onClick={criarGrupo} style={btn(C.amarelo)}>+ Criar grupo</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {cfg.grupos.filter((g) => g.grupo !== "Indefinido").map((g) => (
              <div key={g.grupo} style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1px solid ${C.border}`, borderRadius: 10, padding: "6px 10px", background: C.inputBg }}>
                <span style={{ color: C.texto, fontWeight: 600, fontSize: 13 }}>{g.grupo}</span>
                <span style={{ color: C.mute, fontSize: 11 }}>{g.players.length}p · {g.metricas.length}m</span>
                <button onClick={() => renomear(g.grupo)} title="renomear" style={{ background: "none", border: "none", color: C.amarelo, cursor: "pointer", fontSize: 13 }}>✎</button>
                <button onClick={() => excluir(g.grupo)} title="excluir (membros → Indefinido)" style={{ background: "none", border: "none", color: C.vermelho, cursor: "pointer", fontSize: 13 }}>🗑</button>
              </div>
            ))}
            {cfg.grupos.filter((g) => g.grupo !== "Indefinido").length === 0 && <span style={{ color: C.mute, fontSize: 13 }}>Nenhum grupo ainda — crie um.</span>}
          </div>
          <p style={{ color: C.mute, fontSize: 11, marginTop: 10, marginBottom: 0 }}>
            Renomear propaga pra todos os membros + config de métricas. Pra trocar o grupo de UMA pessoa, use a coluna “Grupo” em <Link className="navlink" href="/membros" style={{ color: C.verde }}>Membros</Link>.
          </p>
        </div>

        {/* editor de métricas + cores por grupo */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {cfg.grupos.map((g) => {
            const indef = g.grupo === "Indefinido";
            const sel = gm[g.grupo] ?? new Set<string>();
            return (
              <section key={g.grupo} style={card}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
                  <h2 style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 18, margin: 0, color: indef ? C.mute : C.texto }}>{g.grupo}</h2>
                  <span style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>{g.players.length} players · {sel.size} métricas</span>
                </div>
                {indef ? (
                  <p style={{ color: C.mute, fontSize: 12, margin: 0 }}>Players sem grupo definido — não entram no cálculo. Reclassifique em Membros (ou crie/renomeie grupos acima).</p>
                ) : (
                  <>
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ marginBottom: 8, fontSize: 11, color: C.mute, textTransform: "uppercase", letterSpacing: 1 }}>Métricas avaliadas</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {metricas.map((m) => {
                          const on = sel.has(m.metrica);
                          return (
                            <button key={m.metrica} onClick={() => toggleMetric(g.grupo, m.metrica)} title={`${m.direcao}${m.universal ? " · universal" : ""}`}
                              style={{ borderRadius: 999, border: `1px solid ${on ? C.verde : C.border2}`, background: on ? C.verdeTint : "transparent", color: on ? C.verde : C.mute, padding: "5px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                              {m.rotulo}{m.direcao === "menor_melhor" ? " ↓" : ""}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <div style={{ marginBottom: 8, fontSize: 11, color: C.mute, textTransform: "uppercase", letterSpacing: 1 }}>Cores (régua) — clique para marcar</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {g.players.length === 0 && <span style={{ color: C.mute, fontSize: 12 }}>Sem players nesse grupo.</span>}
                        {g.players.map((p) => {
                          const on = cores.has(p.nome_familia);
                          return (
                            <button key={p.nome_familia} onClick={() => toggleCore(p.nome_familia)}
                              style={{ borderRadius: 8, border: `1px solid ${on ? C.amarelo : C.border}`, background: on ? C.amareloTint : C.inputBg, color: on ? C.amarelo : C.texto, padding: "6px 12px", fontSize: 13, cursor: "pointer", opacity: p.ativo ? 1 : 0.5 }}>
                              {on ? "★ " : ""}{p.nome_familia}
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

        <p style={{ color: C.mute, fontSize: 11.5, marginTop: 16 }}>
          ★ = core · ↓ = métrica onde menos é melhor · operações de grupo recarregam e descartam edições de cores/métricas não salvas (você é avisado).
        </p>
      </div>
    </div>
  );
}
