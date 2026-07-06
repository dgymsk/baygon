"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { chaveNome, acharSimilar } from "@/lib/nomes";
import { normalizarValor } from "@/lib/normalizarValor";
import { METRICAS_RESULTADO } from "@/lib/metricasResultado";
import { parseColado } from "@/lib/parseColado";

type Cell = { val: string; raw?: string };
type RowState = { key: string; familiaLida: string; nome_familia: string; valores: Record<string, Cell>; tocado?: boolean };
type ExtraiResp = { linhas?: { familiaLida: string; familia: string | null; valores: Record<string, { raw: string; valor: number | null }> }[]; error?: string };
export type StatIniciais = { nome_familia: string; valores: Record<string, number> };

function fileToBase64(file: File): Promise<{ mediaType: string; data: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); const c = s.indexOf(","); resolve({ mediaType: file.type || "image/png", data: c >= 0 ? s.slice(c + 1) : s }); };
    r.onerror = () => reject(new Error("falha ao ler arquivo"));
    r.readAsDataURL(file);
  });
}

// Faceta RESULTADO (parte 2): extrai os stats do print via Claude Opus, revisa e grava em wars/desempenho.
export default function ResultadoExtrair({ id, canEdit, players, warIdInicial, statsIniciais }: { id: number; canEdit: boolean; players: string[]; warIdInicial: number | null; statsIniciais?: StatIniciais[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  // pré-carrega os stats já gravados da war ligada (senão regravar seria replace-all destrutivo)
  const [linhas, setLinhas] = useState<RowState[]>(() =>
    (statsIniciais ?? []).map((s) => ({
      key: chaveNome(s.nome_familia) || s.nome_familia,
      familiaLida: s.nome_familia,
      nome_familia: s.nome_familia,
      tocado: true, // veio do banco → nome já é o player certo
      valores: Object.fromEntries(Object.entries(s.valores).map(([m, v]) => [m, { val: String(v) } as Cell])),
    })),
  );
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState("");
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");
  const [warId, setWarId] = useState<number | null>(warIdInicial);
  const [colarTxt, setColarTxt] = useState<string | null>(null); // null = fechado

  // candidatos p/ casar nome no client (chaveNome + acharSimilar são puros/client-safe)
  const cands = useMemo(() => players.map((p) => ({ chave: chaveNome(p), nome: p })), [players]);
  const casar = (nome: string): string => {
    const k = chaveNome(nome);
    return cands.find((c) => c.chave === k)?.nome ?? acharSimilar(k, cands)?.nome ?? "";
  };

  const setCell = (rk: string, metrica: string, val: string) =>
    setLinhas((prev) => prev.map((r) => (r.key === rk ? { ...r, valores: { ...r.valores, [metrica]: { ...r.valores[metrica], val } } } : r)));
  const setNome = (rk: string, nome: string) => setLinhas((prev) => prev.map((r) => (r.key === rk ? { ...r, nome_familia: nome, tocado: true } : r)));
  const removeRow = (rk: string) => setLinhas((prev) => prev.filter((r) => r.key !== rk));

  // Mescla itens (visão ou colagem) na tabela: dedupe por chave do nome LIDO. Só PREENCHE célula vazia
  // (nunca sobrescreve valor já presente/editado à mão) e PRESERVA a escolha de jogador da staff
  // (inclusive "— ignorar —"); rows nunca tocadas ainda aceitam auto-match de uma fonte posterior.
  type Item = { familiaLida: string; nome_familia: string; valores: Record<string, Cell> };
  function absorver(itens: Item[]) {
    if (!itens.length) return;
    setLinhas((prev) => {
      const acc = new Map<string, RowState>(prev.map((r) => [r.key, r]));
      for (const it of itens) {
        const key = chaveNome(it.familiaLida) || it.familiaLida;
        const ex = acc.get(key);
        const valores: Record<string, Cell> = ex ? { ...ex.valores } : {};
        for (const [m, c] of Object.entries(it.valores)) {
          if (!(c.val ?? "").trim()) continue;                       // fonte nova vazia não apaga o que já tem
          if (!ex || !(valores[m]?.val ?? "").trim()) valores[m] = c; // preenche só se row nova ou célula vazia
        }
        const nome_familia = ex ? (ex.tocado ? ex.nome_familia : (it.nome_familia || ex.nome_familia)) : it.nome_familia;
        acc.set(key, { key, familiaLida: it.familiaLida, nome_familia, tocado: ex?.tocado, valores });
      }
      return [...acc.values()];
    });
  }

  async function extrair(files: ArrayLike<File>) {
    const arr = Array.from(files);
    if (!canEdit || !arr.length) return;
    if (inputRef.current) inputRef.current.value = "";
    setBusy(true); setErro(""); setMsg("");
    try {
      for (let i = 0; i < arr.length; i++) {
        setProg(`lendo print ${i + 1}/${arr.length}…`);
        const image = await fileToBase64(arr[i]);
        const res = await fetch(`/api/eventos/${id}/resultado/extrair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
        const j = (await res.json().catch(() => ({}))) as ExtraiResp;
        if (!res.ok) throw new Error(j.error || `erro ${res.status}`);
        absorver((j.linhas ?? []).map((l) => ({
          familiaLida: l.familiaLida,
          nome_familia: l.familia || "",
          valores: Object.fromEntries(Object.entries(l.valores).map(([m, c]) => [m, { val: c.valor != null ? String(c.valor) : (c.raw ?? ""), raw: c.raw }])),
        })));
      }
    } catch (e) { setErro((e as Error).message); } finally { setBusy(false); setProg(""); }
  }

  function adicionarColado() {
    if (!canEdit) return;
    setErro(""); setMsg("");
    const parsed = parseColado(colarTxt ?? "");
    // mantém só linhas com ao menos 1 valor numérico (descarta cabeçalho/lixo)
    const itens: Item[] = [];
    for (const p of parsed) {
      const valores: Record<string, Cell> = {};
      let temNum = false;
      for (const [m, raw] of Object.entries(p.valores)) {
        const v = normalizarValor(raw);
        if (v == null || v === 0) continue; // 0 = ausência (igual à visão; não polui as médias/benchmarks)
        valores[m] = { val: String(v), raw };
        temNum = true;
      }
      if (temNum) itens.push({ familiaLida: p.familia, nome_familia: casar(p.familia), valores });
    }
    if (itens.length === 0) { setErro("nada reconhecido no texto colado (esperado: família + 15 colunas, separadas por TAB)"); return; }
    absorver(itens);
    setColarTxt(null);
    setMsg(`+${itens.length} linha(s) coladas`);
  }

  async function gravar() {
    if (!canEdit) return;
    const payload = linhas.filter((r) => r.nome_familia).map((r) => ({
      nome_familia: r.nome_familia,
      valores: Object.fromEntries(Object.entries(r.valores).map(([m, c]) => [m, normalizarValor(c.val)]).filter(([, v]) => v != null)),
    })).filter((r) => Object.keys(r.valores).length > 0);
    if (payload.length === 0) { setErro("nenhuma linha com jogador escolhido e valores"); return; }
    // 2+ linhas apontando pro mesmo jogador: uma sobrescreveria a outra ao gravar (perda silenciosa)
    const dups = [...new Set(payload.map((p) => p.nome_familia).filter((n, i, a) => a.indexOf(n) !== i))];
    if (dups.length) { setErro(`2+ linhas apontam pro mesmo jogador (${dups.join(", ")}) — junte numa linha só ou remova a duplicada`); return; }
    if (warId != null && !confirm(`Isto REGRAVA os stats da war #${warId} com as ${payload.length} linhas da tabela. Jogadores que não estiverem na tabela serão REMOVIDOS. Continuar?`)) return;
    setBusy(true); setErro(""); setMsg("");
    try {
      const res = await fetch(`/api/eventos/${id}/resultado/gravar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linhas: payload }) });
      const j = await res.json().catch(() => ({} as { error?: string; warId?: number; gravadas?: number; players?: number; ignorados?: string[] }));
      if (!res.ok) throw new Error(j.error || `erro ${res.status}`);
      setWarId(j.warId ?? null);
      setMsg(`✓ gravado — war #${j.warId}: ${j.players} jogadores, ${j.gravadas} valores${j.ignorados?.length ? ` · ignorados (não são players): ${j.ignorados.join(", ")}` : ""}`);
      router.refresh();
    } catch (e) { setErro((e as Error).message); } finally { setBusy(false); }
  }

  const semNome = linhas.filter((r) => !r.nome_familia).length;
  const th = { color: C.mute, fontSize: 10, fontWeight: 700, padding: "4px 5px", textAlign: "center" as const, whiteSpace: "nowrap" as const, borderBottom: `1px solid ${C.border2}` };
  const cellInput = { width: 62, background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 5, color: C.texto, padding: "3px 4px", fontSize: 11.5, textAlign: "right" as const, outline: "none" } as const;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        {canEdit && (
          <>
            <input ref={inputRef} type="file" accept="image/*" multiple onChange={(e) => e.target.files?.length && extrair(e.target.files)} style={{ display: "none" }} id="res-file" />
            <label htmlFor="res-file" style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: busy ? C.inputBg : C.verdeTint, color: C.verde, padding: "6px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              {busy ? (prog || "processando…") : "📷 Extrair do print (Opus)"}
            </label>
            {!busy && (
              <button onClick={() => setColarTxt(colarTxt == null ? "" : null)} style={{ borderRadius: 8, border: `1px solid ${colarTxt != null ? C.amarelo : C.border2}`, background: colarTxt != null ? C.amareloTint : "transparent", color: colarTxt != null ? C.amarelo : C.mute, padding: "6px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                {colarTxt != null ? "× fechar" : "📋 Colar da planilha"}
              </button>
            )}
            {linhas.length > 0 && !busy && (
              <>
                <button onClick={gravar} style={{ borderRadius: 8, border: `1px solid ${C.verde}`, background: C.verde, color: "#0a0f0a", padding: "6px 13px", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>💾 Gravar nos stats</button>
                <button onClick={() => setLinhas([])} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.vermelho, padding: "6px 11px", fontSize: 12, cursor: "pointer" }}>limpar</button>
              </>
            )}
          </>
        )}
        {warId != null && <span style={{ color: C.borderSoft, fontSize: 11.5 }}>stats ligados: war #{warId}</span>}
      </div>

      {canEdit && colarTxt != null && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: C.mute, fontSize: 11.5, marginBottom: 5 }}>Cole do Google Sheets (uma linha por jogador): <b style={{ color: C.texto }}>família</b> + as 15 colunas na ordem (kills, mortes, sequência, dano PvP, dano recebido, CCs, cura própria, cura aliados, dano pino, acerto/estruturas/distância canhão, armadilhas, tempo morto, tempo vivo). Tempo em mm:ss ou hh:mm:ss.</div>
          <textarea value={colarTxt} onChange={(e) => setColarTxt(e.target.value)} rows={7} placeholder={"ZRyotta\t11\t18\t2\t256800\t540300\t12\t335000\t46762\t1500000\t0\t0\t0\t0\t00:06:35\t00:24:28"}
            style={{ width: "100%", boxSizing: "border-box", background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "8px 10px", fontSize: 11.5, fontFamily: "'Share Tech Mono', monospace", outline: "none", resize: "vertical" }} />
          <div style={{ marginTop: 6 }}>
            <button onClick={adicionarColado} style={{ borderRadius: 8, border: `1px solid ${C.verde}`, background: C.verdeTint, color: C.verde, padding: "6px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Adicionar à tabela</button>
          </div>
        </div>
      )}

      {erro && <div style={{ color: C.vermelho, fontSize: 12.5, marginBottom: 8 }}>⚠ {erro}</div>}
      {msg && <div style={{ color: C.verde, fontSize: 12.5, marginBottom: 8 }}>{msg}</div>}

      {linhas.length === 0 ? (
        <div style={{ color: C.borderSoft, fontSize: 12.5 }}>{canEdit ? "Suba o print do resultado da war. A IA (Opus) transcreve os números; você revisa e grava. Pode subir vários prints (mescla por jogador)." : "Sem stats extraídos."}</div>
      ) : (
        <>
          {semNome > 0 && <div style={{ color: C.amarelo, fontSize: 12, marginBottom: 6 }}>⚠ {semNome} linha(s) sem jogador escolhido — não serão gravadas. Escolha no dropdown ou remova.</div>}
          <div style={{ color: C.mute, fontSize: 11, marginBottom: 6 }}>{linhas.length} linha(s). Valores já normalizados (635.1k→635100, 09:56→596s) — edite se a IA errou; passe o mouse pra ver o valor cru lido.</div>
          <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 10 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11.5 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, background: C.surface, zIndex: 1 }}>Jogador</th>
                  {METRICAS_RESULTADO.map((m) => <th key={m.metrica} style={th} title={m.dica}>{m.rotulo}</th>)}
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((r) => (
                  <tr key={r.key} style={{ background: r.nome_familia ? "transparent" : C.amareloTint }}>
                    <td style={{ padding: "3px 5px", position: "sticky", left: 0, background: r.nome_familia ? C.surface : C.amareloTint, zIndex: 1, borderRight: `1px solid ${C.border2}` }}>
                      <select value={r.nome_familia} onChange={(e) => setNome(r.key, e.target.value)} title={`lido: ${r.familiaLida}`}
                        style={{ background: C.inputBg, border: `1px solid ${r.nome_familia ? C.border2 : C.amarelo}`, borderRadius: 5, color: r.nome_familia ? C.texto : C.amarelo, padding: "3px 5px", fontSize: 11.5, outline: "none", maxWidth: 160 }}>
                        <option value="">— ignorar ({r.familiaLida}) —</option>
                        {players.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    {METRICAS_RESULTADO.map((m) => (
                      <td key={m.metrica} style={{ padding: "2px 3px" }}>
                        <input value={r.valores[m.metrica]?.val ?? ""} onChange={(e) => setCell(r.key, m.metrica, e.target.value)} title={r.valores[m.metrica]?.raw ? `lido: ${r.valores[m.metrica]?.raw}` : ""} style={cellInput} />
                      </td>
                    ))}
                    <td style={{ padding: "2px 4px", textAlign: "center" }}>
                      <button onClick={() => removeRow(r.key)} title="remover linha" style={{ background: "none", border: "none", color: C.mute, cursor: "pointer", fontSize: 13 }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
