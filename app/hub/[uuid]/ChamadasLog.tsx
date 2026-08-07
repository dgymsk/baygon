"use client";

import { useState } from "react";
import { C } from "@/lib/theme";
import type { LoteResumo } from "@/lib/loteDM";

/**
 * Log das CHAMADAS do evento — cada disparo de DM (convocação e cobrança do participar in-game),
 * com quem recebeu, quem não, por quê e quando.
 *
 * O relatório que vai pro canal de log serve pra staff ver na hora, mas afunda no meio das outras
 * mensagens. Aqui fica preso ao evento: dá pra abrir a guerra da semana passada e responder "essa
 * pessoa chegou a ser chamada?" sem rolar canal nenhum.
 *
 * O disparo mais recente abre sozinho (é o que a staff acabou de fazer e quer conferir); os
 * anteriores ficam fechados, mostrando só o placar — a lista nominal é o detalhe que se procura
 * quando alguém reclama, não o que se lê de relance.
 */
const hora = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const SINAL: Record<string, { icone: string; cor: string; rotulo: string }> = {
  ok: { icone: "✅", cor: "verde", rotulo: "recebeu" },
  falha: { icone: "⚠", cor: "amarelo", rotulo: "não recebeu" },
};

export default function ChamadasLog({ lotes }: { lotes: LoteResumo[] }) {
  const [aberto, setAberto] = useState<number | null>(lotes[0]?.id ?? null);

  if (!lotes.length) {
    return (
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 20, color: C.mute, fontSize: 13 }}>
        Nenhuma chamada disparada neste evento ainda. Quando você usar <b style={{ color: C.texto }}>📨 Convocar</b> ou
        <b style={{ color: C.texto }}> 🎮 Pedir participar</b>, cada disparo aparece aqui com quem recebeu e quem não.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {lotes.map((l) => {
        const emAberto = aberto === l.id;
        const cor = l.pendentes ? C.mute : l.falhas ? C.amarelo : C.verde;
        return (
          <div key={l.id} style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "11px 14px" }}>
            <div onClick={() => setAberto(emAberto ? null : l.id)}
              style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", cursor: "pointer" }}>
              <span style={{ color: C.borderSoft, fontSize: 11 }}>{emAberto ? "▾" : "▸"}</span>
              <span style={{ color: cor, fontWeight: 700, fontSize: 13 }}>📨 {l.rotulo}</span>
              <span style={{ color: C.mute, fontSize: 12 }}>{hora(l.criado)}</span>
              {l.publico && <span style={{ color: C.borderSoft, fontSize: 11.5 }}>· {l.publico}</span>}
              <span style={{ fontSize: 12.5 }}>
                <span style={{ color: C.verde }}>{l.enviados} recebeu(ram)</span>
                {l.falhas > 0 && <span style={{ color: C.amarelo, fontWeight: 700 }}> · {l.falhas} não</span>}
                <span style={{ color: C.mute }}> · {l.total} no total</span>
              </span>
              {l.pendentes > 0 && <span style={{ color: C.amarelo, fontSize: 11.5 }}>⏳ {l.pendentes} não chegaram a sair</span>}
              <span style={{ marginLeft: "auto", color: C.borderSoft, fontSize: 11 }}>
                {l.criadoPor ? `por ${l.criadoPor}` : "disparo automático"}
                {l.logOk === false && <span style={{ color: C.amarelo }}> · não foi pro canal de log{l.logErro ? ` (${l.logErro})` : ""}</span>}
              </span>
            </div>

            {emAberto && (
              <div style={{ marginTop: 9, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                {l.alvos.map((a) => {
                  const s = SINAL[a.status];
                  return (
                    <div key={a.familia} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5, flexWrap: "wrap" }}>
                      <span style={{ width: 16 }}>{s?.icone ?? "⏳"}</span>
                      <span style={{ color: C.texto, minWidth: 140 }}>{a.familia}</span>
                      <span style={{ color: a.status === "falha" ? C.amarelo : C.mute, flex: 1 }}>
                        {a.motivo ?? s?.rotulo ?? "na fila"}
                      </span>
                      <span style={{ color: C.borderSoft, fontSize: 11 }}>{hora(a.tentado)}</span>
                    </div>
                  );
                })}
                {!l.alvos.length && <span style={{ color: C.borderSoft, fontSize: 12 }}>sem destinatários registrados</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
