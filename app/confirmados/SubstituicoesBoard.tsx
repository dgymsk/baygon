"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { chaveNome } from "@/lib/nomes";
import { atribuirPromocoes, totalVagas } from "@/lib/substituicoes";
import { C } from "@/lib/theme";
import type { GrupoConf, PlayerConf } from "@/lib/confirmados";
import { iconeUrl, type GuildEntry } from "@/lib/guild";

type RemOp = { familia: string; tipo: "remover" | "subir" | null };

// ícone da pt: "c<id>" = custom emoji do Discord (CDN); "u<char>" = emoji unicode.
function Icone({ iconKey, size = 15 }: { iconKey: string | null; size?: number }) {
  if (!iconKey) return null;
  if (iconKey.startsWith("c")) return <img src={`https://cdn.discordapp.com/emojis/${iconKey.slice(1)}.png`} alt="" width={size} height={size} onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ borderRadius: 3, verticalAlign: "-2px" }} />;
  return <span style={{ fontSize: size }}>{iconKey.slice(1)}</span>;
}

/**
 * Poda as promoções confirmadas ao TOTAL de vagas abertas (cap global, em ordem da espera).
 * Qualquer reserva pode subir em qualquer vaga (Ataque é flex; outras aceitam cross com aviso),
 * então o limite é global — não por ícone. Evita "promoção fantasma" quando o total de vagas
 * encolhe (ex.: desfazer uma remoção). Vagas = removidos + capacidade ociosa (lib compartilhado).
 */
function promovidosValidos(rem: Set<string>, prom: Set<string>, grupos: GrupoConf[], listaEspera: PlayerConf[]): Set<string> {
  const isRem = (p: PlayerConf) => rem.has(chaveNome(p.nome));
  const cap = totalVagas(grupos, rem);
  const valido = new Set<string>();
  for (const w of listaEspera) {
    if (valido.size >= cap) break;
    const k = chaveNome(w.nome);
    if (isRem(w) || !prom.has(k)) continue;
    valido.add(k);
  }
  return valido;
}

export default function SubstituicoesBoard({
  grupos, listaEspera, removidosInit, promovidosInit, rosterNomes, canEdit, warKey, guildas,
}: {
  grupos: GrupoConf[]; listaEspera: PlayerConf[]; removidosInit: string[]; promovidosInit: string[]; rosterNomes: string[]; canEdit: boolean; warKey: string | null; guildas: GuildEntry[];
}) {
  const router = useRouter();
  const byTag = useMemo(() => new Map(guildas.map((g) => [g.tag, g])), [guildas]);
  const GuildIcon = ({ tag, size = 14 }: { tag: string | null; size?: number }) => {
    const g = tag ? byTag.get(tag) : null;
    if (!g) return null;
    const u = iconeUrl(g.icone);
    return u ? <img src={u} alt={tag ?? ""} width={size} height={size} style={{ borderRadius: 3 }} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : g.icone ? <span style={{ fontSize: size }}>{g.icone}</span> : null;
  };
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

  // cascata MANUAL: remover abre vaga; subir é CONFIRMADO pela staff (✓/↑). Atribuição em
  // 3 fases (mesma classe → Ataque flex pega qualquer → cross com aviso) no lib compartilhado.
  const dados = useMemo(() => {
    const isRem = (p: PlayerConf) => removidos.has(chaveNome(p.nome));
    const { grupoView: gv0, promovidoPara } = atribuirPromocoes(grupos, listaEspera, removidos, promovidos);
    const promovidoKeys = new Set(promovidoPara.keys());

    // eligibilidade EXATA por reserva: simula confirmar e olha o resultado REAL (limpo/cross),
    // pra o aviso de "outra classe" bater certo mesmo com competição/ordem da fila.
    const eligPorChave = new Map<string, "limpo" | "cross">();
    for (const w of listaEspera) {
      const k = chaveNome(w.nome);
      if (isRem(w) || promovidoKeys.has(k)) continue;
      const cand = promovidosValidos(removidos, new Set([...promovidos, k]), grupos, listaEspera);
      if (!cand.has(k)) continue; // não cabe no total de vagas
      const info = atribuirPromocoes(grupos, listaEspera, removidos, cand).promovidoPara.get(k);
      if (info) eligPorChave.set(k, info.cross ? "cross" : "limpo");
    }

    const grupoView = grupos.map((g, i) => {
      const removidosAqui = gv0[i].slots.filter((s) => s.removido).length;
      const promoted = gv0[i].slots.map((s) => s.promovido).filter((p): p is PlayerConf => !!p);
      const abertasAqui = gv0[i].slots.filter((s) => !s.promovido).length;
      const ativos = g.players.length - removidosAqui + promoted.length;
      const livre = g.limite != null ? Math.max(0, g.limite - ativos) : 0;
      return { g, ataque: gv0[i].ataque, promoted, abertasAqui, ativos, livre };
    });

    // plano: cada vaga -> confirmado (✓, cross marcado) OU vaga aberta + sugestão limpa. A vaga
    // vem de uma remoção (removido != null) ou de capacidade ociosa do grupo (removido == null).
    // Sugestões em 2 passes (não-ataque mesmo-ícone primeiro; ataque pega as sobras) — espelha
    // a prioridade da atribuição pra não "roubar" o mesmo-ícone de uma vaga não-ataque.
    const plano: { pt: string; iconKey: string | null; removido: PlayerConf | null; promovido: PlayerConf | null; cross: boolean; sugestao: PlayerConf | null; ataque: boolean }[] = [];
    for (let i = 0; i < grupos.length; i++) {
      const g = grupos[i];
      for (const s of gv0[i].slots) plano.push({ pt: g.nome, iconKey: g.iconKey, removido: s.removido, promovido: s.promovido, cross: s.cross, sugestao: null, ataque: gv0[i].ataque });
    }
    const usadosSug = new Set<string>(promovidoKeys);
    const sugerir = (r: (typeof plano)[number]) => {
      if (r.promovido) return;
      const w = listaEspera.find((c) => !isRem(c) && !usadosSug.has(chaveNome(c.nome)) && (r.ataque || (c.iconKey ?? null) === r.iconKey));
      if (w) { r.sugestao = w; usadosSug.add(chaveNome(w.nome)); }
    };
    for (const r of plano) if (!r.ataque) sugerir(r);
    for (const r of plano) if (r.ataque) sugerir(r);
    const sugeridoKeys = new Set(plano.filter((r) => r.sugestao).map((r) => chaveNome(r.sugestao!.nome)));
    // vaga livre sem ninguém sugerido/confirmado não vira linha — o card do grupo já mostra
    // "⏳ N vaga(s) aberta(s)". Sem isso um grupo 0/7 despejaria 7 linhas vazias no plano.
    const planoVisivel = plano.filter((r) => r.removido || r.promovido || r.sugestao);

    return { grupoView, plano: planoVisivel, promovidoKeys, promovidoPara, eligPorChave, sugeridoKeys };
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
    if (!canEdit) return;
    const k = chaveNome(w.nome);
    const cand = new Set(promovidos);
    const confirmando = !cand.has(k);
    if (confirmando) cand.add(k); else cand.delete(k);
    // cap global de vagas — confirma só se couber
    const prom = promovidosValidos(removidos, cand, grupos, listaEspera);
    if (confirmando && !prom.has(k)) return; // tentou subir mas não há vaga → ignora
    setPromovidos(prom);
    enviarOps([{ familia: w.nome, tipo: confirmando ? "subir" : null }]);
  }
  // subir de outra classe numa vaga não-ataque → confirma (aviso) antes
  function promoverCross(w: PlayerConf) {
    if (!canEdit) return;
    if (confirm(`⚠ ${w.nome} é de outra classe. Subir mesmo assim numa vaga de classe diferente?`)) togglePromover(w);
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

  const planoTexto = dados.plano.map((r) => {
    const de = r.removido ? `Sair: ${r.removido.nome}` : "Vaga livre";
    return r.promovido
      ? `${de}  →  SOBE: ${r.promovido.nome}${r.cross ? " (OUTRA CLASSE)" : ""}  (${r.pt})`
      : `${de}  →  vaga aberta${r.sugestao ? ` (sugerido: ${r.sugestao.nome})` : " (sem reserva)"}  (${r.pt})`;
  }).join("\n");

  function copiarPlano() {
    const p = navigator.clipboard?.writeText(planoTexto);
    if (!p) return;
    p.then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500); }).catch(() => {});
  }

  // linha de membro do grupo (✕ remover / ↺ desfazer), ou promovido confirmado (✓)
  const LinhaGrupo = ({ p, prom }: { p: PlayerConf; prom?: boolean }) => {
    const rem = isRem(p);
    const ok = conhecido(p);
    const cross = prom && dados.promovidoPara.get(chaveNome(p.nome))?.cross;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, opacity: rem ? 0.45 : 1 }}>
        <GuildIcon tag={p.tag} size={14} />
        <span style={{ color: rem ? C.vermelho : prom ? C.verde : ok ? C.texto : C.mute, textDecoration: rem ? "line-through" : "none" }}>
          {prom && <span style={{ color: C.verde }}>↑ </span>}{p.nome}
        </span>
        {cross && <span style={{ color: C.laranja, fontSize: 10 }} title="outra classe">⚠ outra classe</span>}
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
          ? "Marque ✕ em quem saiu — a vaga fica ABERTA. Confirme quem sobe: ✓ na sugestão ou ↑ na reserva. Vaga de Ataque aceita qualquer classe; nas outras, subir de outra classe pede confirmação (⚠). Salva e reseta junto com a war."
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
                {r.removido
                  ? <span style={{ color: C.vermelho, textDecoration: "line-through" }}>{r.removido.nome}</span>
                  : <span style={{ color: C.mute, fontStyle: "italic" }} title="capacidade ociosa do grupo — ninguém precisou sair">vaga livre</span>}
                <span style={{ color: C.mute }}>→</span>
                {r.promovido
                  ? <span style={{ color: C.verde }}>↑ {r.promovido.nome}{r.cross && <span style={{ color: C.laranja, fontSize: 11 }}> ⚠ outra classe</span>}</span>
                  : r.sugestao
                    ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: C.amarelo, fontSize: 11.5 }}>⏳ vaga aberta{r.ataque ? " (aceita qualquer)" : ""} · sugerido: <b style={{ color: C.texto }}>{r.sugestao.nome}</b></span>
                        {canEdit && <button onClick={() => r.sugestao && togglePromover(r.sugestao)} title="confirmar a sugestão" style={{ borderRadius: 6, border: `1px solid ${C.border2}`, background: C.verdeTint, color: C.verde, cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "1px 7px" }}>✓ confirmar</button>}
                      </span>
                    : <span style={{ color: C.amarelo, fontSize: 11.5 }}>⏳ vaga aberta{r.ataque ? " (aceita qualquer)" : ""} — sem reserva</span>}
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
              <span style={{ color: C.mute, fontSize: 11 }} title="ocupadas/limite (após remoções e promoções confirmadas)">{ativos}{g.limite != null ? `/${g.limite}` : ""}{livre > 0 ? ` · ${livre} livre` : ""}</span>
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
              const m = dados.promovidoPara.get(k); // {grupo, cross} | undefined
              const confirmado = !!m;
              const elig = confirmado ? undefined : dados.eligPorChave.get(k); // "limpo" | "cross" | undefined
              const limpo = elig === "limpo";
              const cross = elig === "cross";
              const sugerido = dados.sugeridoKeys.has(k);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                  <Icone iconKey={p.iconKey ?? null} size={13} />
                  <GuildIcon tag={p.tag} size={14} />
                  <span style={{ color: confirmado ? C.verde : C.texto }}>{confirmado && "↑ "}{p.nome}</span>
                  {m && <span style={{ color: C.verde, fontSize: 10.5 }}>p/ {m.grupo}{m.cross ? <span style={{ color: C.laranja }}> ⚠</span> : ""}</span>}
                  {canEdit && confirmado && (
                    <button onClick={() => togglePromover(p)} title="desfazer promoção" style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: C.mute, fontSize: 12, padding: "0 2px" }}>↺</button>
                  )}
                  {canEdit && limpo && (
                    <button onClick={() => togglePromover(p)} title={sugerido ? "subir (sugerido)" : "subir esta pessoa"}
                      style={{ marginLeft: "auto", borderRadius: 6, border: `1px solid ${sugerido ? C.verde : C.border2}`, background: sugerido ? C.verdeTint : "transparent", color: C.verde, cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "1px 7px", lineHeight: 1.4 }}>
                      {sugerido ? "✓ subir" : "↑"}
                    </button>
                  )}
                  {canEdit && cross && (
                    <button onClick={() => promoverCross(p)} title="subir numa vaga de OUTRA classe (pede confirmação)"
                      style={{ marginLeft: "auto", borderRadius: 6, border: `1px solid ${C.laranja}`, background: "transparent", color: C.laranja, cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "1px 6px", lineHeight: 1.4 }}>
                      ↑ outra ⚠
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
