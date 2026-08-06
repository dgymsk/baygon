"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { TIERS, corTier } from "@/lib/tier";
import type { Preset } from "@/lib/intencaoPreset";
import type { Funcao } from "@/lib/funcao";
import type { Party } from "@/lib/party";

/**
 * CHAMADAS (presets) — tela própria.
 *
 * Ficavam espremidas dentro de Definições, junto de função, party, lendário e canal. Só que uma
 * chamada é a soma de tudo isso: quais BOTÕES aparecem no bot, quais PTs viram coluna na escalação,
 * o teto de gente, o tier, o canal e se exige cadastro. Montar isso num card no meio de outros seis
 * era o motivo de metade dos campos passar despercebida.
 *
 * Definições continua dona dos CATÁLOGOS (função, party, lendário). Aqui só se referencia o que já
 * existe lá — criar função nova continua sendo lá, num lugar só.
 */
const TIPOS = ["nodewar", "siege"] as const;

export default function PresetsBoard({ presets, funcoes, parties, canEdit }: {
  presets: Preset[]; funcoes: Funcao[]; parties: Party[]; canEdit: boolean;
}) {
  const router = useRouter();
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]>("nodewar");
  const [selId, setSelId] = useState<number | null>(null);
  const [novo, setNovo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);

  const doTipo = useMemo(() => presets.filter((p) => p.tipo === tipo), [presets, tipo]);
  const p = useMemo(() => doTipo.find((x) => x.id === selId) ?? doTipo[0] ?? null, [doTipo, selId]);
  const fnIds = useMemo(() => (p?.funcoes ?? []).map((v) => v.funcao_id), [p]);
  const ptIds = useMemo(() => (p?.parties ?? []).map((v) => v.party_id), [p]);

  async function api(body: Record<string, unknown>, ok?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || (d as { error?: string }).error) throw new Error((d as { error?: string }).error ?? `erro ${res.status}`);
      if (ok) setMsg({ k: "ok", t: ok });
      router.refresh();
      return d as Record<string, unknown>;
    } catch (e) { setMsg({ k: "err", t: (e as Error).message }); return null; }
    finally { setBusy(false); }
  }
  /** edições do preset atual sempre reenviam nome+tipo — o update exige os dois pra identificar */
  const editar = (patch: Record<string, unknown>, ok?: string) =>
    p && api({ acao: "preset-editar", id: p.id, nome: p.nome, tipo: p.tipo, ...patch }, ok);

  return (
    <div style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>

      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 24, letterSpacing: 1, margin: 0, color: C.amarelo }}>
            BAYGON <span style={{ color: C.mute, fontSize: 13, letterSpacing: 2 }}>· CHAMADAS</span>
          </h1>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            {msg && <span style={{ color: msg.k === "ok" ? C.verde : C.vermelho, fontSize: 13 }}>{msg.k === "ok" ? "✓" : "⚠"} {msg.t}</span>}
            <Link className="navlink" href="/hub/config">⚙ Definições</Link>
            <Link className="navlink" href="/hub">← Hub</Link>
          </div>
        </div>

        <p style={{ color: C.mute, fontSize: 12.5, margin: "0 0 16px" }}>
          Uma chamada define <b style={{ color: C.texto }}>quais botões</b> aparecem no bot, <b style={{ color: C.texto }}>quais PTs</b> viram coluna na escalação e as regras da guerra.
          Função e party se criam em <Link href="/hub/config" style={{ color: C.verde }}>Definições</Link> — aqui você só escolhe quais entram.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {TIPOS.map((t) => <button key={t} onClick={() => { setTipo(t); setSelId(null); }} style={{ ...chip(tipo === t), cursor: "pointer", textTransform: "capitalize" }}>{t}</button>)}
        </div>

        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
          {doTipo.map((x) => (
            <button key={x.id} onClick={() => setSelId(x.id)} style={chip(p?.id === x.id)}>
              {x.nome}{x.tier ? <span style={{ color: corTier[x.tier], marginLeft: 5 }}>{x.tier}</span> : null}
            </button>
          ))}
          {!doTipo.length && <span style={{ color: C.borderSoft, fontSize: 12.5 }}>Nenhuma chamada de {tipo} ainda.</span>}
          {canEdit && (
            <span style={{ display: "inline-flex", gap: 6, marginLeft: "auto" }}>
              <input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder={`nome (ex.: NODEWAR T2)`} style={{ ...input, width: 200 }} />
              <button disabled={busy || !novo.trim()}
                onClick={async () => { const d = await api({ acao: "preset-criar", nome: novo, tipo, parties: [] }, "chamada criada"); const id = (d as { id?: number } | null)?.id; if (id) setSelId(id); setNovo(""); }}
                style={btn(C.verde)}>+ Criar</button>
            </span>
          )}
        </div>

        {!p ? null : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* REGRAS */}
            <div style={card}>
              <Titulo>{p.nome} <Sub>as regras desta guerra</Sub></Titulo>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
                <Campo rot="Tier">
                  <select defaultValue={p.tier ?? ""} disabled={!canEdit} onChange={(e) => editar({ tier: e.target.value || null }, "tier salvo")}
                    style={{ ...input, width: 90, color: p.tier ? corTier[p.tier] : C.mute, cursor: canEdit ? "pointer" : "default" }}>
                    <option value="">—</option>
                    {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Campo>
                <Campo rot="Máximo de gente">
                  <input type="number" min={1} max={500} defaultValue={p.tamanho_max ?? ""} disabled={!canEdit} placeholder="—"
                    onBlur={(e) => editar({ tamanhoMax: e.target.value || null }, "teto salvo")}
                    title="referência da escalação — o bot não corta ninguém" style={{ ...input, width: 90 }} />
                </Campo>
                <Campo rot="Canal (vazio = o do tipo)">
                  <input defaultValue={p.canal_id ?? ""} disabled={!canEdit} placeholder="id do canal"
                    onBlur={(e) => editar({ canalId: e.target.value }, "canal salvo")} style={{ ...input, width: 180 }} />
                </Campo>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 5, color: p.exige_registro ? C.amarelo : C.mute, fontSize: 12.5, cursor: canEdit ? "pointer" : "default", paddingBottom: 7 }}
                  title="quem não fez /register não consegue marcar nas chamadas criadas com esta configuração">
                  <input type="checkbox" checked={!!p.exige_registro} disabled={!canEdit}
                    onChange={(e) => editar({ exigeRegistro: e.target.checked }, e.target.checked ? "só registrados" : "aberto a todos")} />
                  só registrados
                </label>
              </div>
            </div>

            {/* BOTÕES DO BOT */}
            <div style={card}>
              <Titulo>Botões no bot <Sub>as funções que aparecem nesta chamada — não o catálogo inteiro</Sub></Titulo>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 8 }}>
                {funcoes.map((f) => {
                  const on = fnIds.includes(f.id);
                  return (
                    <button key={f.id} disabled={!canEdit} style={chip(on)}
                      onClick={() => editar({ funcoes: on ? fnIds.filter((x) => x !== f.id) : [...fnIds, f.id] })}>
                      {f.emoji ? <Icone raw={f.emoji} /> : null} {f.nome}{f.role_id ? <span title="restrita por cargo" style={{ marginLeft: 4 }}>🔒</span> : null}
                    </button>
                  );
                })}
                {!funcoes.length && <Vazio>Nenhuma função criada — crie em <Link href="/hub/config" style={{ color: C.verde }}>Definições</Link>.</Vazio>}
              </div>
              <div style={{ color: C.borderSoft, fontSize: 11.5 }}>
                {fnIds.length
                  ? <>Ordem dos botões: {fnIds.map((id) => funcoes.find((f) => f.id === id)?.nome ?? id).join(" → ")}</>
                  : <span style={{ color: C.amarelo }}>Nenhuma escolhida — o bot cai no catálogo inteiro. Escolha pra restringir.</span>}
              </div>
            </div>

            {/* COLUNAS DA ESCALAÇÃO */}
            <div style={card}>
              <Titulo>PTs in-game <Sub>viram as colunas da escalação, nesta ordem</Sub></Titulo>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 8 }}>
                {parties.map((x) => {
                  const on = ptIds.includes(x.id);
                  return (
                    <button key={x.id} disabled={!canEdit} style={chip(on)}
                      onClick={() => editar({ parties: on ? ptIds.filter((y) => y !== x.id) : [...ptIds, x.id] })}>
                      {x.icone ? <Icone raw={x.icone} /> : null} {x.nome}
                    </button>
                  );
                })}
                {!parties.length && <Vazio>Nenhuma party criada — crie em <Link href="/hub/config" style={{ color: C.verde }}>Definições</Link>.</Vazio>}
              </div>
              <div style={{ color: C.borderSoft, fontSize: 11.5 }}>
                {ptIds.length
                  ? <>Colunas: {ptIds.map((id) => parties.find((x) => x.id === id)?.nome ?? id).join(" → ")}</>
                  : <span style={{ color: C.amarelo }}>Sem PT, a escalação abre sem coluna nenhuma — e não dá pra criar evento com esta chamada.</span>}
              </div>
            </div>

            {canEdit && (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button disabled={busy || !ptIds.length} onClick={() => api({ acao: "postar", id: p.id }, "chamada postada no Discord")}
                  style={{ ...btn(C.verde), background: C.verdeTint, opacity: ptIds.length ? 1 : 0.5 }}>📢 Postar no Discord</button>
                <button onClick={() => confirm(`Excluir a chamada "${p.nome}"? Os eventos já criados continuam.`) && api({ acao: "preset-excluir", id: p.id }, "chamada excluída")}
                  style={{ ...btn(C.vermelho), marginLeft: "auto" }}>✕ Excluir chamada</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const card = { border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 16 } as const;
const input = { background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "6px 9px", fontSize: 12.5, fontFamily: "inherit", outline: "none" } as const;
const btn = (cor: string) => ({ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: cor, padding: "6px 13px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" } as const);
const chip = (on: boolean) => ({ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 999, border: `1px solid ${on ? C.verde : C.border2}`, background: on ? C.verdeTint : "transparent", color: on ? C.verde : C.mute, padding: "4px 11px", fontSize: 12.5, fontFamily: "inherit", cursor: "pointer" } as const);
const Titulo = ({ children }: { children: React.ReactNode }) => <div style={{ color: C.verde, fontWeight: 700, fontSize: 14, marginBottom: 10 }}>{children}</div>;
const Sub = ({ children }: { children: React.ReactNode }) => <span style={{ color: C.mute, fontWeight: 400, fontSize: 11.5 }}>— {children}</span>;
const Vazio = ({ children }: { children: React.ReactNode }) => <span style={{ color: C.borderSoft, fontSize: 12.5 }}>{children}</span>;
const Campo = ({ rot, children }: { rot: string; children: React.ReactNode }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
    <span style={{ color: C.mute, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.8 }}>{rot}</span>
    {children}
  </label>
);
/** "<:nome:id>" → imagem do CDN; unicode → o caractere. */
function Icone({ raw }: { raw: string | null }) {
  const m = (raw ?? "").match(/^<a?:\w+:(\d+)>$/);
  if (m) return <img src={`https://cdn.discordapp.com/emojis/${m[1]}.png`} alt="" width={14} height={14} style={{ verticalAlign: "-2px", borderRadius: 3 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />;
  return raw ? <span style={{ fontSize: 13 }}>{raw}</span> : null;
}
