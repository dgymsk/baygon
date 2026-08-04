"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { chaveNome } from "@/lib/nomes";
import { canonicalizarNomes, type Cand } from "@/lib/casarNome";

/**
 * Confirmação in-game do evento — a MESMA conciliação do /confirmados, no contexto do hub.
 *
 * A leitura por visão erra nome com frequência, então o print não vira presença direto:
 *   1. cada nome lido passa pelo casamento com PRIORIDADE pro roster da war (quem marcou) sobre
 *      a tabela players — senão um typo histórico rouba o match de quem está de fato na war;
 *   2. o que ele corrigiu sozinho aparece na tela ("li X, entendi Y") pra você poder discordar;
 *   3. o que não bateu com ninguém fica pendente, com um seletor pra apontar o player certo —
 *      antes esses nomes sumiam calados, que é a pior falha possível aqui;
 *   4. só depois disso é que grava.
 */
type Alvo = { chave: string; familia: string; guilda: string | null; escalado: boolean; confirmouIngame: boolean };
type Lido = { familia: string; participar: boolean };
type Guilda = { id: string; tag: string; nome: string };

const fileToBase64 = (f: File) =>
  new Promise<{ mediaType: string; data: string }>((res, rej) => {
    const r = new FileReader();
    r.onerror = () => rej(new Error("não consegui ler o arquivo"));
    r.onload = () => { const s = String(r.result); const c = s.indexOf(","); res({ mediaType: f.type || "image/png", data: c >= 0 ? s.slice(c + 1) : s }); };
    r.readAsDataURL(f);
  });

export default function ConfirmacaoBoard({
  eventoId, alvos, playersNomes, guildas, canEdit,
}: { eventoId: number; alvos: Alvo[]; playersNomes: string[]; guildas: Guilda[]; canEdit: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [lidos, setLidos] = useState<Lido[] | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({}); // nome lido → player escolhido à mão
  const [prog, setProg] = useState("");
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  const porChave = useMemo(() => new Map(alvos.map((a) => [a.chave, a])), [alvos]);
  const tagPorId = useMemo(() => new Map(guildas.map((g) => [g.id, g.tag])), [guildas]);
  // roster da war primeiro: quem marcou tem prioridade sobre a tabela inteira de players
  const rosterCand: Cand[] = useMemo(() => alvos.map((a) => ({ chave: a.chave, nome: a.familia })), [alvos]);
  const playersCand: Cand[] = useMemo(() => playersNomes.map((n) => ({ chave: chaveNome(n), nome: n })), [playersNomes]);

  const conc = useMemo(() => {
    if (!lidos) return null;
    const vieram = lidos.filter((l) => l.participar);
    const { mapa, correcoes, naoEncontrados } = canonicalizarNomes(vieram.map((l) => l.familia), rosterCand, playersCand);
    // a escolha manual sobrepõe o que a heurística decidiu
    const resolvido = (lido: string) => manual[chaveNome(lido)] ?? mapa.get(chaveNome(lido)) ?? lido;
    const pendentes = naoEncontrados.filter((n) => !manual[chaveNome(n)]);
    const finais = new Map<string, string>(); // chave final → nome
    for (const l of vieram) {
      const nome = resolvido(l.familia);
      if (pendentes.some((p) => chaveNome(p) === chaveNome(l.familia))) continue; // não resolvido não entra
      finais.set(chaveNome(nome), nome);
    }
    const porGuilda: Record<string, number> = {};
    for (const g of guildas) porGuilda[g.tag] = 0;
    for (const k of finais.keys()) {
      const t = porChave.get(k)?.guilda;
      const tag = t ? tagPorId.get(t) : undefined;
      if (tag && tag in porGuilda) porGuilda[tag]++;
    }
    return {
      correcoes: correcoes.filter((c) => !manual[chaveNome(c.de)]),
      pendentes,
      finais,
      porGuilda,
      confirmam: alvos.filter((a) => finais.has(a.chave)),
      faltaram: alvos.filter((a) => a.escalado && !finais.has(a.chave)),
      foraDaLista: [...finais.entries()].filter(([k]) => !porChave.has(k)).map(([, n]) => n),
    };
  }, [lidos, manual, alvos, rosterCand, playersCand, porChave, guildas, tagPorId]);

  async function lerPrints(files: FileList | null) {
    if (!files?.length || !canEdit) return;
    setBusy(true); setErro("");
    const acc = new Map<string, Lido>(lidos?.map((l) => [chaveNome(l.familia), l]) ?? []);
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
      setProg(`${acc.size} nome(s) no total`);
    } catch (e) { setErro((e as Error).message); setProg(""); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function gravar() {
    if (!conc || !canEdit) return;
    setBusy(true);
    try {
      const membros = [...conc.finais.values()].map((familia) => ({ familia, participar: true }));
      const res = await fetch("/api/hub", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "presenca-print", eventoId, membros }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `erro ${res.status}`);
      setProg("presença gravada ✓"); setLidos(null); setManual({}); router.refresh();
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

  const jaConfirmados = alvos.filter((a) => a.confirmouIngame).length;
  const escaladosSem = alvos.filter((a) => a.escalado && !a.confirmouIngame).length;
  const opcoes = useMemo(() => [...playersNomes].sort((a, b) => a.localeCompare(b, "pt-BR")), [playersNomes]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={caixa}>
        <div style={{ color: C.mute, fontSize: 12, marginBottom: 10 }}>
          Manda o print da tela de <b style={{ color: C.texto }}>participação in-game</b> — mesma leitura do
          /confirmados. Isso registra quem <b style={{ color: C.verde }}>vai jogar</b>; a presença <b>oficial</b> só
          entra com as estatísticas de combate. Pode mandar vários prints, o último vence por nome.
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
            <input ref={inputRef} type="file" accept="image/*" multiple disabled={busy} onChange={(e) => lerPrints(e.target.files)} style={{ color: C.mute, fontSize: 12 }} />
            {prog && <span style={{ color: C.mute, fontSize: 12 }}>{prog}</span>}
            {lidos && <button onClick={() => { setLidos(null); setManual({}); setProg(""); }} style={btnCinza}>descartar leitura</button>}
            {erro && <span style={{ color: C.vermelho, fontSize: 12 }}>⚠ {erro}</span>}
          </div>
        )}
      </div>

      {conc && (
        <div style={caixa}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <span style={{ color: C.amarelo, fontWeight: 700, fontSize: 13.5 }}>
              Conferência — {conc.finais.size} resolvidos
              {guildas.map((g) => conc.porGuilda[g.tag] ? <span key={g.id} style={{ color: C.mute, fontWeight: 400, fontSize: 12 }}> · {g.tag} {conc.porGuilda[g.tag]}</span> : null)}
            </span>
            {canEdit && (
              <button onClick={gravar} disabled={busy || !!conc.pendentes.length} style={conc.pendentes.length ? btnCinza : btnVerde}
                title={conc.pendentes.length ? "resolva os nomes pendentes primeiro" : undefined}>
                Gravar presença
              </button>
            )}
          </div>

          {/* pendentes primeiro: são o que pode se perder calado */}
          {conc.pendentes.length > 0 && (
            <div style={{ border: `1px solid ${C.vermelho}`, borderRadius: 10, padding: "9px 11px", marginBottom: 11 }}>
              <div style={{ color: C.vermelho, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                {conc.pendentes.length} nome(s) que não bateram com ninguém — aponte o player ou eles ficam de fora
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 6 }}>
                {conc.pendentes.map((n) => (
                  <div key={n} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                    <span style={{ color: C.texto, minWidth: 96 }} title="como a visão leu">{n}</span>
                    <span style={{ color: C.mute }}>→</span>
                    <select defaultValue="" disabled={!canEdit} onChange={(e) => e.target.value && setManual((m) => ({ ...m, [chaveNome(n)]: e.target.value }))}
                      style={{ background: C.inputBg, color: C.texto, border: `1px solid ${C.border2}`, borderRadius: 7, padding: "3px 7px", fontSize: 12, fontFamily: "inherit", flex: 1 }}>
                      <option value="">escolher player…</option>
                      {opcoes.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {conc.correcoes.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: C.laranja, fontSize: 12, fontWeight: 700, marginBottom: 3 }}>Corrigidos automaticamente ({conc.correcoes.length})</div>
              <div style={{ color: C.mute, fontSize: 12 }}>{conc.correcoes.map((c) => `${c.de} → ${c.para}`).join("  ·  ")}</div>
            </div>
          )}

          <Bloco titulo={`Confirmaram (${conc.confirmam.length})`} cor={C.verde} nomes={conc.confirmam.map((a) => a.familia)} />
          <Bloco titulo={`Escalados que NÃO apareceram (${conc.faltaram.length})`} cor={C.vermelho} nomes={conc.faltaram.map((a) => a.familia)} />
          <Bloco titulo={`No print mas fora da chamada (${conc.foraDaLista.length})`} cor={C.laranja} nomes={conc.foraDaLista} />
        </div>
      )}

      <div style={caixa}>
        <div style={{ color: C.verde, fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Situação gravada</div>
        <div style={{ color: C.mute, fontSize: 11.5, marginBottom: 10 }}>
          {jaConfirmados} confirmado(s) · {escaladosSem} escalado(s) sem confirmar{canEdit && " · clique pra corrigir na mão"}
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
const btnCinza = { borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.mute, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" } as const;

function Bloco({ titulo, cor, nomes }: { titulo: string; cor: string; nomes: string[] }) {
  if (!nomes.length) return null;
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ color: cor, fontSize: 12, fontWeight: 700, marginBottom: 3 }}>{titulo}</div>
      <div style={{ color: C.mute, fontSize: 12 }}>{nomes.join(", ")}</div>
    </div>
  );
}
