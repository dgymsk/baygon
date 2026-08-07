"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import type { AgendaVM } from "@/lib/agenda";
import type { Preset } from "@/lib/intencaoPreset";

/**
 * Agenda de disparo — visão de semana. Cada linha é um HORÁRIO de um preset, com os dias em que
 * vale ("todo dia às 20:20" = uma linha com os 7 dias marcados).
 *
 * Quem acorda o disparo é o worker sempre-ligado, de 5 em 5 min — o Vercel Hobby não faz cron
 * sub-diário. Por isso o horário é aproximado: sai na primeira batida DEPOIS da hora marcada,
 * dentro de uma janela de 6 minutos.
 */
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export default function AgendaBoard({ agendas, presets, canEdit }: { agendas: AgendaVM[]; presets: Preset[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // {data} já vem preenchido porque é o padrão que a staff usa: o evento se chama pelo dia da GUERRA
  const [nova, setNova] = useState<{ presetId: string; hora: string; dias: number[]; nome: string }>({ presetId: "", hora: "20:20", dias: [0, 1, 2, 3, 4, 5, 6], nome: "{data}" });

  async function api(body: Record<string, unknown>, ok?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || (d as { error?: string }).error) throw new Error((d as { error?: string }).error ?? `erro ${res.status}`);
      if (ok) setMsg(ok);
      router.refresh();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  const toggleDia = (a: AgendaVM, d: number) => {
    if (!canEdit) return;
    const dias = a.dias.includes(d) ? a.dias.filter((x) => x !== d) : [...a.dias, d].sort();
    api({ acao: "agenda-editar", id: a.id, dias });
  };

  /** Grade semana × horário — dá pra ver conflito e buraco de relance. */
  const grade = useMemo(() => {
    const horas = [...new Set(agendas.map((a) => a.hora))].sort();
    return horas.map((h) => ({ hora: h, porDia: DIAS.map((_, d) => agendas.filter((a) => a.ativo && a.hora === h && a.dias.includes(d))) }));
  }, [agendas]);

  const card = { border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 16, marginBottom: 14 } as const;
  const input = { background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "6px 9px", fontSize: 12.5, outline: "none" } as const;
  const chipDia = (on: boolean) => ({ cursor: canEdit ? "pointer" : "default", borderRadius: 6, border: `1px solid ${on ? C.verde : C.borderSoft}`, background: on ? C.verdeTint : "transparent", color: on ? C.verde : C.mute, padding: "1px 6px", fontSize: 11, fontFamily: "inherit" } as const);

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <div style={{ color: C.verde, fontWeight: 700, fontSize: 14 }}>
          Agenda de disparo <span style={{ color: C.mute, fontWeight: 400, fontSize: 11.5 }}>— a chamada sai sozinha nos dias e horários marcados</span>
        </div>
        {msg && <span style={{ color: C.mute, fontSize: 12 }}>{msg}</span>}
      </div>
      <div style={{ color: C.borderSoft, fontSize: 11, marginBottom: 12 }}>
        Horário de Brasília. Quem acorda o disparo é o worker sempre-ligado (o Vercel não faz cron
        de hora em hora no plano atual), então sai na primeira checagem depois da hora — até ~5 min de atraso.
        Cada horário dispara <b>uma vez por dia</b>, mesmo que o worker bata várias.
        O <b>nome</b> batiza o evento criado: <code style={{ color: C.amarelo }}>{"{data}"}</code> vira
        a data da guerra — que é sempre <b>o dia seguinte</b>, já que a chamada sai na véspera. Vazio usa o nome da chamada.
      </div>

      {agendas.length > 0 && (
        <div style={{ overflowX: "auto", marginBottom: 14 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: C.mute, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 1 }}>
                <th style={{ textAlign: "left", padding: "5px 10px" }}>hora</th>
                {DIAS.map((d) => <th key={d} style={{ padding: "5px 10px" }}>{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {grade.map((g) => (
                <tr key={g.hora} style={{ borderTop: `1px solid ${C.borderSoft}` }}>
                  <td style={{ padding: "5px 10px", color: C.amarelo, fontWeight: 700 }}>{g.hora}</td>
                  {g.porDia.map((lista, d) => (
                    <td key={d} style={{ padding: "5px 10px", textAlign: "center", color: lista.length ? C.verde : C.borderSoft }}>
                      {lista.length ? lista.map((a) => a.preset_nome).join(", ") : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 12 }}>
        {agendas.map((a) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", border: `1px solid ${C.border2}`, borderRadius: 9, padding: "7px 10px", background: a.ativo ? C.inputBg : "transparent", opacity: a.ativo ? 1 : 0.55 }}>
            <span style={{ color: C.amarelo, fontWeight: 700, fontSize: 13 }}>{a.hora}</span>
            <span style={{ color: C.texto, fontSize: 12.5, minWidth: 110 }}>{a.preset_nome}</span>
            <span style={{ display: "inline-flex", gap: 3 }}>
              {DIAS.map((d, i) => <button key={i} onClick={() => toggleDia(a, i)} disabled={!canEdit} style={chipDia(a.dias.includes(i))}>{d}</button>)}
            </span>
            {/* sem estado controlado: só grava ao sair do campo, senão seria um POST por tecla */}
            {canEdit
              ? <input defaultValue={a.nome_padrao ?? ""} placeholder={a.preset_nome} title="nome do evento criado — {data} vira a data da guerra (o dia seguinte)"
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== (a.nome_padrao ?? "")) api({ acao: "agenda-editar", id: a.id, nomePadrao: v }, "nome salvo"); }}
                  style={{ ...input, width: 120, padding: "3px 7px", fontSize: 12 }} />
              : a.nome_padrao && <span style={{ color: C.mute, fontSize: 11.5 }}>{a.nome_padrao}</span>}
            {a.ultimo_disparo && <span style={{ color: C.borderSoft, fontSize: 10.5 }}>último: {a.ultimo_disparo.slice(0, 16).replace("T", " ")}</span>}
            {canEdit && (
              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
                <button onClick={() => api({ acao: "agenda-editar", id: a.id, ativo: !a.ativo })} disabled={busy}
                  style={{ background: "none", border: "none", cursor: "pointer", color: a.ativo ? C.verde : C.mute, fontSize: 12 }}>
                  {a.ativo ? "⏸ pausar" : "▶ ativar"}
                </button>
                <button onClick={() => confirm(`Excluir o disparo das ${a.hora} de ${a.preset_nome}?`) && api({ acao: "agenda-excluir", id: a.id })} disabled={busy}
                  style={{ background: "none", border: "none", cursor: "pointer", color: C.vermelho, fontSize: 12 }}>✕</button>
              </span>
            )}
          </div>
        ))}
        {!agendas.length && <span style={{ color: C.borderSoft, fontSize: 12.5 }}>Nenhum disparo agendado — a chamada só sai no botão.</span>}
      </div>

      {canEdit && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: `1px solid ${C.borderSoft}`, paddingTop: 11 }}>
          <select value={nova.presetId} onChange={(e) => setNova({ ...nova, presetId: e.target.value })} style={{ ...input, cursor: "pointer" }}>
            <option value="">escolha a chamada…</option>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.nome} · {p.tipo}</option>)}
          </select>
          <input type="time" value={nova.hora} onChange={(e) => setNova({ ...nova, hora: e.target.value })} style={{ ...input, width: 105 }} />
          <input value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} placeholder="nome do evento"
            title="nome do evento criado — {data} vira a data da guerra (o dia seguinte)" style={{ ...input, width: 130 }} />
          <span style={{ display: "inline-flex", gap: 3 }}>
            {DIAS.map((d, i) => (
              <button key={i} onClick={() => setNova({ ...nova, dias: nova.dias.includes(i) ? nova.dias.filter((x) => x !== i) : [...nova.dias, i].sort() })}
                style={chipDia(nova.dias.includes(i))}>{d}</button>
            ))}
          </span>
          <button disabled={busy || !nova.presetId || !nova.dias.length}
            onClick={() => { api({ acao: "agenda-criar", presetId: Number(nova.presetId), dias: nova.dias, hora: nova.hora, nomePadrao: nova.nome }, "disparo agendado"); }}
            style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: C.verde, padding: "6px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
            + Agendar
          </button>
        </div>
      )}
    </div>
  );
}
