"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import type { CronConfig, CronExec, ResumoCron } from "@/lib/cronLog";

/**
 * AUTOMAÇÃO — quem dispara a chamada, quando bateu pela última vez, e o que dá pra mexer sem deploy.
 *
 * A pergunta que esta caixa responde não é "qual o cron": é "a chamada vai sair?". Por isso ela abre
 * dizendo QUANDO sai a próxima, e põe lado a lado as duas fontes que batem no mesmo endpoint — o
 * worker sempre-ligado e o cron da Vercel — com a contagem das últimas 24h. Cada um bate a cada 5
 * minutos, ou seja ~288 por dia: o que morreu aparece como zero enquanto o outro continua, sem
 * ninguém abrir log nenhum.
 *
 * O que É controlável aqui: ligar/desligar a rede de segurança, o atraso que ela aceita, e rodar
 * agora. O que NÃO é: o horário das entradas — cron da Vercel vive no vercel.json e só muda com
 * deploy. A lista abaixo é lida do próprio arquivo, pra tela nunca discordar do que está no ar.
 */
const VERDE = "#3fbf5f";
const OURO = "#e0bd3a";

/** O texto do banco vem "2026-08-26 12:00:00+00"; o T é o que faz o Date aceitar em todo navegador. */
const quando = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return null;
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  const rel = min < 1 ? "agora" : min < 60 ? `há ${min} min` : min < 60 * 24 ? `há ${Math.round(min / 60)} h` : `há ${Math.round(min / 1440)} d`;
  return { rel, exato: d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) };
};

const ROTULO_ORIGEM: Record<string, string> = { worker: "worker", vercel: "cron da Vercel", manual: "à mão" };

/** Nome humano de cada endpoint automático — a tela não pode falar em rota. */
const TAREFA: Record<string, string> = {
  "/api/intencao/cron": "Disparo da chamada",
  "/api/garmoth/refresh": "Atualização de gear (Garmoth)",
};

/** "a cada 5 min", "a cada 2 h", "todo dia 21:00" — o que a expressão de cron quer dizer. */
function cadencia(expr: string): string {
  const [min, hora] = expr.trim().split(/\s+/);
  const m = /^\*\/(\d+)$/.exec(min ?? "");
  if (m && hora === "*") return `a cada ${m[1]} min`;
  const h = /^\*\/(\d+)$/.exec(hora ?? "");
  if (h && /^\d+$/.test(min ?? "")) return `a cada ${h[1]} h`;
  if (/^\d+$/.test(min ?? "") && /^\d+$/.test(hora ?? "")) {
    const brt = (Number(hora) - 3 + 24) % 24;   // o cron é UTC; aqui é UTC-3
    return `todo dia ${String(brt).padStart(2, "0")}:${String(Number(min)).padStart(2, "0")}`;
  }
  return expr;
}

export default function CronBoard({ entradas, cfg, resumo, execs, canEdit, nAgendas, proximo }: {
  entradas: { path: string; schedule: string }[];
  cfg: CronConfig; resumo: ResumoCron[]; execs: CronExec[]; canEdit: boolean; nAgendas: number;
  proximo: { quando: string; emMin: number; preset: string; hoje: boolean } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ativo, setAtivo] = useState(cfg.ativo);
  const [tol, setTol] = useState(String(cfg.toleranciaMin));

  async function api(body: Record<string, unknown>, ok?: string) {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || d.error) throw new Error((d.error as string) ?? `erro ${res.status}`);
      if (ok) setMsg(ok);
      router.refresh();
      return d;
    } catch (e) { setMsg((e as Error).message); return null; }
    finally { setBusy(false); }
  }

  const agenda = resumo.find((r) => r.endpoint === "/api/intencao/cron");
  const ult = quando(agenda?.ultima ?? null);

  const cx = { borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, padding: "5px 11px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: canEdit ? "pointer" : "default" } as const;

  return (
    <div style={{ marginTop: 14, border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: "11px 13px" }}>
      <div className="leg" style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 9 }}>
        Automação — quem dispara a chamada
      </div>

      {/* sem agenda cadastrada, o cron varre e não acha nada. É o primeiro diagnóstico da tela. */}
      {nAgendas === 0 && (
        <div style={{ border: `1px solid ${OURO}`, background: "rgba(214,178,42,.10)", borderRadius: 8, padding: "8px 10px", marginBottom: 10, color: C.texto, fontSize: 12.5 }}>
          ⚠ <b>Nenhum agendamento ativo.</b> O disparo automático não tem o que disparar — crie um horário na agenda acima.
        </div>
      )}

      {/* O QUE A STAFF QUER SABER PRIMEIRO: quando sai a próxima. Calculado no servidor a partir
          das agendas (lib/agenda.proximoDisparo), então bate com o que o disparo vai fazer. */}
      {nAgendas > 0 && (
        <div style={{ marginBottom: 11, fontSize: 13, color: C.texto }}>
          Próximo disparo:{" "}
          {proximo ? (
            <>
              <b style={{ color: VERDE }}>{proximo.hoje ? `hoje ${proximo.quando.split(" ")[1]}` : proximo.quando}</b>
              <span style={{ color: C.mute }}> · em {proximo.emMin < 60 ? `${proximo.emMin} min` : `${Math.floor(proximo.emMin / 60)}h${String(proximo.emMin % 60).padStart(2, "0")}`} · {proximo.preset}</span>
            </>
          ) : <span style={{ color: C.mute }}>nenhum — as agendas ativas não têm dia marcado</span>}
        </div>
      )}

      {/* as duas fontes, lado a lado: é a contagem de 24h que denuncia worker parado */}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 11 }}>
        <div>
          <div style={{ color: agenda && agenda.worker24h > 0 ? VERDE : C.vermelho, fontSize: 19, fontWeight: 700, lineHeight: 1.1 }}>{agenda?.worker24h ?? 0}</div>
          <div className="leg" style={{ color: C.dim, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6 }} title="o worker sempre-ligado bate a cada 5 min: ~288 por dia. Zero = ele está fora do ar — e no plano Pro o cron da Vercel já cobre isso sozinho.">worker · 24h</div>
        </div>
        <div>
          <div style={{ color: agenda && agenda.vercel24h > 0 ? VERDE : C.mute, fontSize: 19, fontWeight: 700, lineHeight: 1.1 }}>{agenda?.vercel24h ?? 0}</div>
          <div className="leg" style={{ color: C.dim, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6 }} title="o cron da Vercel, a cada 5 minutos (plano Pro): ~288 por dia">cron · 24h</div>
        </div>
        <div>
          <div style={{ color: agenda?.falhas24h ? C.vermelho : C.mute, fontSize: 19, fontWeight: 700, lineHeight: 1.1 }}>{agenda?.falhas24h ?? 0}</div>
          <div className="leg" style={{ color: C.dim, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6 }}>falhas · 24h</div>
        </div>
        <div>
          <div style={{ color: C.texto, fontSize: 13, fontWeight: 700, lineHeight: 1.4 }} title={ult?.exato ?? ""}>{ult ? ult.rel : "nunca"}</div>
          <div className="leg" style={{ color: C.dim, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6 }}>última batida{agenda?.ultimaOrigem ? ` · ${ROTULO_ORIGEM[agenda.ultimaOrigem] ?? agenda.ultimaOrigem}` : ""}</div>
        </div>
      </div>

      {/* o que dá pra mexer SEM deploy */}
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginBottom: 11 }}>
        <button disabled={!canEdit || busy} style={{ ...cx, color: ativo ? VERDE : C.mute, borderColor: ativo ? VERDE : C.border2 }}
          title="quando desligada, o cron da Vercel registra a batida e não posta nada — e como hoje é ele quem dispara, a chamada automática para. O worker (se estiver vivo) e o botão continuam."
          onClick={async () => { const v = !ativo; setAtivo(v); await api({ acao: "cron-config", ativo: v }, v ? "rede de segurança ligada" : "rede de segurança desligada"); }}>
          {ativo ? "● rede de segurança ligada" : "○ rede de segurança desligada"}
        </button>
        <span style={{ color: C.mute, fontSize: 12 }}>
          aceita atraso de
          <input value={tol} onChange={(e) => setTol(e.target.value.replace(/\D/g, "").slice(0, 3))} disabled={!canEdit || busy}
            onBlur={() => Number(tol) !== cfg.toleranciaMin && api({ acao: "cron-config", toleranciaMin: Number(tol) }, "tolerância salva")}
            style={{ width: 46, margin: "0 5px", background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 6, color: C.texto, padding: "4px 6px", fontSize: 12, fontFamily: "inherit", textAlign: "center" }} />
          min
        </span>
        <button disabled={!canEdit || busy} style={{ ...cx, color: C.verde }}
          title="chama o mesmo disparo do cron, agora, com o seu nome no registro"
          onClick={async () => {
            const d = await api({ acao: "cron-rodar" });
            if (d) setMsg(`rodou: ${d.devidas ?? 0} agendamento(s) vencido(s)` + (Array.isArray(d.feitos) && d.feitos.length ? ` · ${d.feitos.length} chamada(s) postada(s)` : ""));
          }}>
          ▶ Rodar agora
        </button>
        {busy && <span style={{ color: C.mute, fontSize: 12 }}>…</span>}
        {msg && <span style={{ color: C.texto, fontSize: 12 }}>{msg}</span>}
      </div>

      {/* as entradas de verdade, lidas do vercel.json */}
      <div className="leg" style={{ color: C.dim, fontSize: 10.5, marginBottom: 5 }}>
        <b style={{ color: C.mute }}>Tarefas automáticas</b> — configuradas no vercel.json, mudam só com deploy. A cadência abaixo é
        de quanto em quanto tempo a Vercel bate; a HORA de cada chamada é a da agenda acima.
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 11 }}>
        {entradas.map((e, i) => {
          const r = resumo.find((x) => x.endpoint === e.path);
          const q = quando(r?.ultima ?? null);
          return (
            <span key={i} title={`${e.schedule} (UTC) → ${e.path}${q ? ` · última: ${q.exato}` : " · nunca rodou"}`}
              style={{ border: `1px solid ${C.border2}`, borderRadius: 999, padding: "3px 10px", fontSize: 11.5, color: C.mute }}>
              <b style={{ color: C.texto }}>{TAREFA[e.path] ?? e.path}</b> · {cadencia(e.schedule)}
              <span style={{ color: q ? C.mute : C.vermelho }}> · {q ? q.rel : "nunca rodou"}</span>
            </span>
          );
        })}
        {!entradas.length && <span style={{ color: C.dim, fontSize: 11.5 }}>nenhuma — só o worker dispara</span>}
      </div>

      {/* o extrato */}
      <div className="rolx" style={{ border: `1px solid ${C.border2}`, borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5 }}>
          <thead>
            <tr style={{ background: C.inputBg, color: C.mute, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
              <th className="fixa" style={{ padding: "4px 8px", textAlign: "left" }}>Quando</th>
              <th style={{ padding: "4px 6px", textAlign: "left" }}>Origem</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }} title="agendamentos vencidos naquela batida">Vencidos</th>
              <th style={{ padding: "4px 6px", textAlign: "left" }}>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {!execs.length && <tr><td colSpan={4} style={{ padding: 11, color: C.dim, textAlign: "center" }}>nenhuma batida registrada ainda</td></tr>}
            {execs.map((e) => {
              const q = quando(e.inicio);
              const feitos = (e.resultado as { feitos?: { preset: string; ok: boolean }[]; desligado?: boolean } | null) ?? null;
              return (
                <tr key={e.id} style={{ borderTop: `1px solid ${C.borderSoft}` }}>
                  <td className="fixa" style={{ padding: "3px 8px", whiteSpace: "nowrap", color: C.texto }} title={q?.exato ?? e.inicio}>{q?.exato ?? "—"}</td>
                  <td style={{ padding: "3px 6px", color: C.mute, whiteSpace: "nowrap" }}>
                    {ROTULO_ORIGEM[e.origem] ?? e.origem}{e.quem ? ` · ${e.quem}` : ""}
                  </td>
                  <td style={{ padding: "3px 6px", textAlign: "right", color: e.devidas ? C.texto : C.dim }}>{e.devidas}</td>
                  <td style={{ padding: "3px 6px", color: e.ok ? C.mute : C.vermelho }}>
                    {e.erro ? `⚠ ${e.erro.slice(0, 60)}`
                      : feitos?.desligado ? "rede de segurança desligada"
                      : feitos?.feitos?.length ? feitos.feitos.map((f) => `${f.ok ? "✓" : "✗"} ${f.preset}`).join(", ")
                      : "nada vencido"}
                    {e.ms != null && <span style={{ color: C.dim }}> · {e.ms}ms</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
