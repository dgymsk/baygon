"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";

/**
 * Apagar o evento. Fica numa faixa própria no fim da página, longe do cabeçalho — encostar no
 * `↺ Limpar` é exatamente o engano a evitar.
 *
 * `confirm()` não serve aqui: ele não mostra número nenhum (a pessoa não sabe se está jogando fora
 * 2 escalados ou 24), Enter aceita sem ler, e não cabe nele a distinção que é o ponto inteiro —
 * o que SOME, o que FICA e o que CONTINUA VIVO no Discord.
 *
 * A palavra digitada é exigida só quando há trabalho manual a perder (escalação, presença,
 * resultado). Evento vazio não merece cerimônia.
 */
type Resumo = { escalacaoLinhas: number; emPt: number; aceitaramDm: number; recusaramDm: number; presencas: number; presencaDePrint: number; marcaram: number; warId: number | null; desempenhoOrfanado: number };

export default function ApagarEvento({ eventoId, titulo, temChamada }: { eventoId: number; titulo: string; temChamada: boolean }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [palavra, setPalavra] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");

  async function abrir() {
    setBusy(true); setErro("");
    try {
      const res = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "evento-resumo-exclusao", eventoId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((d as { error?: string }).error ?? `erro ${res.status}`);
      setResumo(d as Resumo); setAberto(true); setPalavra("");
    } catch (e) { setErro((e as Error).message); }
    finally { setBusy(false); }
  }

  // só pede a palavra quando há trabalho manual em jogo — o que dói perder
  const pesado = !!resumo && (resumo.escalacaoLinhas > 0 || resumo.presencas > 0 || resumo.warId != null);
  const liberado = !pesado || palavra.trim().toUpperCase() === "APAGAR";

  async function apagar() {
    if (!liberado || busy) return;
    setBusy(true); setErro("");
    try {
      const res = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "evento-excluir", eventoId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((d as { error?: string }).error ?? `erro ${res.status}`);
      const restos = ((d as { restos?: string[] }).restos ?? []);
      // replace, não push: Voltar não pode cair num evento que não existe mais
      const aviso = restos.length ? `?apagado=${encodeURIComponent(titulo)}&restos=${encodeURIComponent(restos.join(" · "))}` : `?apagado=${encodeURIComponent(titulo)}`;
      router.replace(`/hub${aviso}`);
    } catch (e) { setErro((e as Error).message); setBusy(false); }
  }

  if (!aberto) {
    return (
      <div style={faixa}>
        <span style={{ color: C.mute, fontSize: 12 }}>
          <b style={{ color: C.vermelho }}>Zona de risco</b> — apagar leva junto a escalação, as confirmações e a presença deste evento. Não tem desfazer.
        </span>
        <button onClick={abrir} disabled={busy}
          style={{ marginLeft: "auto", borderRadius: 8, border: `1px solid ${C.vermelho}`, background: "transparent", color: C.vermelho, padding: "5px 12px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
          {busy ? "…" : "🗑 Apagar evento"}
        </button>
        {erro && <span style={{ color: C.vermelho, fontSize: 12 }}>⚠ {erro}</span>}
      </div>
    );
  }

  return (
    <div style={{ ...faixa, flexDirection: "column", alignItems: "stretch", gap: 10, borderColor: C.vermelho }}>
      <div style={{ color: C.vermelho, fontWeight: 700, fontSize: 13.5 }}>Apagar “{titulo}”?</div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Bloco cor={C.vermelho} rot="Some — sem desfazer">
          <Li>escalação: <b>{resumo!.escalacaoLinhas}</b> linha(s){resumo!.emPt ? `, ${resumo!.emPt} em PT` : ""}</Li>
          <Li>convocação: <b>{resumo!.aceitaramDm}</b> aceitaram, <b>{resumo!.recusaramDm}</b> recusaram</Li>
          <Li>presença in-game: <b>{resumo!.presencas}</b>{resumo!.presencaDePrint ? ` (${resumo!.presencaDePrint} lidas de print)` : ""}</Li>
          <Li>o link <code>/hub/…</code> deste evento para de funcionar</Li>
        </Bloco>
        <Bloco cor={C.mute} rot="Fica">
          {resumo!.warId != null
            ? <Li>estatística da war <b>#{resumo!.warId}</b> ({resumo!.desempenhoOrfanado} linhas) — <b style={{ color: C.amarelo }}>mas sem evento, e não dá pra reatar pela tela</b></Li>
            : <Li>nenhuma estatística de war ligada</Li>}
          <Li>as <b>{resumo!.marcaram}</b> marcações da chamada, órfãs de evento</Li>
        </Bloco>
      </div>

      {temChamada && (
        <div style={{ color: C.amarelo, fontSize: 11.5 }}>
          No Discord: a chamada perde os botões e ganha um aviso, a lista publicada vira “escalação cancelada” e a thread da ordem é arquivada. Se alguma dessas falhar, eu digo qual.
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {pesado && (
          <>
            <span style={{ color: C.mute, fontSize: 12 }}>Digite <b style={{ color: C.texto }}>APAGAR</b>:</span>
            <input value={palavra} onChange={(e) => setPalavra(e.target.value)} autoFocus={false} placeholder="APAGAR"
              style={{ width: 120, background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "5px 9px", fontSize: 12.5, fontFamily: "inherit", outline: "none" }} />
          </>
        )}
        <button onClick={() => { setAberto(false); setErro(""); }} autoFocus
          style={{ marginLeft: "auto", borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: C.texto, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
          Cancelar
        </button>
        <button onClick={apagar} disabled={!liberado || busy}
          style={{ borderRadius: 8, border: `1px solid ${C.vermelho}`, background: liberado ? C.vermelho : "transparent", color: liberado ? "#0a0f0a" : C.borderSoft, padding: "6px 14px", fontSize: 12.5, fontWeight: 800, fontFamily: "inherit", cursor: liberado ? "pointer" : "not-allowed", opacity: busy ? 0.6 : 1 }}>
          {busy ? "apagando…" : "Apagar evento"}
        </button>
      </div>
      {erro && <span style={{ color: C.vermelho, fontSize: 12 }}>⚠ {erro}</span>}
    </div>
  );
}

const faixa = { border: `1px solid ${C.border2}`, borderRadius: 12, background: C.inputBg, padding: "10px 14px", marginTop: 22, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } as const;
const Bloco = ({ rot, cor, children }: { rot: string; cor: string; children: React.ReactNode }) => (
  <div style={{ flex: "1 1 300px" }}>
    <div style={{ color: cor, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{rot}</div>
    <ul style={{ margin: 0, paddingLeft: 16, color: C.mute, fontSize: 12, lineHeight: 1.6 }}>{children}</ul>
  </div>
);
const Li = ({ children }: { children: React.ReactNode }) => <li>{children}</li>;
