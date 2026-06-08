"use client";

import { useRef, useState } from "react";
import { chaveNome } from "@/lib/nomes";
import { C } from "@/lib/theme";

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
  confirmados, espera, offBot, canEdit, statusInicial, warKey,
}: {
  confirmados: string[]; espera: string[]; offBot: string[]; canEdit: boolean;
  statusInicial: Row[]; warKey: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Row[]>(statusInicial);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState("");
  const [erro, setErro] = useState("");

  // reconciliação (chave canônica em tudo)
  const participarRows = status.filter((s) => s.participar);
  const participarSet = new Set(participarRows.map((s) => chaveNome(s.familia)));
  const espSet = new Set(espera.map(chaveNome));
  const esperadoMap = new Map<string, string>();
  for (const n of confirmados) esperadoMap.set(chaveNome(n), n);
  for (const n of offBot) { const k = chaveNome(n); if (k && !esperadoMap.has(k)) esperadoMap.set(k, n); }
  const esperadoSet = new Set(esperadoMap.keys());
  const certo: string[] = [], faltaMarcar: string[] = [];
  for (const nome of esperadoMap.values()) (participarSet.has(chaveNome(nome)) ? certo : faltaMarcar).push(nome);
  const retirarEspera: string[] = [], retirarFora: string[] = [];
  for (const s of participarRows) { const k = chaveNome(s.familia); if (esperadoSet.has(k)) continue; (espSet.has(k) ? retirarEspera : retirarFora).push(s.familia); }

  async function rodar(files: FileList) {
    setBusy(true); setErro("");
    try {
      const lote = new Map<string, Row>(); // dedupe do lote (último vence)
      const arr = Array.from(files);
      for (let i = 0; i < arr.length; i++) {
        setProg(`lendo print ${i + 1}/${arr.length}…`);
        const image = await fileToBase64(arr[i]);
        const res = await fetch("/api/participar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || `erro ${res.status}`);
        for (const m of (j.membros ?? []) as Row[]) {
          const familia = (m.familia ?? "").replace(/\s+/g, " ").trim();
          const k = chaveNome(familia);
          if (k) lote.set(k, { familia, participar: !!m.participar });
        }
      }
      setProg("salvando…");
      const save = await fetch("/api/participar/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ membros: [...lote.values()], warKey }) });
      const sj = await save.json();
      if (!save.ok) throw new Error(sj.error || "falha ao salvar status");
      setStatus(sj.status ?? []);
      setProg("");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function resetar() {
    if (!confirm("Limpar o status “Participar” lido e recomeçar?")) return;
    setBusy(true); setErro("");
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
            <input ref={inputRef} type="file" accept="image/*" multiple disabled={busy}
              onChange={(e) => e.target.files?.length && rodar(e.target.files)} style={{ display: "none" }} id="participar-file" />
            <label htmlFor="participar-file"
              style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: busy ? C.inputBg : C.verdeTint, color: C.verde, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer" }}>
              {busy ? (prog || "lendo…") : "📷 Subir print(s)"}
            </label>
            {status.length > 0 && !busy && (
              <button onClick={resetar} title="limpar o status lido" style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.vermelho, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>↺ Reset</button>
            )}
          </div>
        )}
      </div>
      <div style={{ color: C.mute, fontSize: 11.5, marginBottom: status.length || erro ? 12 : 0 }}>
        {canEdit
          ? "Suba print(s) da janela de Guilda (coluna Guerra). O status acumula entre prints — o mais recente vence. Reseta sozinho quando entra mensagem nova do bot; ou use ↺ Reset."
          : "Status lido pela staff. (Só staff sobe/reseta prints.)"}
      </div>

      {erro && <div style={{ color: C.vermelho, fontSize: 13, marginTop: 6, marginBottom: 8 }}>⚠ {erro}</div>}

      {status.length === 0 ? (
        <div style={{ color: C.mute, fontSize: 13 }}>Nenhum print lido ainda{canEdit ? " — suba um print pra conferir." : "."}</div>
      ) : (
        <>
          <div style={{ color: C.mute, fontSize: 12, marginBottom: 10 }}>
            <b style={{ color: C.texto }}>{status.length}</b> membros no status; <b style={{ color: C.texto }}>{participarRows.length}</b> com “Participar”.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <Col titulo="✅ Certo" cor={C.verde} nomes={certo} hint="Tem vaga (bot/fora) e marcou Participar" />
            <Col titulo="⚠ Falta marcar" cor={C.amarelo} nomes={faltaMarcar} hint="Tem vaga, mas sem Participar → avisar p/ MARCAR" />
            <Col titulo="⚠ Deve retirar (espera)" cor={C.amarelo} nomes={retirarEspera} hint="Participar in-game, mas na lista de espera → avisar p/ RETIRAR" />
            <Col titulo="⛔ Deve retirar (fora)" cor={C.vermelho} nomes={retirarFora} hint="Participar in-game, mas fora do bot → avisar p/ RETIRAR" />
          </div>
          <div style={{ color: C.mute, fontSize: 11, marginTop: 8 }}>
            Cruzamento por nome de família. Se um nome no jogo diferir do nome no bot, pode aparecer como divergência — confira esses casos.
          </div>
        </>
      )}
    </div>
  );
}
