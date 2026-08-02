"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { chaveNome } from "@/lib/nomes";
import { C } from "@/lib/theme";
import { iconeUrl, type GuildEntry } from "@/lib/guild";

type Row = { familia: string; participar: boolean };

function fileToBase64(file: File): Promise<{ mediaType: string; data: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      const comma = s.indexOf(",");
      resolve({ mediaType: file.type || "image/png", data: comma >= 0 ? s.slice(comma + 1) : s });
    };
    r.onerror = () => reject(new Error("falha ao ler arquivo"));
    r.readAsDataURL(file);
  });
}

export default function ParticiparReconcile({
  confirmados, offBot, canEdit, statusInicial, posInicial, warKey, correcoesInit, naoEncontrados, guildas, totalBot, guildaDefs,
}: {
  confirmados: string[]; offBot: string[]; canEdit: boolean;
  statusInicial: Row[]; posInicial: boolean; warKey: string | null;
  correcoesInit: { de: string; para: string }[]; naoEncontrados: string[]; guildas: Record<string, string>;
  totalBot: Record<string, number>; guildaDefs: GuildEntry[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Row[]>(statusInicial);
  const [pos, setPos] = useState(posInicial);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState("");
  const [erro, setErro] = useState("");
  const [falhas, setFalhas] = useState<{ nome: string; erro: string }[]>([]);

  // re-sincroniza do servidor (outro PC subiu print / mudou o pós-liberação), sem atropelar upload local
  const recSig = useMemo(() => statusInicial.map((s) => `${chaveNome(s.familia)}:${s.participar ? 1 : 0}`).join("\n") + "##" + (posInicial ? 1 : 0), [statusInicial, posInicial]);
  const lastRecSig = useRef(recSig);
  useEffect(() => { // sem dep-array: re-tenta a cada render (pega o update após o upload)
    if (recSig === lastRecSig.current || busy) return;
    lastRecSig.current = recSig;
    setStatus(statusInicial);
    setPos(posInicial);
  });

  // colar imagem do clipboard (Windows Shift+S → Ctrl+V) entra na MESMA fila do upload
  const enqueueRef = useRef<(files: ArrayLike<File>) => void>(() => {});
  enqueueRef.current = enqueue;
  useEffect(() => {
    if (!canEdit) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imgs: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) imgs.push(f); }
      }
      if (imgs.length) { e.preventDefault(); enqueueRef.current(imgs); } // enfileira mesmo se já estiver lendo
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [canEdit]);

  // reconciliação (chave canônica em tudo)
  const participarRows = status.filter((s) => s.participar);
  const participarSet = new Set(participarRows.map((s) => chaveNome(s.familia)));
  const esperadoMap = new Map<string, string>();
  for (const n of confirmados) esperadoMap.set(chaveNome(n), n);
  for (const n of offBot) { const k = chaveNome(n); if (k && !esperadoMap.has(k)) esperadoMap.set(k, n); }
  const esperadoSet = new Set(esperadoMap.keys());
  const certo: string[] = [], faltaMarcar: string[] = [];
  for (const nome of esperadoMap.values()) (participarSet.has(chaveNome(nome)) ? certo : faltaMarcar).push(nome);
  // Participar in-game mas sem vaga (espera OU fora do bot): "deve retirar" (ou "roubou" se pós-liberação)
  const retirar: string[] = [];
  for (const s of participarRows) { if (!esperadoSet.has(chaveNome(s.familia))) retirar.push(s.familia); }

  // membros DO BOT que marcaram Participar, por guilda (p/ o "X de Y no bot")
  const conta: Record<string, number> = {};
  for (const g of guildaDefs) conta[g.tag] = 0;
  for (const nome of confirmados) {
    if (!participarSet.has(chaveNome(nome))) continue;
    const t = guildas[chaveNome(nome)];
    if (t && t in conta) conta[t]++;
  }

  async function togglePos() {
    if (!canEdit) return;
    const novo = !pos;
    setPos(novo); // otimista
    try {
      const res = await fetch("/api/participar/pos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ posLiberacao: novo, warKey }) });
      const j = await res.json().catch(() => ({} as { error?: string; posLiberacao?: boolean }));
      if (!res.ok) throw new Error(j.error || "falha ao salvar pós-liberação");
      setPos(!!j.posLiberacao); // valor autoritativo (servidor pode recusar: bot fora / war mudou)
      router.refresh(); // o board de PTs recomputa os "roubos" no servidor
    } catch (e) { setPos(!novo); setErro((e as Error).message); }
  }

  // FILA: cada print colado/enviado entra na fila e é processado em sequência (um lote
  // por vez), sem upload "em cima" do outro. Novos prints durante a leitura só estendem a fila.
  const filaRef = useRef<File[]>([]);
  const drenandoRef = useRef(false);
  async function enqueue(files: ArrayLike<File>) {
    const novos = Array.from(files);
    if (!canEdit || !novos.length) return;
    filaRef.current.push(...novos);
    if (inputRef.current) inputRef.current.value = "";
    if (drenandoRef.current) { setProg(`lendo… · ${filaRef.current.length} na fila`); return; } // já processando → só enfileira

    drenandoRef.current = true;
    setBusy(true); setErro(""); setFalhas([]);
    const falhasLocal: { nome: string; erro: string }[] = [];
    let salvou = false;
    let n = 0;
    try {
      while (filaRef.current.length) {
        const lote = filaRef.current; filaRef.current = []; // pega tudo que está na fila agora
        const map = new Map<string, Row>(); // dedupe do lote (último vence)
        for (let i = 0; i < lote.length; i++) {
          n++;
          setProg(`lendo print ${n}${filaRef.current.length ? ` · ${filaRef.current.length} na fila` : ""}…`);
          try {
            const image = await fileToBase64(lote[i]);
            const res = await fetch("/api/participar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
            const j = await res.json().catch(() => ({} as { error?: string; membros?: Row[] }));
            if (!res.ok) throw new Error(j.error || `erro ${res.status}`);
            for (const m of (j.membros ?? []) as Row[]) {
              const familia = (m.familia ?? "").replace(/\s+/g, " ").trim();
              const k = chaveNome(familia);
              if (k) map.set(k, { familia, participar: !!m.participar });
            }
          } catch (e) {
            falhasLocal.push({ nome: lote[i].name || `print ${n}`, erro: (e as Error).message });
          }
        }
        setFalhas(falhasLocal.slice()); // antes do save: lista de falhas não some se o save der erro
        if (map.size > 0) {
          setProg("salvando…");
          const save = await fetch("/api/participar/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ membros: [...map.values()], warKey }) });
          const sj = await save.json().catch(() => ({} as { error?: string; status?: Row[] }));
          if (!save.ok) throw new Error(sj.error || "falha ao salvar status");
          setStatus(sj.status ?? []);
          salvou = true;
        }
      }
      if (salvou) router.refresh(); // canonicaliza nomes + atualiza roubos/PT (uma vez no fim da fila)
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      filaRef.current = []; drenandoRef.current = false;
      setBusy(false); setProg("");
    }
  }

  async function resetar() {
    if (!confirm("Limpar o status “Participar” lido e recomeçar?")) return;
    setBusy(true); setErro(""); setFalhas([]);
    try {
      const res = await fetch("/api/participar/status", { method: "DELETE" });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error || "falha ao resetar"); }
      setStatus([]);
    } catch (e) { setErro((e as Error).message); } finally { setBusy(false); }
  }

  const copiar = (nomes: string[]) => navigator.clipboard?.writeText(nomes.join(", ")).catch(() => {});

  const Col = ({ titulo, cor, nomes, hint }: { titulo: string; cor: string; nomes: string[]; hint?: string }) => (
    <div style={{ flex: "1 1 240px", minWidth: 240, border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ color: cor, fontWeight: 700, fontSize: 13.5 }}>{titulo} <span style={{ color: C.mute }}>({nomes.length})</span></span>
        {nomes.length > 0 && <button onClick={() => copiar(nomes)} title="copiar nomes" style={{ background: "none", border: "none", color: C.mute, cursor: "pointer", fontSize: 12 }}>⧉ copiar</button>}
      </div>
      {hint && <div style={{ color: C.mute, fontSize: 11, marginBottom: 6 }}>{hint}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 8px" }}>
        {nomes.length === 0 ? <span style={{ color: C.borderSoft, fontSize: 12 }}>—</span>
          : nomes.map((nm) => <span key={nm} style={{ fontSize: 12.5, color: C.texto }}>{nm}</span>)}
      </div>
    </div>
  );

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "14px 16px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <div style={{ color: C.verde, fontWeight: 700, fontSize: 14 }}>Conferir “Participar” (in-game)</div>
        {canEdit && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={togglePos} title="Após 20:30 as vagas são liberadas: quem está com Participar e não é oficial conta como roubo de vaga (entra no visualizador de PT)."
              style={{ borderRadius: 8, border: `1px solid ${pos ? C.amarelo : C.border2}`, background: pos ? C.amareloTint : "transparent", color: pos ? C.amarelo : C.mute, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              🏴 Pós-liberação {pos ? "ON" : "OFF"}
            </button>
            <input ref={inputRef} type="file" accept="image/*" multiple
              onChange={(e) => e.target.files?.length && enqueue(e.target.files)} style={{ display: "none" }} id="participar-file" />
            <label htmlFor="participar-file" title={busy ? "pode ir colando/subindo mais — entram na fila" : ""}
              style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: busy ? C.inputBg : C.verdeTint, color: C.verde, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {busy ? (prog || "lendo…") : pos ? "📷 Subir prints finais" : "📷 Subir print(s)"}
            </label>
            {status.length > 0 && !busy && (
              <button onClick={resetar} title="limpar o status lido" style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.vermelho, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>↺ Reset</button>
            )}
          </div>
        )}
      </div>
      <div style={{ color: C.mute, fontSize: 11.5, marginBottom: status.length || erro ? 12 : 0 }}>
        {canEdit
          ? "Suba print(s) da janela de Guilda (coluna Guerra) — ou cole direto do clipboard (Shift+S → Ctrl+V). Pode ir colando vários seguidos: entram numa fila e são lidos em sequência. O status acumula — o mais recente vence. Reseta sozinho quando entra mensagem nova do bot; ou use ↺ Reset."
          : "Status lido pela staff. (Só staff sobe/reseta prints.)"}
      </div>

      {erro && <div style={{ color: C.vermelho, fontSize: 13, marginTop: 6, marginBottom: 8 }}>⚠ {erro}</div>}
      {falhas.length > 0 && (
        <div style={{ color: C.amarelo, fontSize: 12.5, marginTop: 6, marginBottom: 10, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "8px 11px", background: C.inputBg }}>
          <b>⚠ {falhas.length} print(s) falharam</b> — os outros foram lidos; re-suba só estes:
          <ul style={{ margin: "5px 0 0", paddingLeft: 18 }}>
            {falhas.map((f, i) => <li key={i} style={{ color: C.mute }}><b style={{ color: C.texto }}>{f.nome}</b> — {f.erro}</li>)}
          </ul>
        </div>
      )}
      {correcoesInit.length > 0 && (
        <div style={{ color: C.verde, fontSize: 12.5, marginTop: 6, marginBottom: 10, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "8px 11px", background: C.inputBg }}>
          <b>✏ {correcoesInit.length} nome(s) corrigido(s) por similaridade</b> — confira se bateu certo:
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", marginTop: 4 }}>
            {correcoesInit.map((c, i) => <span key={i} style={{ color: C.mute }}>{c.de} → <b style={{ color: C.texto }}>{c.para}</b></span>)}
          </div>
        </div>
      )}
      {naoEncontrados.length > 0 && (
        <div style={{ color: C.amarelo, fontSize: 12.5, marginTop: 6, marginBottom: 10, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "8px 11px", background: C.inputBg }}>
          <b>⚠ {naoEncontrados.length} nome(s) não bateram com ninguém</b> — leitura da IA pode estar errada{pos ? ", ou são roubo de vaga" : ""}. Confira:
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", marginTop: 4 }}>
            {naoEncontrados.map((n, i) => <span key={i} style={{ color: C.texto }}>{n}</span>)}
          </div>
        </div>
      )}

      {status.length === 0 ? (
        <div style={{ color: C.mute, fontSize: 13 }}>Nenhum print lido ainda{canEdit ? " — suba um print pra conferir." : "."}</div>
      ) : (
        <>
          <div style={{ color: C.mute, fontSize: 12, marginBottom: 10, display: "flex", alignItems: "center", flexWrap: "wrap", gap: "2px 10px" }}>
            <span><b style={{ color: C.texto }}>{status.length}</b> membros no status; <b style={{ color: C.texto }}>{participarRows.length}</b> com “Participar”.</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, borderLeft: `1px solid ${C.borderSoft}`, paddingLeft: 10 }}>
              <span style={{ color: C.verde, fontWeight: 700 }} title="quantos do bot marcaram Participar, de cada guilda / total da guilda no bot">Confirmados:</span>
              {guildaDefs.map((g) => { const u = iconeUrl(g.icone); return (
                <span key={g.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.texto }}>{u ? <img src={u} alt="" width={14} height={14} style={{ borderRadius: 3 }} /> : <span>{g.icone || g.tag}</span>} <b>{conta[g.tag] ?? 0}</b><span style={{ color: C.mute }}>/{totalBot[g.tag] ?? 0}</span></span>
              ); })}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <Col titulo="✅ Certo" cor={C.verde} nomes={certo} hint="Tem vaga (bot/fora) e marcou Participar" />
            <Col titulo={pos ? "⚠ Não marcou (perdeu?)" : "⚠ Falta marcar"} cor={C.amarelo} nomes={faltaMarcar} hint={pos ? "Tinha vaga e não marcou — pode ter perdido a vaga" : "Tem vaga, mas sem Participar → avisar p/ MARCAR"} />
            {pos ? (
              <Col titulo="🏴 Roubaram vaga" cor={C.laranja} nomes={retirar} hint="Pós-liberação: pegaram vaga in-game (não eram oficiais). Entram no visualizador de PT." />
            ) : (
              <Col titulo="⛔ Deve retirar" cor={C.vermelho} nomes={retirar} hint="Participar in-game mas sem vaga (espera ou fora do bot) → avisar p/ RETIRAR" />
            )}
          </div>
          <div style={{ color: C.mute, fontSize: 11, marginTop: 8 }}>
            Cruzamento por nome de família. Se um nome no jogo diferir do nome no bot, pode aparecer como divergência — confira esses casos.
          </div>
        </>
      )}
    </div>
  );
}
