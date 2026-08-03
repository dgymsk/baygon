"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { chaveNome } from "@/lib/nomes";

/**
 * Confirmação in-game do evento — mesma ideia do /confirmados do Apollo, mas no contexto do hub:
 * lê o print da tela de participação por VISÃO (/api/participar, o mesmo endpoint de lá) e concilia
 * com quem você escalou.
 *
 * O que interessa aqui é o CRUZAMENTO, não a lista solta:
 *   escalado e confirmou  → ok
 *   escalado e NÃO apareceu → é a falta que a estatística vai cobrar
 *   apareceu sem estar escalado → entrou por fora, você decide
 */
type Alvo = { chave: string; familia: string; escalado: boolean; confirmouIngame: boolean };
type Lido = { familia: string; participar: boolean };

const fileToBase64 = (f: File) =>
  new Promise<{ mediaType: string; data: string }>((res, rej) => {
    const r = new FileReader();
    r.onerror = () => rej(new Error("não consegui ler o arquivo"));
    r.onload = () => res({ mediaType: f.type || "image/png", data: String(r.result).split(",")[1] ?? "" });
    r.readAsDataURL(f);
  });

export default function ConfirmacaoBoard({ eventoId, alvos, canEdit }: { eventoId: number; alvos: Alvo[]; canEdit: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [lidos, setLidos] = useState<Lido[] | null>(null);
  const [prog, setProg] = useState("");
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  const porChave = useMemo(() => new Map(alvos.map((a) => [a.chave, a])), [alvos]);

  // cruzamento do que a visão leu com quem está escalado
  const cruz = useMemo(() => {
    if (!lidos) return null;
    const vieram = new Set(lidos.filter((l) => l.participar).map((l) => chaveNome(l.familia)));
    const conhecidos = new Set<string>(), forasteiros: string[] = [];
    for (const l of lidos.filter((x) => x.participar)) {
      const k = chaveNome(l.familia);
      if (porChave.has(k)) conhecidos.add(k); else forasteiros.push(l.familia);
    }
    return {
      confirmam: alvos.filter((a) => vieram.has(a.chave)),
      faltaram: alvos.filter((a) => a.escalado && !vieram.has(a.chave)),
      forasteiros,
      total: vieram.size,
    };
  }, [lidos, alvos, porChave]);

  async function lerPrints(files: FileList | null) {
    if (!files?.length || !canEdit) return;
    setBusy(true); setErro("");
    const acc = new Map<string, Lido>();
    try {
      for (let i = 0; i < files.length; i++) {
        setProg(`lendo print ${i + 1}/${files.length}…`);
        const image = await fileToBase64(files[i]);
        const res = await fetch("/api/participar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((d as { error?: string }).error ?? `erro ${res.status}`);
        for (const m of ((d as { membros?: Lido[] }).membros ?? [])) acc.set(chaveNome(m.familia), m); // último print vence
      }
      setLidos([...acc.values()]);
      setProg(`${acc.size} nome(s) lidos — confira e grave`);
    } catch (e) { setErro((e as Error).message); setProg(""); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function gravar() {
    if (!lidos || !canEdit) return;
    setBusy(true);
    try {
      const res = await fetch("/api/hub", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "presenca-print", eventoId, membros: lidos }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `erro ${res.status}`);
      setProg("presença gravada ✓"); setLidos(null); router.refresh();
    } catch (e) { setErro((e as Error).message); }
    finally { setBusy(false); }
  }

  async function toggle(a: Alvo) {
    if (!canEdit) return;
    await fetch("/api/hub", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "presenca-manual", eventoId, familia: a.familia, participar: !a.confirmouIngame }),
    });
    router.refresh();
  }

  const jaConfirmados = alvos.filter((a) => a.confirmouIngame);
  const escaladosSemConfirmar = alvos.filter((a) => a.escalado && !a.confirmouIngame);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={caixa}>
        <div style={{ color: C.mute, fontSize: 12, marginBottom: 10 }}>
          Mande o print da tela de <b style={{ color: C.texto }}>participação in-game</b> — a leitura é a mesma do
          /confirmados. Isso registra quem <b style={{ color: C.verde }}>vai jogar</b>; a presença <b>oficial</b> só
          entra depois, com as estatísticas de combate.
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
            <input ref={inputRef} type="file" accept="image/*" multiple disabled={busy} onChange={(e) => lerPrints(e.target.files)}
              style={{ color: C.mute, fontSize: 12 }} />
            {prog && <span style={{ color: C.mute, fontSize: 12 }}>{prog}</span>}
            {erro && <span style={{ color: C.vermelho, fontSize: 12 }}>⚠ {erro}</span>}
          </div>
        )}
      </div>

      {cruz && (
        <div style={caixa}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <span style={{ color: C.amarelo, fontWeight: 700, fontSize: 13.5 }}>Conferência — {cruz.total} apareceram no print</span>
            {canEdit && <button onClick={gravar} disabled={busy} style={btnVerde}>Gravar presença</button>}
          </div>
          <Bloco titulo={`Confirmaram (${cruz.confirmam.length})`} cor={C.verde} nomes={cruz.confirmam.map((a) => a.familia)} />
          {cruz.faltaram.length > 0 && (
            <Bloco titulo={`Escalados que NÃO apareceram (${cruz.faltaram.length})`} cor={C.vermelho} nomes={cruz.faltaram.map((a) => a.familia)} />
          )}
          {cruz.forasteiros.length > 0 && (
            <Bloco titulo={`No print mas fora da lista (${cruz.forasteiros.length})`} cor={C.laranja} nomes={cruz.forasteiros} />
          )}
        </div>
      )}

      <div style={caixa}>
        <div style={{ color: C.verde, fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Situação gravada</div>
        <div style={{ color: C.mute, fontSize: 11.5, marginBottom: 10 }}>
          {jaConfirmados.length} confirmado(s) · {escaladosSemConfirmar.length} escalado(s) sem confirmar
          {canEdit && " · clique pra corrigir na mão"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 5 }}>
          {alvos.map((a) => (
            <button key={a.chave} onClick={() => toggle(a)} disabled={!canEdit}
              style={{
                textAlign: "left", cursor: canEdit ? "pointer" : "default", fontFamily: "inherit",
                border: `1px solid ${a.confirmouIngame ? C.verde : a.escalado ? C.laranja : C.border2}`,
                background: a.confirmouIngame ? C.verdeTint : C.inputBg,
                borderRadius: 8, padding: "5px 9px", fontSize: 12.5, color: C.texto,
                display: "flex", alignItems: "center", gap: 6,
              }}>
              <span style={{ color: a.confirmouIngame ? C.verde : C.borderSoft }}>{a.confirmouIngame ? "✅" : "◻"}</span>
              {a.familia}
              {a.escalado && <span style={{ marginLeft: "auto", color: C.mute, fontSize: 10 }}>escalado</span>}
            </button>
          ))}
          {!alvos.length && <span style={{ color: C.borderSoft, fontSize: 12.5 }}>Ninguém marcou nesta chamada.</span>}
        </div>
      </div>
    </div>
  );
}

const caixa = { border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: 14 } as const;
const btnVerde = { borderRadius: 8, border: `1px solid ${C.border2}`, background: C.verdeTint, color: C.verde, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" } as const;

function Bloco({ titulo, cor, nomes }: { titulo: string; cor: string; nomes: string[] }) {
  if (!nomes.length) return null;
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ color: cor, fontSize: 12, fontWeight: 700, marginBottom: 3 }}>{titulo}</div>
      <div style={{ color: C.mute, fontSize: 12 }}>{nomes.join(", ")}</div>
    </div>
  );
}
