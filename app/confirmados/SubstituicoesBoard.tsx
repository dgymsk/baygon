"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { chaveNome } from "@/lib/nomes";
import { C } from "@/lib/theme";
import type { GrupoConf, PlayerConf } from "@/lib/confirmados";

type RemOp = { familia: string; tipo: "remover" | "subir" | null };

const GUILD: Record<string, { label: string; icon: string }> = {
  M: { label: "Manicômio", icon: "/guilds/manicomio.png" },
  R: { label: "Resonance", icon: "/guilds/resonance.png" },
};

// ícone da pt: "c<id>" = custom emoji do Discord (CDN); "u<char>" = emoji unicode.
function Icone({ iconKey, size = 15 }: { iconKey: string | null; size?: number }) {
  if (!iconKey) return null;
  if (iconKey.startsWith("c")) return <img src={`https://cdn.discordapp.com/emojis/${iconKey.slice(1)}.png`} alt="" width={size} height={size} onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ borderRadius: 3, verticalAlign: "-2px" }} />;
  return <span style={{ fontSize: size }}>{iconKey.slice(1)}</span>;
}

/**
 * Poda o conjunto de promoções confirmadas ao número de vagas abertas (need) por ícone,
 * em ordem da espera. Evita "promoção fantasma" quando o need encolhe (ex.: desfazer uma
 * remoção) — só persiste o que realmente cabe nas vagas.
 */
function promovidosValidos(rem: Set<string>, prom: Set<string>, grupos: GrupoConf[], listaEspera: PlayerConf[]): Set<string> {
  const isRem = (p: PlayerConf) => rem.has(chaveNome(p.nome));
  const need = new Map<string, number>();
  for (const g of grupos) {
    if (!g.iconKey) continue;
    const n = g.players.filter(isRem).length;
    if (n > 0) need.set(g.iconKey, (need.get(g.iconKey) ?? 0) + n);
  }
  const count = new Map<string, number>();
  const valido = new Set<string>();
  for (const w of listaEspera) {
    const k = chaveNome(w.nome);
    if (isRem(w) || !w.iconKey || !prom.has(k)) continue;
    const lim = need.get(w.iconKey) ?? 0;
    const c = count.get(w.iconKey) ?? 0;
    if (c < lim) { valido.add(k); count.set(w.iconKey, c + 1); }
  }
  return valido;
}

export default function SubstituicoesBoard({
  grupos, listaEspera, removidosInit, promovidosInit, rosterNomes, canEdit, warKey,
}: {
  grupos: GrupoConf[]; listaEspera: PlayerConf[]; removidosInit: string[]; promovidosInit: string[]; rosterNomes: string[]; canEdit: boolean; warKey: string | null;
}) {
  const router = useRouter();
  const [removidos, setRemovidos] = useState<Set<string>>(() => new Set(removidosInit.map(chaveNome)));
  const [promovidos, setPromovidos] = useState<Set<string>>(() => new Set(promovidosInit.map(chaveNome)));
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);

  const roster = useMemo(() => new Set(rosterNomes.map(chaveNome)), [rosterNomes]);
  const conhecido = (p: PlayerConf) => roster.has(chaveNome(p.nome));

  const nomePorChave = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of grupos) for (const p of g.players) m.set(chaveNome(p.nome), p.nome);
    for (const w of listaEspera) m.set(chaveNome(w.nome), w.nome);
    return m;
  }, [grupos, listaEspera]);

  // cascata MANUAL: remover abre vaga; subir é CONFIRMADO pela staff (✓/↑). A fila do
  // ícone é repartida por grupo (cursor) pra grupos com o mesmo emoji não se confundirem.
  const dados = useMemo(() => {
    const isRem = (p: PlayerConf) => removidos.has(chaveNome(p.nome));
    const isProm = (p: PlayerConf) => promovidos.has(chaveNome(p.nome));

    const need = new Map<string, number>(); // vagas abertas por ícone (= removidos no(s) grupo(s))
    for (const g of grupos) {
      if (!g.iconKey) continue;
      const n = g.players.filter(isRem).length;
      if (n > 0) need.set(g.iconKey, (need.get(g.iconKey) ?? 0) + n);
    }
    // promoções CONFIRMADAS por ícone (ordem da espera), limitadas ao need
    const confirmadosPorIcon = new Map<string, PlayerConf[]>();
    for (const w of listaEspera) {
      if (isRem(w) || !w.iconKey || !isProm(w)) continue;
      const lim = need.get(w.iconKey) ?? 0;
      const arr = confirmadosPorIcon.get(w.iconKey) ?? [];
      if (arr.length < lim) { arr.push(w); confirmadosPorIcon.set(w.iconKey, arr); }
    }
    const abertasPorIcon = new Map<string, number>();
    for (const [icon, n] of need) abertasPorIcon.set(icon, Math.max(0, n - (confirmadosPorIcon.get(icon)?.length ?? 0)));
    // candidatos (sugestões) por ícone: não-removido, não-confirmado, em ordem — só onde há vaga aberta
    const candidatosPorIcon = new Map<string, PlayerConf[]>();
    const podePromover = new Set<string>();
    const sugeridoKeys = new Set<string>();
    for (const w of listaEspera) {
      if (isRem(w) || !w.iconKey || isProm(w)) continue;
      if ((abertasPorIcon.get(w.iconKey) ?? 0) <= 0) continue;
      const arr = candidatosPorIcon.get(w.iconKey) ?? [];
      if (arr.length === 0) sugeridoKeys.add(chaveNome(w.nome)); // 1º da fila = sugerido
      arr.push(w); candidatosPorIcon.set(w.iconKey, arr);
      podePromover.add(chaveNome(w.nome));
    }

    const cursor = new Map<string, number>();
    const promovidoKeys = new Set<string>();
    const promovidoPara = new Map<string, string>();
    const grupoView = grupos.map((g) => {
      const removedHere = g.players.filter(isRem);
      let promoted: PlayerConf[] = [];
      if (g.iconKey && removedHere.length) {
        const pool = confirmadosPorIcon.get(g.iconKey) ?? [];
        const start = cursor.get(g.iconKey) ?? 0;
        promoted = pool.slice(start, start + removedHere.length);
        cursor.set(g.iconKey, start + promoted.length);
        for (const w of promoted) { promovidoKeys.add(chaveNome(w.nome)); promovidoPara.set(chaveNome(w.nome), g.nome); }
      }
      const abertasAqui = removedHere.length - promoted.length;
      const ativos = g.players.length - removedHere.length + promoted.length;
      const livre = g.limite != null ? Math.max(0, g.limite - ativos) : 0;
      return { g, removedHere, promoted, abertasAqui, ativos, livre };
    });

    // plano: cada removido -> confirmado (✓) OU vaga aberta + sugestão
    const sugCursor = new Map<string, number>();
    const plano: { pt: string; iconKey: string | null; removido: PlayerConf; promovido: PlayerConf | null; sugestao: PlayerConf | null }[] = [];
    for (const gv of grupoView) {
      gv.removedHere.forEach((rmv, i) => {
        const promovido = gv.promoted[i] ?? null;
        let sugestao: PlayerConf | null = null;
        if (!promovido && gv.g.iconKey) {
          const cands = candidatosPorIcon.get(gv.g.iconKey) ?? [];
          const ci = sugCursor.get(gv.g.iconKey) ?? 0;
          sugestao = cands[ci] ?? null;
          sugCursor.set(gv.g.iconKey, ci + 1);
        }
        plano.push({ pt: gv.g.nome, iconKey: gv.g.iconKey, removido: rmv, promovido, sugestao });
      });
    }
    return { grupoView, plano, promovidoKeys, promovidoPara, abertasPorIcon, podePromover, sugeridoKeys };
  }, [removidos, promovidos, grupos, listaEspera]);

  // envia DELTAS (ops) por linha — seguro p/ edição concorrente. Fila serializada.
  const opQueueRef = useRef<RemOp[]>([]);
  const flushingRef = useRef(false);
  async function enviarOps(ops: RemOp[]) {
    if (!ops.length) return;
    opQueueRef.current.push(...ops);
    if (flushingRef.current) return;
    flushingRef.current = true; setSaving(true);
    try {
      while (opQueueRef.current.length) {
        const batch = opQueueRef.current; opQueueRef.current = [];
        const res = await fetch("/api/confirmados/remocao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ops: batch, warKey }) });
        if (!res.ok) { const j = await res.json().catch(() => ({} as { error?: string })); throw new Error(j.error || `erro ${res.status}`); }
      }
      setErro("");
      router.refresh(); // propaga p/ os outros boards (roster da PT) e re-sincroniza
    } catch (e) { setErro((e as Error).message); }
    finally { flushingRef.current = false; setSaving(false); }
  }

  // re-sincroniza do servidor quando os dados mudam (outro PC editou), sem atropelar edição local
  const subSig = removidosInit.join("\n") + "\u0001" + promovidosInit.join("\n");
  const lastSubSig = useRef(subSig);
  useEffect(() => { // sem dep-array: re-tenta a cada render (pega o update após o flush)
    if (subSig === lastSubSig.current || flushingRef.current) return;
    lastSubSig.current = subSig;
    setRemovidos(new Set(removidosInit.map(chaveNome)));
    setPromovidos(new Set(promovidosInit.map(chaveNome)));
  });

  function toggleRemover(p: PlayerConf) {
    if (!canEdit) return;
    const k = chaveNome(p.nome);
    const next = new Set(removidos);
    const removendo = !next.has(k);
    if (removendo) next.add(k); else next.delete(k);
    // poda promoções que não cabem mais nas vagas (need pode ter encolhido) — sem fantasma
    const prom = promovidosValidos(next, promovidos, grupos, listaEspera);
    const ops: RemOp[] = [{ familia: p.nome, tipo: removendo ? "remover" : null }];
    for (const pk of promovidos) if (!prom.has(pk)) ops.push({ familia: nomePorChave.get(pk) ?? pk, tipo: null }); // promoção podada
    setRemovidos(next); setPromovidos(prom);
    enviarOps(ops);
  }

  function togglePromover(w: PlayerConf) {
    if (!canEdit || !w.iconKey) return;
    const k = chaveNome(w.nome);
    const cand = new Set(promovidos);
    const confirmando = !cand.has(k);
    if (confirmando) cand.add(k); else cand.delete(k);
    // valida contra o need atual (cap em ordem da espera) — confirma só se couber
    const prom = promovidosValidos(removidos, cand, grupos, listaEspera);
    if (confirmando && !prom.has(k)) return; // tentou subir mas não há vaga → ignora
    setPromovidos(prom);
    enviarOps([{ familia: w.nome, tipo: confirmando ? "subir" : null }]);
  }

  async function resetar() {
    if (!canEdit || !confirm("Limpar todas as remoções e promoções confirmadas?")) return;
    setRemovidos(new Set()); setPromovidos(new Set());
    opQueueRef.current = [];
    setSaving(true);
    try {
      const res = await fetch("/api/confirmados/remocao", { method: "DELETE" });
      if (!res.ok) { const j = await res.json().catch(() => ({} as { error?: string })); throw new Error(j.error || "falha ao limpar"); }
      setErro(""); router.refresh();
    } catch (e) { setErro((e as Error).message); }
    finally { setSaving(false); }
  }

  const isRem = (p: PlayerConf) => removidos.has(chaveNome(p.nome));
  const temAcao = removidos.size > 0 || promovidos.size > 0;

  const planoTexto = dados.plano.map((r) => r.promovido
    ? `Sair: ${r.removido.nome}  →  SOBE: ${r.promovido.nome}  (${r.pt})`
    : `Sair: ${r.removido.nome}  →  vaga aberta${r.sugestao ? ` (sugerido: ${r.sugestao.nome})` : " (sem reserva)"}  (${r.pt})`).join("\n");

  function copiarPlano() {
    const p = navigator.clipboard?.writeText(planoTexto);
    if (!p) return;
    p.then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500); }).catch(() => {});
  }

  // linha de membro do grupo (✕ remover / ↺ desfazer), ou promovido confirmado (✓)
  const LinhaGrupo = ({ p, prom }: { p: PlayerConf; prom?: boolean }) => {
    const g = p.tag ? GUILD[p.tag] : null;
    const rem = isRem(p);
    const ok = conhecido(p);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, opacity: rem ? 0.45 : 1 }}>
        {g && <img src={g.icon} alt={p.tag ?? ""} width={14} height={14} style={{ borderRadius: 3 }} />}
        <span style={{ color: rem ? C.vermelho : prom ? C.verde : ok ? C.texto : C.mute, textDecoration: rem ? "line-through" : "none" }}>
          {prom && <span style={{ color: C.verde }}>↑ </span>}{p.nome}
        </span>
        {p.nota && <span style={{ color: C.mute, fontSize: 11 }}>({p.nota})</span>}
        {!ok && !rem && !prom && <span style={{ color: C.amarelo, fontSize: 10 }} title="fora do roster">•</span>}
        {canEdit && (prom
          ? <button onClick={() => togglePromover(p)} title="desfazer promoção" style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: C.mute, fontSize: 12, lineHeight: 1, padding: "0 2px" }}>↺</button>
          : <button onClick={() => toggleRemover(p)} title={rem ? "desfazer remoção" : "marcar p/ remover"} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: rem ? C.mute : C.vermelho, fontSize: 12, lineHeight: 1, padding: "0 2px" }}>{rem ? "↺" : "✕"}</button>
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
          {canEdit && temAcao && !saving && (
            <button onClick={resetar} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.vermelho, padding: "5px 11px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>↺ Limpar</button>
          )}
        </div>
      </div>
      <div style={{ color: C.mute, fontSize: 11.5, marginBottom: 12 }}>
        {canEdit
          ? "Marque ✕ em quem saiu — a vaga fica ABERTA. Confirme quem sobe: ✓ na sugestão (1º da espera) ou ↑ em qualquer reserva da mesma pt. Salva e reseta junto com a war."
          : "Plano de substituições montado pela staff. (Só staff edita.)"}
      </div>

      {erro && <div style={{ color: C.vermelho, fontSize: 13, marginBottom: 8 }}>⚠ {erro}</div>}

      {/* plano — o que fazer no jogo/bot; ✓ confirma a sugestão */}
      {dados.plano.length > 0 && (
        <div style={{ border: `1px solid ${C.border2}`, borderRadius: 10, background: C.inputBg, padding: "10px 13px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
            <span style={{ color: C.amarelo, fontWeight: 700, fontSize: 13 }}>Plano ({dados.plano.length})</span>
            <button onClick={copiarPlano} title="copiar plano" style={{ background: "none", border: "none", color: copiado ? C.verde : C.mute, cursor: "pointer", fontSize: 12 }}>{copiado ? "✓ copiado" : "⧉ copiar"}</button>
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
                  : r.sugestao
                    ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: C.amarelo, fontSize: 11.5 }}>⏳ vaga aberta · sugerido: <b style={{ color: C.texto }}>{r.sugestao.nome}</b></span>
                        {canEdit && <button onClick={() => r.sugestao && togglePromover(r.sugestao)} title="confirmar a sugestão" style={{ borderRadius: 6, border: `1px solid ${C.border2}`, background: C.verdeTint, color: C.verde, cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "1px 7px" }}>✓ confirmar</button>}
                      </span>
                    : <span style={{ color: C.amarelo, fontSize: 11.5 }}>⚠ ninguém na espera dessa pt</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* grupos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12, marginBottom: 14 }}>
        {dados.grupoView.map(({ g, promoted, livre, ativos, abertasAqui }) => (
          <div key={g.nome} style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surfaceSolid, padding: "11px 13px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 6 }}>
              <span style={{ color: C.verde, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}><Icone iconKey={g.iconKey} /> {g.nome}</span>
              <span style={{ color: C.mute, fontSize: 11 }} title="ocupadas/limite (após remoções e promoções confirmadas)">{ativos}/{g.limite ?? "?"}{livre > 0 ? ` · ${livre} livre` : ""}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {g.players.length === 0 && promoted.length === 0
                ? <span style={{ color: C.borderSoft, fontSize: 12 }}>—</span>
                : <>{g.players.map((p, i) => <LinhaGrupo key={`p${i}`} p={p} />)}
                    {promoted.map((p, i) => <LinhaGrupo key={`up${i}`} p={p} prom />)}</>}
              {abertasAqui > 0 && <span style={{ color: C.amarelo, fontSize: 11 }}>⏳ {abertasAqui} vaga(s) aberta(s)</span>}
            </div>
          </div>
        ))}
      </div>

      {/* lista de espera — ↑ subir quando a pt tem vaga aberta */}
      {listaEspera.length > 0 && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surfaceSolid, padding: "12px 14px" }}>
          <div style={{ color: C.amarelo, fontWeight: 700, fontSize: 13.5, marginBottom: 9 }}>Lista de espera ({listaEspera.length})</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "3px 16px" }}>
            {listaEspera.map((p, i) => {
              const k = chaveNome(p.nome);
              const confirmado = dados.promovidoKeys.has(k);
              const pode = dados.podePromover.has(k);
              const sugerido = dados.sugeridoKeys.has(k);
              const g = p.tag ? GUILD[p.tag] : null;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                  <Icone iconKey={p.iconKey ?? null} size={13} />
                  {g && <img src={g.icon} alt={p.tag ?? ""} width={14} height={14} style={{ borderRadius: 3 }} />}
                  <span style={{ color: confirmado ? C.verde : C.texto }}>{confirmado && "↑ "}{p.nome}</span>
                  {confirmado && <span style={{ color: C.verde, fontSize: 10.5 }}>p/ {dados.promovidoPara.get(k)}</span>}
                  {canEdit && confirmado && (
                    <button onClick={() => togglePromover(p)} title="desfazer promoção" style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: C.mute, fontSize: 12, padding: "0 2px" }}>↺</button>
                  )}
                  {canEdit && !confirmado && pode && (
                    <button onClick={() => togglePromover(p)} title={sugerido ? "subir (sugerido)" : "subir esta pessoa"}
                      style={{ marginLeft: "auto", borderRadius: 6, border: `1px solid ${sugerido ? C.verde : C.border2}`, background: sugerido ? C.verdeTint : "transparent", color: C.verde, cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "1px 7px", lineHeight: 1.4 }}>
                      {sugerido ? "✓ subir" : "↑"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
