"use client";

import Link from "next/link";
import { useState } from "react";
import { C } from "@/lib/theme";
import type { FunilEvento } from "@/lib/hub";

/**
 * Lista de eventos em sanfona. Card solto por evento ficava largo e repetitivo — com uma war por
 * dia a página virava uma parede de retângulos quase iguais.
 *
 * A linha fechada carrega só o que distingue um evento do outro (data, nome, status e o funil em
 * números). O detalhe — de onde veio, quem recusou, o que falta — só aparece quando você abre.
 */
const fmtData = (d: string) =>
  new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });

export default function EventosLista({ eventos }: { eventos: FunilEvento[] }) {
  const [aberto, setAberto] = useState<string | null>(eventos[0]?.uuid ?? null);

  if (!eventos.length) return null;

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, overflow: "hidden", marginBottom: 26 }}>
      {eventos.map((e, i) => {
        const on = aberto === e.uuid;
        const pendentes = Math.max(0, e.escalados - e.aceitaram - e.recusaram);
        return (
          <div key={e.uuid} style={{ borderTop: i ? `1px solid ${C.borderSoft}` : "none" }}>
            <button
              onClick={() => setAberto(on ? null : e.uuid)}
              style={{
                width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                background: on ? C.inputBg : "transparent", border: "none",
                padding: "10px 14px", color: C.texto,
              }}
            >
              <span style={{ color: C.mute, fontSize: 11, width: 12 }}>{on ? "▾" : "▸"}</span>
              <span style={{ color: C.mute, fontSize: 12, minWidth: 92 }}>{fmtData(e.data)}</span>
              <span style={{ fontWeight: 700, fontSize: 13.5, minWidth: 130 }}>{e.titulo}</span>
              <span style={{ color: C.mute, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 1 }}>{e.tipo}</span>
              {e.status !== "aberto" && <span style={{ color: C.amarelo, fontSize: 11 }}>🔒 {e.status}</span>}
              {e.resultado && (
                <span style={{ color: e.resultado === "vitoria" ? C.verde : e.resultado === "derrota" ? C.vermelho : C.mute, fontSize: 11 }}>{e.resultado}</span>
              )}
              {/* funil resumido: é o que diferencia um evento do outro de relance */}
              <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                <N n={e.marcaram} rot="marc" cor={C.texto} />
                <Seta />
                <N n={e.escalados} rot="esc" cor={C.texto} />
                <Seta />
                <N n={e.confirmaram} rot="in-game" cor={C.verde} />
                <Seta />
                {e.temWar ? <N n={e.jogaram} rot="jog" cor={C.amarelo} /> : <span style={{ color: C.borderSoft, fontSize: 10.5 }}>sem stat</span>}
              </span>
            </button>

            {on && (
              <div style={{ padding: "2px 14px 14px 36px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <Bloco rot="Marcaram no bot" v={e.marcaram} hint={e.naoVao ? `${e.naoVao} disseram que não vão` : undefined} />
                  <Bloco rot="Escalados" v={e.escalados} hint={pendentes ? `${pendentes} sem responder a convocação` : undefined} />
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
                  {e.presetNome && <span style={{ marginLeft: "auto", color: C.borderSoft, fontSize: 11 }}>chamada: {e.presetNome}</span>}
                </div>

                {!e.temWar && (
                  <div style={{ color: C.borderSoft, fontSize: 11 }}>
                    ⚠ Enquanto o resultado da war não for gravado, este evento não conta na estatística de falta.
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function N({ n, rot, cor }: { n: number; rot: string; cor: string }) {
  return <span style={{ display: "inline-flex", alignItems: "baseline", gap: 2 }}><b style={{ color: cor, fontSize: 13 }}>{n}</b><span style={{ color: C.mute, fontSize: 10 }}>{rot}</span></span>;
}
const Seta = () => <span style={{ color: C.borderSoft, fontSize: 10 }}>›</span>;

function Bloco({ rot, v, cor, hint }: { rot: string; v: number | null; cor?: string; hint?: string }) {
  return (
    <div style={{ border: `1px solid ${C.border2}`, borderRadius: 10, background: C.inputBg, padding: "7px 11px", minWidth: 130 }}>
      <div style={{ color: C.mute, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.8 }}>{rot}</div>
      <div style={{ color: v == null ? C.borderSoft : cor ?? C.texto, fontSize: 17, fontWeight: 800 }}>{v ?? "—"}</div>
      {hint && <div style={{ color: C.borderSoft, fontSize: 10.5, marginTop: 1 }}>{hint}</div>}
    </div>
  );
}
