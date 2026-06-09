"use client";

import { useMemo, useRef, useState } from "react";
import { chaveNome } from "@/lib/nomes";
import { C } from "@/lib/theme";
import type { GrupoConf, PlayerConf } from "@/lib/confirmados";

const GUILD: Record<string, { label: string; icon: string }> = {
  M: { label: "Manicômio", icon: "/guilds/manicomio.png" },
  R: { label: "Resonance", icon: "/guilds/resonance.png" },
};

// ícone da pt: "c<id>" = custom emoji do Discord (CDN); "u<char>" = emoji unicode.
function Icone({ iconKey, size = 15 }: { iconKey: string | null; size?: number }) {
  if (!iconKey) return null;
  if (iconKey.startsWith("c")) return <img src={`https://cdn.discordapp.com/emojis/${iconKey.slice(1)}.png`} alt="" width={size} height={size} style={{ borderRadius: 3, verticalAlign: "-2px" }} />;
  return <span style={{ fontSize: size }}>{iconKey.slice(1)}</span>;
}

export default function SubstituicoesBoard({
  grupos, listaEspera, removidosInit, rosterNomes, canEdit,
}: {
  grupos: GrupoConf[]; listaEspera: PlayerConf[]; removidosInit: string[]; rosterNomes: string[]; canEdit: boolean;
}) {
  const [removidos, setRemovidos] = useState<Set<string>>(() => new Set(removidosInit.map(chaveNome)));
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");

  const roster = useMemo(() => new Set(rosterNomes.map((n) => n.toLowerCase())), [rosterNomes]);
  const conhecido = (p: PlayerConf) => roster.has(p.nome.toLowerCase());

  const nomePorChave = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of grupos) for (const p of g.players) m.set(chaveNome(p.nome), p.nome);
    for (const w of listaEspera) m.set(chaveNome(w.nome), w.nome);
    return m;
  }, [grupos, listaEspera]);

  const grupoPorIcon = useMemo(() => {
    const m = new Map<string, GrupoConf>();
    for (const g of grupos) if (g.iconKey) m.set(g.iconKey, g);
    return m;
  }, [grupos]);

  // cascata: cada remoção num grupo abre 1 vaga; sobe o próximo da espera com o MESMO ícone.
  const dados = useMemo(() => {
    const isRem = (p: PlayerConf) => removidos.has(chaveNome(p.nome));
    const need = new Map<string, number>();
    for (const g of grupos) {
      if (!g.iconKey) continue;
      const n = g.players.filter(isRem).length;
      if (n > 0) need.set(g.iconKey, (need.get(g.iconKey) ?? 0) + n);
    }
    const promotedByIcon = new Map<string, PlayerConf[]>();
    const promotedKeys = new Set<string>();
    for (const w of listaEspera) {
      if (isRem(w) || !w.iconKey) continue;
      const left = need.get(w.iconKey) ?? 0;
      if (left <= 0) continue;
      const arr = promotedByIcon.get(w.iconKey) ?? [];
      arr.push(w);
      promotedByIcon.set(w.iconKey, arr);
      promotedKeys.add(chaveNome(w.nome));
      need.set(w.iconKey, left - 1);
    }
    const grupoView = grupos.map((g) => {
      const promoted = g.iconKey ? promotedByIcon.get(g.iconKey) ?? [] : [];
      const ativos = g.players.filter((p) => !isRem(p)).length + promoted.length;
      const livre = g.limite != null ? Math.max(0, g.limite - ativos) : 0;
      return { g, promoted, livre };
    });
    const plano: { pt: string; iconKey: string | null; removido: PlayerConf; promovido: PlayerConf | null }[] = [];
    for (const gv of grupoView) {
      const removedHere = gv.g.players.filter(isRem);
      removedHere.forEach((rmv, i) => plano.push({ pt: gv.g.nome, iconKey: gv.g.iconKey, removido: rmv, promovido: gv.promoted[i] ?? null }));
    }
    return { grupoView, plano, promotedKeys };
  }, [removidos, grupos, listaEspera]);

  // persistência serializada (replace-all; o último estado vence mesmo com toggles rápidos)
  const latestRef = useRef<string[]>(removidosInit);
  const savingRef = useRef(false);
  async function persist(list: string[]) {
    latestRef.current = list;
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      // continua salvando enquanto o estado mudar durante o request
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const snap = latestRef.current;
        const res = await fetch("/api/confirmados/remocao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ familias: snap }) });
        if (!res.ok) { const j = await res.json().catch(() => ({} as { error?: string })); throw new Error(j.error || `erro ${res.status}`); }
        if (latestRef.current === snap) break;
      }
      setErro("");
    } catch (e) { setErro((e as Error).message); }
    finally { savingRef.current = false; setSaving(false); }
  }

  function toggle(p: PlayerConf) {
    if (!canEdit) return;
    const k = chaveNome(p.nome);
    const next = new Set(removidos);
    if (next.has(k)) next.delete(k); else next.add(k);
    setRemovidos(next);
    persist([...next].map((kk) => nomePorChave.get(kk)).filter((n): n is string => !!n));
  }

  async function resetar() {
    if (!canEdit || !confirm("Limpar todas as remoções marcadas?")) return;
    setRemovidos(new Set());
    latestRef.current = [];
    setSaving(true);
    try {
      const res = await fetch("/api/confirmados/remocao", { method: "DELETE" });
      if (!res.ok) { const j = await res.json().catch(() => ({} as { error?: string })); throw new Error(j.error || "falha ao limpar"); }
      setErro("");
    } catch (e) { setErro((e as Error).message); }
    finally { setSaving(false); }
  }

  const isRem = (p: PlayerConf) => removidos.has(chaveNome(p.nome));
  const isProm = (p: PlayerConf) => dados.promotedKeys.has(chaveNome(p.nome));

  const planoTexto = dados.plano.map((r) => r.promovido
    ? `Sair: ${r.removido.nome}  →  Subir: ${r.promovido.nome}  (${r.pt})`
    : `Sair: ${r.removido.nome}  →  SEM reserva na espera  (${r.pt})`).join("\n");

  // linha de jogador (grupo ou espera) com botão remover/desfazer
  const Linha = ({ p, prom, estado }: { p: PlayerConf; prom?: boolean; estado?: "espera" }) => {
    const g = p.tag ? GUILD[p.tag] : null;
    const rem = isRem(p);
    const ok = conhecido(p);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, opacity: rem ? 0.45 : 1 }}>
        {estado === "espera" && <Icone iconKey={p.iconKey ?? null} size={13} />}
        {g && <img src={g.icon} alt={p.tag ?? ""} width={14} height={14} style={{ borderRadius: 3 }} />}
        <span style={{ color: rem ? C.vermelho : prom ? C.verde : ok ? C.texto : C.mute, textDecoration: rem ? "line-through" : "none" }}>
          {prom && !rem && <span style={{ color: C.verde }}>↑ </span>}{p.nome}
        </span>
        {p.nota && <span style={{ color: C.mute, fontSize: 11 }}>({p.nota})</span>}
        {!ok && !rem && <span style={{ color: C.amarelo, fontSize: 10 }} title="fora do roster">•</span>}
        {canEdit && (
          <button onClick={() => toggle(p)} title={rem ? "desfazer remoção" : "marcar p/ remover"}
            style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: rem ? C.mute : C.vermelho, fontSize: 12, lineHeight: 1, padding: "0 2px" }}>
            {rem ? "↺" : "✕"}
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "14px 16px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <div style={{ color: C.verde, fontWeight: 700, fontSize: 14 }}>Substituições <span style={{ color: C.mute, fontWeight: 400, fontSize: 12 }}>(bot travado)</span></div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {saving && <span style={{ color: C.mute, fontSize: 12 }}>salvando…</span>}
          {canEdit && removidos.size > 0 && !saving && (
            <button onClick={resetar} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.vermelho, padding: "5px 11px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>↺ Limpar</button>
          )}
        </div>
      </div>
      <div style={{ color: C.mute, fontSize: 11.5, marginBottom: 12 }}>
        {canEdit
          ? "Marque ✕ em quem saiu do grupo — sobe automaticamente o próximo da lista de espera da MESMA pt (mesmo ícone). Salva e reseta junto com a war."
          : "Plano de substituições montado pela staff. (Só staff marca remoções.)"}
      </div>

      {erro && <div style={{ color: C.vermelho, fontSize: 13, marginBottom: 8 }}>⚠ {erro}</div>}

      {/* plano de substituições — o que fazer no jogo/bot */}
      {dados.plano.length > 0 && (
        <div style={{ border: `1px solid ${C.border2}`, borderRadius: 10, background: C.inputBg, padding: "10px 13px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
            <span style={{ color: C.amarelo, fontWeight: 700, fontSize: 13 }}>Plano ({dados.plano.length})</span>
            <button onClick={() => navigator.clipboard?.writeText(planoTexto).catch(() => {})} title="copiar plano" style={{ background: "none", border: "none", color: C.mute, cursor: "pointer", fontSize: 12 }}>⧉ copiar</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {dados.plano.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, flexWrap: "wrap" }}>
                <Icone iconKey={r.iconKey} size={14} />
                <span style={{ color: C.mute, fontSize: 11, minWidth: 84 }}>{r.pt}</span>
                <span style={{ color: C.vermelho, textDecoration: "line-through" }}>{r.removido.nome}</span>
                <span style={{ color: C.mute }}>→</span>
                {r.promovido
                  ? <span style={{ color: C.verde }}>↑ {r.promovido.nome}</span>
                  : <span style={{ color: C.amarelo, fontSize: 11.5 }}>⚠ ninguém na espera dessa pt</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* grupos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12, marginBottom: 14 }}>
        {dados.grupoView.map(({ g, promoted, livre }) => (
          <div key={g.nome} style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surfaceSolid, padding: "11px 13px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 6 }}>
              <span style={{ color: C.verde, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}><Icone iconKey={g.iconKey} /> {g.nome}</span>
              <span style={{ color: C.mute, fontSize: 11 }}>{g.capacidade}{livre > 0 ? ` · ${livre} livre` : ""}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {g.players.length === 0 && promoted.length === 0
                ? <span style={{ color: C.borderSoft, fontSize: 12 }}>—</span>
                : <>{g.players.map((p, i) => <Linha key={`p${i}`} p={p} />)}
                    {promoted.map((p, i) => <Linha key={`up${i}`} p={p} prom />)}</>}
            </div>
          </div>
        ))}
      </div>

      {/* lista de espera */}
      {listaEspera.length > 0 && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surfaceSolid, padding: "12px 14px" }}>
          <div style={{ color: C.amarelo, fontWeight: 700, fontSize: 13.5, marginBottom: 9 }}>Lista de espera ({listaEspera.length})</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "3px 16px" }}>
            {listaEspera.map((p, i) => {
              const prom = isProm(p);
              const pt = p.iconKey ? grupoPorIcon.get(p.iconKey)?.nome : undefined;
              return (
                <div key={i}>
                  <Linha p={p} prom={prom} estado="espera" />
                  {prom && <div style={{ color: C.verde, fontSize: 10.5, marginLeft: 33 }}>↑ subiu p/ {pt}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
