"use client";

import Link from "next/link";
import { useState } from "react";
import { C, corDoResultado } from "@/lib/theme";
import { corTier } from "@/lib/tier";
import type { FunilEvento } from "@/lib/hub";

/**
 * Os eventos do hub. O primeiro — o mais recente, tenha vindo do bot ou da mão — fica FORA da
 * sanfona, sempre aberto: "focar no último" não pode depender de um `useState` inicial, que congela
 * e passa a apontar pro evento errado assim que entra um novo e a página se atualiza sozinha.
 *
 * O resto vira sanfona fechada. Card solto por evento virava uma parede de retângulos quase iguais
 * com uma war por dia; a linha fechada carrega só o que distingue um do outro, e o detalhe — quem
 * recusou, quem não respondeu, se a war foi gravada — só aparece quando você abre.
 */
const fmtData = (d: string) =>
  new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });

// as cores do resultado moram em lib/theme (CorResultado): a paleta do site tem `verde` e
// `vermelho` no MESMO carmesim, então vitória e derrota sairiam idênticas se usassem os tokens
// normais — este é o único lugar do app que precisa de semáforo de verdade

export default function EventosLista({ eventos }: { eventos: FunilEvento[] }) {
  const [aberto, setAberto] = useState<string | null>(null);

  if (!eventos.length) return null;
  const [atual, ...resto] = eventos;

  return (
    <div style={{ marginBottom: 26 }}>
      {/* o último evento fica sempre aberto; a cor do resultado entra por cima do destaque verde,
          que aqui significa "é este o atual" e não "venceu" */}
      <div style={{ border: `1px solid ${C.verde}`, borderLeft: `3px solid ${corDoResultado(atual.resultado)?.cor ?? C.verde}`, borderRadius: 12, background: corDoResultado(atual.resultado)?.fundo ?? C.surface, overflow: "hidden", marginBottom: resto.length ? 10 : 0 }}>
        <Cabecalho e={atual} atual />
        <Detalhe e={atual} />
      </div>

      {resto.length > 0 && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, overflow: "hidden" }}>
          {resto.map((e, i) => {
            const on = aberto === e.uuid;
            const cor = corDoResultado(e.resultado);
            return (
              <div key={e.uuid} style={{ borderTop: i ? `1px solid ${C.borderSoft}` : "none", background: cor?.fundo, borderLeft: cor ? `3px solid ${cor.cor}` : undefined }}>
                <button onClick={() => setAberto(on ? null : e.uuid)}
                  style={{ width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit", background: on ? C.inputBg : "transparent", border: "none", padding: 0, color: C.texto }}>
                  <Cabecalho e={e} seta={on ? "▾" : "▸"} />
                </button>
                {on && <Detalhe e={e} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Cabecalho({ e, atual = false, seta }: { e: FunilEvento; atual?: boolean; seta?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", color: C.texto }}>
      <span style={{ color: C.mute, fontSize: 11, width: 12 }}>{seta ?? ""}</span>
      <span style={{ color: C.mute, fontSize: 12, minWidth: 92 }}>{fmtData(e.data)}</span>
      <span style={{ fontWeight: 700, fontSize: atual ? 15 : 13.5, minWidth: 130 }}>{e.titulo}</span>
      {atual && <Selo cor={C.verde} fundo>último</Selo>}
      {e.chamadaAberta && <Selo cor={C.verde}>● chamada aberta</Selo>}
      {e.origem === "manual" && <Selo cor={C.mute}>manual</Selo>}
      {e.origem === "legado" && <Selo cor={C.mute}>bot antigo</Selo>}
      <span style={{ color: C.mute, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 1 }}>{e.tipo}</span>
      {e.tier && <Selo cor={corTier[e.tier]}>{e.tier}</Selo>}
      {e.status !== "aberto" && <span style={{ color: C.amarelo, fontSize: 11 }}>🔒 {e.status}</span>}
      {e.resultado && (
        <span style={{ color: corDoResultado(e.resultado)?.cor ?? C.mute, fontSize: 11, fontWeight: 700 }}>{e.resultado}</span>
      )}
      {/* funil resumido: é o que diferencia um evento do outro de relance */}
      <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
        <N n={e.marcaram} rot="marc" cor={C.texto} />
        <Seta />
        <N n={e.escalados} rot="esc" cor={C.texto} />
        <Seta />
        <N n={e.confirmaram} rot="in-game" cor={C.verde} />
        <Seta />
        {e.temWar ? <N n={e.jogaram} rot="jog" cor={C.amarelo} /> : <span style={{ color: C.dim, fontSize: 10.5 }}>sem stat</span>}
      </span>
    </div>
  );
}

function Detalhe({ e }: { e: FunilEvento }) {
  const semChamada = e.marcaram == null;
  return (
    <div style={{ padding: "2px 14px 14px 36px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Bloco rot={semChamada ? "Marcaram" : "Marcaram no bot"} v={e.marcaram}
          hint={semChamada ? "evento sem chamada — ninguém marcou" : e.naoVao ? `${e.naoVao} disseram que não vão` : undefined} />
        <Bloco rot="Escalados" v={e.escalados} hint={e.pendentes ? `${e.pendentes} sem responder a convocação` : undefined} />
        <Bloco rot="Aceitaram a convocação" v={e.aceitaram} cor={C.verde} hint={e.recusaram ? `${e.recusaram} recusaram` : undefined} />
        <Bloco rot="Confirmaram in-game" v={e.confirmaram} cor={C.verde} />
        <Bloco rot="Presença oficial" v={e.temWar ? e.jogaram : null} cor={C.amarelo}
          hint={e.temWar ? undefined : "resultado da war não gravado"} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
        <Link href={`/hub/${e.uuid}`} style={{ color: C.verde, textDecoration: "none", fontWeight: 700 }}>🧩 Escalação →</Link>
        <Link href={`/hub/${e.uuid}`} style={{ color: C.mute, textDecoration: "none" }}>✅ Confirmação</Link>
        <Link href={`/hub/${e.uuid}`} style={{ color: C.mute, textDecoration: "none" }}>📊 Estatísticas</Link>
        <Link href={`/eventos/${e.uuid}`} style={{ color: C.mute, textDecoration: "none" }}>Registro</Link>
        {e.presetNome
          ? <span style={{ marginLeft: "auto", color: C.dim, fontSize: 11 }}>chamada: {e.presetNome}</span>
          : <span style={{ marginLeft: "auto", color: C.amarelo, fontSize: 11 }}>⚠ sem chamada associada — a escalação abre sem PTs</span>}
      </div>

      {!e.temWar && (
        <div style={{ color: C.dim, fontSize: 11 }}>
          ⚠ Enquanto o resultado da war não for gravado, este evento não conta na estatística de falta.
        </div>
      )}
    </div>
  );
}

/** `null` vira "—", não 0: "ninguém marcou" e "não houve onde marcar" são coisas diferentes. */
function N({ n, rot, cor }: { n: number | null; rot: string; cor: string }) {
  return <span style={{ display: "inline-flex", alignItems: "baseline", gap: 2 }}><b style={{ color: n == null ? C.borderSoft : cor, fontSize: 13 }}>{n ?? "—"}</b><span style={{ color: C.mute, fontSize: 10 }}>{rot}</span></span>;
}
const Seta = () => <span style={{ color: C.dim, fontSize: 10 }}>›</span>;

const Selo = ({ children, cor, fundo = false }: { children: React.ReactNode; cor: string; fundo?: boolean }) => (
  <span style={{ color: cor, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, border: `1px solid ${cor}`, background: fundo ? C.verdeTint : "transparent", borderRadius: 999, padding: "1px 7px" }}>{children}</span>
);

function Bloco({ rot, v, cor, hint }: { rot: string; v: number | null; cor?: string; hint?: string }) {
  return (
    <div style={{ border: `1px solid ${C.border2}`, borderRadius: 10, background: C.inputBg, padding: "7px 11px", minWidth: 130 }}>
      <div style={{ color: C.mute, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.8 }}>{rot}</div>
      <div style={{ color: v == null ? C.borderSoft : cor ?? C.texto, fontSize: 17, fontWeight: 800 }}>{v ?? "—"}</div>
      {hint && <div style={{ color: C.dim, fontSize: 10.5, marginTop: 1 }}>{hint}</div>}
    </div>
  );
}
