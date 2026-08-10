"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { chaveNome, acharSimilar } from "@/lib/nomes";
import { normalizarValor } from "@/lib/normalizarValor";
import { metricasDoTipo } from "@/lib/metricasResultado";
import { parseColado } from "@/lib/parseColado";

type Cell = { val: string; raw?: string;
  /** outro print trouxe valor diferente pra esta célula. NUNCA somamos — é a mesma war lida duas
   *  vezes, então o esperado é bater; divergir significa que uma das leituras errou. */
  divergente?: string };
// novo = cadastrar familiaLida como player novo (guilda Manicômio); nome_familia = player existente escolhido.
type RowState = { key: string; familiaLida: string; nome_familia: string; valores: Record<string, Cell>; tocado?: boolean; novo?: boolean };
type ExtraiResp = { linhas?: { familiaLida: string; familia: string | null; valores: Record<string, { raw: string; valor: number | null }> }[]; error?: string };
export type StatIniciais = { nome_familia: string; valores: Record<string, number> };

const NOVO = "\u0000novo"; // sentinela do <option> "cadastrar novo" (não colide com nome real)

function fileToBase64(file: File): Promise<{ mediaType: string; data: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); const c = s.indexOf(","); resolve({ mediaType: file.type || "image/png", data: c >= 0 ? s.slice(c + 1) : s }); };
    r.onerror = () => reject(new Error("falha ao ler arquivo"));
    r.readAsDataURL(file);
  });
}

// Faceta RESULTADO (parte 2): extrai os stats do print via Claude Opus, revisa e grava em wars/desempenho.
export default function ResultadoExtrair({ id, canEdit, players, warIdInicial, statsIniciais, aliancasIniciais, ativo = true, foraIniciais = [], podeRegua, tipo = null }: { id: number; canEdit: boolean; players: string[]; warIdInicial: number | null; statsIniciais?: StatIniciais[]; aliancasIniciais?: string[];
  /** aba visível. As abas do hub ficam montadas pra não perder estado, então sem isto o Ctrl+V da
   *  conferência in-game cairia aqui também, e o print seria lido pelo extrator errado. */
  ativo?: boolean;
  foraIniciais?: string[];   // já marcados como fora da régua nesta war
  /**
   * Quem pode mexer na RÉGUA. Separado do `canEdit` de propósito: no hub o `canEdit` exige evento
   * aberto, e corrigir a régua de uma guerra passada é justamente o que se faz depois que ela
   * acabou — o servidor já deixa (a ação fica fora do gate de evento encerrado), era a tela que
   * escondia o botão. Sem valor explícito, segue o `canEdit`.
   */
  podeRegua?: boolean;
  /**
   * TIPO da guerra — decide QUAIS colunas a tabela desenha. Na Rosas o jogo só dá abates e mortes,
   * e desenhar as 15 seria pedir à staff que preenchesse 13 campos que o jogo nunca mostra.
   * O caminho de gravação é o mesmo pros dois: mesmas chaves de métrica, mesmo endpoint.
   */
  tipo?: string | null }) {
  const podeMexerRegua = podeRegua ?? canEdit;
  const METRICAS = metricasDoTipo(tipo);
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
  // alianças em campo: contexto que explica o resultado (perder pra duas grandes ≠ perder pra uma)
  const [aliancas, setAliancas] = useState<string[]>(aliancasIniciais ?? []);
  // o estado é semeado no MOUNT, e no hub esta aba fica montada o tempo todo (só escondida por
  // display:none). Sem ressincronizar, o que outra aba ou outro staff salvou nunca chegaria aqui —
  // e o gravar levaria a lista velha por cima. A chave é o conteúdo, não a identidade do array.
  const chaveAliancas = (aliancasIniciais ?? []).join("");
  useEffect(() => { setAliancas(aliancasIniciais ?? []); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [chaveAliancas]);
  const [aliancaTxt, setAliancaTxt] = useState("");

  /**
   * FORA DA RÉGUA, aqui na grade dos números salvos.
   *
   * O toggle já existia na tabela "Números da war" do hub, mas ESTA é a janela em que se olha o
   * número do jogador — é aqui que se percebe que ele está torto porque mandaram morrer. E em
   * /eventos esta grade é a única que existe, então lá não havia botão nenhum.
   *
   * Ressincroniza por CONTEÚDO, igual às alianças: no hub a aba fica montada (só escondida por
   * display:none), então sem isto o que outro staff marcou nunca chegaria nesta tela.
   */
  const [fora, setFora] = useState<string[]>(foraIniciais);
  const chaveFora = foraIniciais.join("|");
  useEffect(() => { setFora(foraIniciais); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [chaveFora]);
  const foraSet = useMemo(() => new Set(fora), [fora]);
  const [reguaOcupada, setReguaOcupada] = useState<string | null>(null);
  const [erroRegua, setErroRegua] = useState("");

  async function alternarRegua(nomeFamilia: string) {
    if (warId == null || !nomeFamilia) return;
    const alvo = !foraSet.has(nomeFamilia);
    setReguaOcupada(nomeFamilia); setErroRegua("");
    try {
      const res = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "war-fora-da-regua", warId, nomeFamilia, fora: alvo }) });
      const d = await res.json().catch(() => ({}));
      // 404 = o jogador não tem carimbo nesta war. Acontece com linha recém-adicionada e ainda não
      // gravada; dizer isso é melhor do que o botão não reagir e parecer quebrado.
      if (res.status === 404) throw new Error(`${nomeFamilia} ainda não está gravado nesta war — clique em Gravar antes de tirar da régua.`);
      if (!res.ok) throw new Error((d as { error?: string }).error ?? `erro ${res.status}`);
      const gravado = (d as { fora?: boolean }).fora === true;   // vale o que o SERVIDOR gravou
      setFora((p) => (gravado ? [...new Set([...p, nomeFamilia])] : p.filter((x) => x !== nomeFamilia)));
    } catch (e) { setErroRegua((e as Error).message); }
    finally { setReguaOcupada(null); }
  }

  function addAlianca(bruto: string) {
    // vírgula e ponto-e-vírgula viram separador: colar "Bloodline, Vortex" entra como duas
    const novas = bruto.split(/[,;]/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (!novas.length) return;
    setAliancas((prev) => {
      const out = [...prev];
      for (const n of novas) if (!out.some((x) => x.toLowerCase() === n.toLowerCase()) && out.length < 20) out.push(n.slice(0, 60));
      return out;
    });
    setAliancaTxt("");
  }

  /**
   * A lista final de alianças, JUNTANDO o que ainda está no campo.
   *
   * Não dá pra confiar no `onBlur` pra isso: blur dispara no mousedown do botão, o setState entra
   * na fila e o handler do clique pode ler o array antigo. Quem digitou "Bloodline" e clicou em
   * Gravar sem apertar Enter via o chip aparecer e mesmo assim gravava vazio.
   */
  function aliancasFinais(): string[] {
    const out = [...aliancas];
    for (const n of aliancaTxt.split(/[,;]/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean)) {
      if (!out.some((x) => x.toLowerCase() === n.toLowerCase()) && out.length < 20) out.push(n.slice(0, 60));
    }
    return out;
  }

  /** Grava SÓ as alianças, sem tocar na estatística — pra registrar o oponente antes do print. */
  async function salvarAliancas() {
    const lista = aliancasFinais();
    setBusy(true); setErro(""); setMsg("");
    try {
      const res = await fetch(`/api/eventos/${id}/resultado/gravar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soAliancas: true, aliancas: lista }),
      });
      const j = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) throw new Error(j.error || `erro ${res.status}`);
      setAliancas(lista); setAliancaTxt("");
      setMsg(lista.length ? `✓ alianças salvas: ${lista.join(", ")}` : "✓ alianças limpas");
      router.refresh();
    } catch (e) { setErro((e as Error).message); } finally { setBusy(false); }
  }

  // candidatos p/ casar nome no client (chaveNome + acharSimilar são puros/client-safe)
  const cands = useMemo(() => players.map((p) => ({ chave: chaveNome(p), nome: p })), [players]);
  const casar = (nome: string): string => {
    const k = chaveNome(nome);
    return cands.find((c) => c.chave === k)?.nome ?? acharSimilar(k, cands)?.nome ?? "";
  };

  const setCell = (rk: string, metrica: string, val: string) =>
    setLinhas((prev) => prev.map((r) => (r.key === rk ? { ...r, valores: { ...r.valores, [metrica]: { ...r.valores[metrica], val } } } : r)));
  const setNome = (rk: string, nome: string) => setLinhas((prev) => prev.map((r) => (r.key === rk ? { ...r, nome_familia: nome, novo: false, tocado: true } : r)));
  const setNovo = (rk: string) => setLinhas((prev) => prev.map((r) => (r.key === rk ? { ...r, nome_familia: "", novo: true, tocado: true } : r)));
  const removeRow = (rk: string) => setLinhas((prev) => prev.filter((r) => r.key !== rk));

  // Mescla itens (visão ou colagem) na tabela: dedupe por chave do nome LIDO. Só PREENCHE célula vazia
  // (nunca sobrescreve valor já presente/editado à mão) e PRESERVA a escolha de jogador da staff
  // (inclusive "— ignorar —"); rows nunca tocadas ainda aceitam auto-match de uma fonte posterior.
  type Item = { familiaLida: string; nome_familia: string; novo: boolean; valores: Record<string, Cell> };
  function absorver(itens: Item[]) {
    if (!itens.length) return;
    setLinhas((prev) => {
      const acc = new Map<string, RowState>(prev.map((r) => [r.key, r]));
      for (const it of itens) {
        const key = chaveNome(it.familiaLida) || it.familiaLida;
        const ex = acc.get(key);
        const valores: Record<string, Cell> = ex ? { ...ex.valores } : {};
        for (const [m, c] of Object.entries(it.valores)) {
          const novo = (c.val ?? "").trim();
          if (!novo) continue;                                       // fonte nova vazia não apaga o que já tem
          const atual = (valores[m]?.val ?? "").trim();
          if (!ex || !atual) { valores[m] = c; continue; }            // row nova ou célula vazia → preenche
          // a MESMA pessoa veio noutro print. Não soma e não sobrescreve: o primeiro valor fica e a
          // divergência aparece na célula, porque em tese os dois prints diziam a mesma coisa —
          // números diferentes significam que uma das leituras errou, e só a staff sabe qual.
          if (atual !== novo) valores[m] = { ...valores[m], divergente: novo };
        }
        // decisão de jogador (nome_familia/novo): row nova usa a do item; row tocada preserva a da staff;
        // row não-tocada aceita um match melhor de uma fonte posterior (senão mantém a decisão atual).
        let nome_familia: string, novo: boolean | undefined;
        if (!ex) { nome_familia = it.nome_familia; novo = it.novo; }
        else if (ex.tocado) { nome_familia = ex.nome_familia; novo = ex.novo; }
        else if (it.nome_familia && !ex.nome_familia) { nome_familia = it.nome_familia; novo = false; } // preenche só se ainda não casou (não troca um match por outro em silêncio)
        else { nome_familia = ex.nome_familia; novo = ex.novo; }
        acc.set(key, { key, familiaLida: it.familiaLida, nome_familia, novo, tocado: ex?.tocado, valores });
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
          novo: !l.familia, // não casou com player existente → cadastrar por default (staff pode trocar p/ ignorar)
          valores: Object.fromEntries(Object.entries(l.valores).map(([m, c]) => [m, { val: c.valor != null ? String(c.valor) : (c.raw ?? ""), raw: c.raw }])),
        })));
      }
    } catch (e) { setErro((e as Error).message); } finally { setBusy(false); setProg(""); }
  }

  /**
   * Ctrl+V com o print no clipboard (no Windows, Shift+Win+S recorta e já joga lá). Ouve no
   * DOCUMENTO porque ninguém clica num campo antes de colar.
   *
   * A ref existe porque o listener é registrado uma vez e capturaria o `extrair` do primeiro
   * render — que enxerga o estado inicial, não o de agora.
   */
  const extrairRef = useRef(extrair);
  useEffect(() => { extrairRef.current = extrair; });
  useEffect(() => {
    if (!canEdit || !ativo) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imgs: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) { const fl = it.getAsFile(); if (fl) imgs.push(fl); }
      }
      if (imgs.length) { e.preventDefault(); extrairRef.current(imgs); }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [canEdit, ativo]);

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
        // só ausência de verdade cai fora ("", "-"). Zero é dado e vai pra revisão: descartá-lo aqui
        // tirava a célula da tabela ANTES da staff poder olhar, e apagava o melhor resultado
        // possível das métricas menor_melhor (0 morte, 0 tempo morto)
        if (v == null) continue;
        valores[m] = { val: String(v), raw };
        temNum = true;
      }
      if (temNum) { const m = casar(p.familia); itens.push({ familiaLida: p.familia, nome_familia: m, novo: !m, valores }); }
    }
    if (itens.length === 0) { setErro("nada reconhecido no texto colado (esperado: família + 15 colunas, separadas por TAB)"); return; }
    absorver(itens);
    setColarTxt(null);
    setMsg(`+${itens.length} linha(s) coladas`);
  }

  async function gravar() {
    if (!canEdit) return;
    // nome efetivo: player escolhido, ou (se "cadastrar") o próprio nome lido → o servidor registra o player novo.
    const payload: { nome_familia: string; novo: boolean; valores: Record<string, number> }[] = [];
    for (const r of linhas) {
      const nome = r.novo ? r.familiaLida.trim() : r.nome_familia;
      if (!nome) continue; // "— ignorar —"
      const valores: Record<string, number> = {};
      for (const [m, c] of Object.entries(r.valores)) { const v = normalizarValor(c.val); if (v != null) valores[m] = v; }
      if (!Object.keys(valores).length) continue;
      payload.push({ nome_familia: nome, novo: !!r.novo, valores });
    }
    if (payload.length === 0) { setErro("nenhuma linha com jogador (escolhido/cadastrado) e valores"); return; }
    // 2+ linhas apontando pro mesmo jogador: uma sobrescreveria a outra ao gravar (perda silenciosa)
    const dups = [...new Set(payload.map((p) => p.nome_familia).filter((n, i, a) => a.indexOf(n) !== i))];
    if (dups.length) { setErro(`2+ linhas apontam pro mesmo jogador (${dups.join(", ")}) — junte numa linha só ou remova a duplicada`); return; }
    if (warId != null && !confirm(`Isto REGRAVA os stats da war #${warId} com as ${payload.length} linhas da tabela. Jogadores que não estiverem na tabela serão REMOVIDOS. Continuar?`)) return;
    setBusy(true); setErro(""); setMsg("");
    try {
      const res = await fetch(`/api/eventos/${id}/resultado/gravar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linhas: payload, aliancas: aliancasFinais() }) });
      const j = await res.json().catch(() => ({} as { error?: string; warId?: number; gravadas?: number; players?: number; cadastrados?: string[]; ignorados?: string[] }));
      if (!res.ok) throw new Error(j.error || `erro ${res.status}`);
      setWarId(j.warId ?? null);
      setMsg(`✓ gravado — war #${j.warId}: ${j.players} jogadores, ${j.gravadas} valores`
        + (j.cadastrados?.length ? ` · ➕ ${j.cadastrados.length} novo(s) em Membros, aguardando registro: ${j.cadastrados.join(", ")}` : "")
        + (j.ignorados?.length ? ` · ignorados: ${j.ignorados.join(", ")}` : ""));
      router.refresh();
    } catch (e) { setErro((e as Error).message); } finally { setBusy(false); }
  }

  const semNome = linhas.filter((r) => (r.novo ? !r.familiaLida.trim() : !r.nome_familia)).length; // não serão gravadas (ignorar, ou novo sem nome)
  const novosCount = linhas.filter((r) => r.novo && r.familiaLida.trim()).length;
  const divergentes = linhas.reduce((n, r) => n + Object.values(r.valores).filter((c) => c.divergente).length, 0);
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
        {warId != null && <span style={{ color: C.dim, fontSize: 11.5 }}>stats ligados: war #{warId}</span>}
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

      {canEdit && (
        <div style={{ border: `1px solid ${C.border2}`, borderRadius: 10, background: C.inputBg, padding: "9px 12px", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: C.mute, fontSize: 11.5, whiteSpace: "nowrap" }}>Alianças em campo:</span>
            {aliancas.map((a) => (
              <span key={a} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: `1px solid ${C.border2}`, borderRadius: 999, background: C.surface, color: C.texto, padding: "2px 6px 2px 10px", fontSize: 12 }}>
                {a}
                <button onClick={() => setAliancas((p) => p.filter((x) => x !== a))} title="remover"
                  style={{ background: "none", border: "none", color: C.mute, cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
              </span>
            ))}
            <input value={aliancaTxt} onChange={(e) => setAliancaTxt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addAlianca(aliancaTxt); } else if (e.key === "Backspace" && !aliancaTxt) setAliancas((p) => p.slice(0, -1)); }}
              onBlur={() => addAlianca(aliancaTxt)}
              placeholder={aliancas.length ? "+ outra…" : "ex: Bloodline, Vortex — Enter pra adicionar"}
              style={{ flex: "1 1 200px", minWidth: 160, background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "5px 9px", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
            <span style={{ color: C.dim, fontSize: 10.5, flex: "1 1 240px" }}>
              Quem estava em campo além da gente — é o contexto que explica o resultado. Vai junto ao gravar os stats,
              {warId != null ? " ou salve agora sem mexer na tabela." : " e passa a poder ser salvo sozinho depois da primeira gravação."}
            </span>
            {warId != null && (
              <button onClick={salvarAliancas} disabled={busy}
                title="grava só a lista de oponentes; não toca na estatística"
                style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.surface, color: C.verde, padding: "4px 11px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: busy ? "wait" : "pointer" }}>
                salvar alianças
              </button>
            )}
          </div>
        </div>
      )}

      {erro && <div style={{ color: C.vermelho, fontSize: 12.5, marginBottom: 8 }}>⚠ {erro}</div>}
      {msg && <div style={{ color: C.verde, fontSize: 12.5, marginBottom: 8 }}>{msg}</div>}

      {linhas.length === 0 ? (
        <div style={{ color: C.dim, fontSize: 12.5 }}>{canEdit ? (tipo === "rosas" ? "Cole o print da LISTA DE PARTICIPAÇÃO da Rosas com Ctrl+V (Nome · Cargo · Abates · Mortes), ou escolha o arquivo. A IA transcreve; você revisa e grava — quem estiver na lista é marcado como presente. Vários prints acumulam." : "Cole o print com Ctrl+V em qualquer lugar da página (Shift+Win+S pra recortar), ou escolha o arquivo. A IA (Opus) transcreve os números; você revisa e grava. Vários prints acumulam — mescla por jogador.") : "Sem stats extraídos."}</div>
      ) : (
        <>
          {novosCount > 0 && <div style={{ color: C.verde, fontSize: 12, marginBottom: 6 }}>➕ {novosCount} jogador(es) fora da base entram em <a href="/membros" style={{ color: C.verde }}><b>Membros</b></a> como <b>não registrados</b> (grupo Indefinido) ao gravar, e ficam ali até fazerem a jornada de registro — é só ajustar grupo/classe/guilda. Se algum for leitura errada, troque pra “— ignorar —”.</div>}
          {semNome > 0 && <div style={{ color: C.amarelo, fontSize: 12, marginBottom: 6 }}>⚠ {semNome} linha(s) marcadas “ignorar” — não serão gravadas.</div>}
          {divergentes > 0 && (
            <div style={{ color: C.laranja, fontSize: 12, marginBottom: 6 }}>
              ⚠ {divergentes} célula(s) em <b>laranja</b>: dois prints leram valores diferentes pra mesma pessoa. Vale o que está no campo — passe o mouse pra ver o outro e corrija se preciso. Nada é somado.
            </div>
          )}
          {erroRegua && <div style={{ color: C.vermelho, fontSize: 12, marginBottom: 6 }}>⚠ {erroRegua}</div>}
          {fora.length > 0 && (
            <div style={{ color: C.amarelo, fontSize: 12, marginBottom: 6 }}>
              ⊘ <b>{fora.length}</b> fora da régua nesta war ({fora.join(", ")}) — os números continuam aqui e no ranking, mas não entram nas médias (core, grupo e guilda).
            </div>
          )}
          <div style={{ color: C.mute, fontSize: 11, marginBottom: 6 }}>
            {linhas.length} linha(s). Valores já normalizados (635.1k→635100, 09:56→596s) — edite se a IA errou; passe o mouse pra ver o valor cru lido.
            {podeMexerRegua && warId != null && <> Clique no <b>○</b> ao lado do nome pra tirar alguém das médias desta war.</>}
          </div>
          <div className="rolx" style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 10 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11.5 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, background: C.surface, zIndex: 1 }}>Jogador</th>
                  {METRICAS.map((m) => <th key={m.metrica} style={th} title={m.dica}>{m.rotulo}</th>)}
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((r) => {
                  const modo = r.novo ? "novo" : r.nome_familia ? "ok" : "ignorar";
                  const rowBg = modo === "novo" ? C.verdeTint : modo === "ignorar" ? C.amareloTint : "transparent";
                  const selCor = modo === "novo" ? C.verde : modo === "ignorar" ? C.amarelo : C.texto;
                  const selBorda = modo === "novo" ? C.verde : modo === "ignorar" ? C.amarelo : C.border2;
                  return (
                  <tr key={r.key} style={{ background: rowBg }}>
                    <td style={{ padding: "3px 5px", position: "sticky", left: 0, background: modo === "ok" ? C.surface : rowBg, zIndex: 1, borderRight: `1px solid ${C.border2}`, whiteSpace: "nowrap" }}>
                      {/* ⊘ = fora da régua: o número dele continua nesta grade e no ranking, só não
                          entra nas médias desta war. É o caso de quem morreu a mando (segurar,
                          puxar, resetar) — o lixo estatístico é da ORDEM, não do jogador.
                          Só pra linha JÁ GRAVADA (modo "ok" + war existente): sem carimbo em
                          war_player não há o que marcar, e o servidor devolveria 404. */}
                      {podeMexerRegua && warId != null && modo === "ok" && (
                        <button onClick={() => alternarRegua(r.nome_familia)} disabled={reguaOcupada === r.nome_familia}
                          title={foraSet.has(r.nome_familia) ? "voltar a contar nas médias desta war" : "não contabilizar nas médias desta war (morreu a mando, testou build, etc.)"}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: "0 4px 0 0", fontSize: 11, color: foraSet.has(r.nome_familia) ? C.amarelo : C.borderSoft }}>
                          {foraSet.has(r.nome_familia) ? "⊘" : "○"}
                        </button>
                      )}
                      <select value={r.novo ? NOVO : r.nome_familia} title={`lido: ${r.familiaLida}`}
                        onChange={(e) => (e.target.value === NOVO ? setNovo(r.key) : setNome(r.key, e.target.value))}
                        style={{ background: C.inputBg, border: `1px solid ${selBorda}`, borderRadius: 5, color: selCor, padding: "3px 5px", fontSize: 11.5, outline: "none", maxWidth: 180 }}>
                        <option value={NOVO}>➕ Cadastrar novo: {r.familiaLida}</option>
                        <option value="">— ignorar ({r.familiaLida}) —</option>
                        {players.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    {METRICAS.map((m) => (
                      <td key={m.metrica} style={{ padding: "2px 3px" }}>
                        <input value={r.valores[m.metrica]?.val ?? ""} onChange={(e) => setCell(r.key, m.metrica, e.target.value)}
                          title={r.valores[m.metrica]?.divergente
                            ? `⚠ outro print leu ${r.valores[m.metrica]?.divergente} aqui — confira qual está certo`
                            : r.valores[m.metrica]?.raw ? `lido: ${r.valores[m.metrica]?.raw}` : ""}
                          style={r.valores[m.metrica]?.divergente ? { ...cellInput, borderColor: C.laranja, color: C.laranja } : cellInput} />
                      </td>
                    ))}
                    <td style={{ padding: "2px 4px", textAlign: "center" }}>
                      <button onClick={() => removeRow(r.key)} title="remover linha" style={{ background: "none", border: "none", color: C.mute, cursor: "pointer", fontSize: 13 }}>✕</button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
