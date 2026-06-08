"use client";

import { useEffect, useState, type CSSProperties } from "react";

type Metrica = { metrica: string; direcao: string; coreRaw: number | null; grupoRaw: number | null; minhaRaw: number | null; minhaPct: number | null; grupoPct: number | null };
type Win = { key: string; label: string; stats: Metrica[] };

const ICON: Record<string, string> = {
  dano_em_player: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>',
  dano_do_pino: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  ccs: '<line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>',
  cura_aliados: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.49 4.04 3 5.5l7 7Z"/>',
  tempo_morto: '<path d="M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="12" r="1"/>',
};
const NAME: Record<string, string> = { dano_em_player: "Dano PvP", dano_do_pino: "Dano no Pino", ccs: "CC", cura_aliados: "Cura aliados", tempo_morto: "Tempo morto" };
const SHORT: Record<string, string> = { dano_em_player: "PvP", dano_do_pino: "Pino", ccs: "CC", cura_aliados: "Cura", tempo_morto: "Morto" };
const FMT: Record<string, "num" | "int" | "time"> = { dano_em_player: "num", dano_do_pino: "num", ccs: "int", cura_aliados: "num", tempo_morto: "time" };

function fmt(v: number | null, t: "num" | "int" | "time"): string {
  if (v == null) return "—";
  if (t === "time") { const s = Math.max(0, Math.round(v)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
  if (t === "int") return String(Math.round(v));
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return Math.round(v / 1e3) + "k";
  return String(Math.round(v));
}
const lower = (m: Metrica) => m.direcao === "menor_melhor";
// % já vêm calculados por-war (igual /membros): polaridade + teto 200 + média.
const pctExp = (m: Metrica): number | null => m.minhaPct;
const pctGrp = (m: Metrica): number | null => m.grupoPct;
const tier = (p: number | null) => (p == null ? "bad" : p >= 100 ? "good" : p >= 70 ? "warn" : "bad");
const posBar = (p: number | null) => (p == null ? 0 : Math.max(0, Math.min(p, 200)) / 2);

export default function EuHud({
  nome, avatar, classe, tipo, grupo, nWars, isCore, windows, avaliadas,
}: {
  nome: string; avatar: string | null; classe: string | null; tipo: string | null; grupo: string; nWars: number; isCore: boolean; windows: Win[]; avaliadas: string[];
}) {
  const [winKey, setWinKey] = useState("n3");
  const [hl, setHl] = useState<"" | "you" | "exp" | "grp">("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const win = windows.find((w) => w.key === winKey) ?? windows[1] ?? windows[0];
  const ms = win.stats;

  // Métricas que avaliam o grupo (config /config → grupos_metricas). As de fora
  // entram só como informação ("não avaliado") e NÃO compõem o índice/médias.
  // Fallback: se nenhuma das exibidas estiver na config, todas contam.
  const avalSet = new Set(avaliadas);
  const anyAval = avaliadas.length > 0;
  const isAval = (m: Metrica) => !anyAval || avalSet.has(m.metrica);

  const pcts = ms.map(pctExp);
  const validIdx = ms.map((m, i) => (isAval(m) && pcts[i] != null ? i : -1)).filter((i) => i >= 0);
  const valid = validIdx.map((i) => Math.round(pcts[i] as number));
  const score = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : 0;
  let bestI = -1, worstI = -1;
  if (validIdx.length) {
    bestI = validIdx.reduce((b, i) => (Math.round(pcts[i] as number) > Math.round(pcts[b] as number) ? i : b), validIdx[0]);
    if (validIdx.length > 1) {
      worstI = validIdx.reduce((w, i) => (Math.round(pcts[i] as number) < Math.round(pcts[w] as number) ? i : w), validIdx[0]);
      // "ponto fraco" só existe se houver um pior DISTINTO e ABAIXO do esperado
      if (worstI === bestI || Math.round(pcts[worstI] as number) >= 100) worstI = -1;
    }
  }
  const above = valid.filter((p) => p >= 100).length;
  const near = valid.filter((p) => p >= 70 && p < 100).length;
  const below = valid.filter((p) => p < 70).length;
  const overall = score >= 80 ? "good" : score >= 60 ? "warn" : "bad";
  const ringC = `var(--${overall})`;

  const grupoLetra = (grupo || "G").trim().charAt(0).toUpperCase() || "G";
  const TABS = [{ k: "ultima", l: "Última war" }, { k: "n3", l: "3 nodes" }, { k: "n5", l: "5 nodes" }, { k: "n10", l: "10 nodes" }, { k: "todas", l: "Todas" }];

  return (
    <div className="hud">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Saira:wght@300;400;500;600&display=swap');
      @property --sweep{syntax:'<percentage>';inherits:false;initial-value:0%;}
      .hud{--bg:#08120b;--panel:rgba(163,230,53,0.022);--bd:rgba(163,230,53,0.11);--bd-soft:rgba(163,230,53,0.07);--txt:#e9f3e1;--txt-2:rgba(233,243,225,0.55);--txt-3:rgba(233,243,225,0.32);--you:#38bdf8;--exp:#facc15;--grp:#38bdf8;--good:#84cc16;--warn:#f59e0b;--bad:#ef4444;--na:rgba(233,243,225,0.42);--r:14px;--display:'Chakra Petch',ui-sans-serif,system-ui,sans-serif;--body:'Saira',ui-sans-serif,system-ui,sans-serif;}
      .hud,.hud *{box-sizing:border-box;margin:0;padding:0}
      .hud{font-family:var(--body);color:var(--txt);min-height:100vh;background:radial-gradient(900px 380px at 80% -10%,rgba(132,204,22,0.14),transparent 60%),radial-gradient(720px 320px at -6% 0%,rgba(34,197,94,0.12),transparent 55%),linear-gradient(180deg,#0b170e,#08120b 62%);position:relative;line-height:1.45}
      .hud::before{content:'';position:absolute;inset:0;pointer-events:none;opacity:.55;background-image:linear-gradient(rgba(163,230,53,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(163,230,53,0.03) 1px,transparent 1px);background-size:34px 34px;mask-image:radial-gradient(120% 90% at 50% 0%,#000 35%,transparent 100%);-webkit-mask-image:radial-gradient(120% 90% at 50% 0%,#000 35%,transparent 100%)}
      .hud > *{position:relative;z-index:1}
      .hd{display:flex;align-items:center;gap:16px;padding:18px 22px 16px;border-bottom:1px solid var(--bd);background:linear-gradient(180deg,rgba(56,189,248,0.05),transparent)}
      .avatar{width:52px;height:52px;flex:0 0 52px;border-radius:14px;overflow:hidden;background:linear-gradient(135deg,#0c4a6e,#0ea5e9);display:flex;align-items:center;justify-content:center;font-family:var(--display);font-weight:700;font-size:24px;color:#e8f7ff;border:1px solid rgba(56,189,248,0.55);box-shadow:0 0 0 4px rgba(14,165,233,0.08),0 8px 24px rgba(0,0,0,.45)}
      .avatar img{width:100%;height:100%;object-fit:cover}
      .hd-info{flex:1;min-width:0}
      .name{font-family:var(--display);font-weight:700;font-size:25px;letter-spacing:.5px;line-height:1}
      .meta{display:flex;align-items:center;gap:8px;margin-top:7px;flex-wrap:wrap}
      .badge{font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;letter-spacing:.04em;display:inline-flex;gap:5px;align-items:center}
      .badge.cls{color:var(--you);background:rgba(56,189,248,0.10);border:1px solid rgba(56,189,248,0.30)}
      .badge.grp{color:var(--grp);background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.24)}
      .meta .wars{font-size:11px;color:var(--txt-3);letter-spacing:.04em}
      .hd-right{text-align:right;flex:0 0 auto}
      .hd-right .k{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--txt-3)}
      .hd-right .v{font-family:var(--display);font-weight:600;font-size:14px;color:var(--you);letter-spacing:.04em}
      .navx{display:flex;gap:12px;justify-content:flex-end;margin-bottom:6px}
      .navx a{color:var(--txt-3);text-decoration:none;font-size:11px;letter-spacing:.06em} .navx a:hover{color:var(--you)}
      .live{display:inline-flex;align-items:center;gap:6px;font-size:10px;color:var(--txt-3);letter-spacing:.14em;text-transform:uppercase}
      .live .dot{width:6px;height:6px;border-radius:50%;background:var(--good);box-shadow:0 0 9px var(--good);animation:pulse 1.8s ease-in-out infinite}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
      .tabs{display:flex;gap:2px;padding:0 16px;border-bottom:1px solid var(--bd);background:rgba(0,0,0,0.28);overflow-x:auto}
      .tab{appearance:none;background:none;border:0;cursor:pointer;color:var(--txt-3);font-family:var(--body);font-weight:600;font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:12px 14px;border-bottom:2px solid transparent;white-space:nowrap;transition:color .18s}
      .tab:hover{color:var(--txt-2)} .tab.active{color:var(--you);border-bottom-color:var(--you)}
      .content{padding:18px 22px 22px;max-width:1320px;margin:0 auto}
      .panel{background:var(--panel);border:1px solid var(--bd-soft);border-radius:var(--r);position:relative}
      .panel.brk::before,.panel.brk::after{content:'';position:absolute;width:12px;height:12px;border:1.5px solid rgba(132,204,22,0.4);pointer-events:none}
      .panel.brk::before{top:8px;left:8px;border-right:0;border-bottom:0} .panel.brk::after{bottom:8px;right:8px;border-left:0;border-top:0}
      .ttl{font-family:var(--body);font-weight:600;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--txt-3);display:flex;align-items:center;gap:9px}
      .ttl::after{content:'';flex:1;height:1px;background:var(--bd-soft)}
      .refs{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}
      @media(max-width:620px){.refs{grid-template-columns:1fr}}
      .ref{border:1px solid var(--bd-soft);border-radius:12px;padding:12px 13px;background:var(--panel);transition:transform .18s,border-color .18s,box-shadow .18s;cursor:default}
      .ref:hover{transform:translateY(-2px);border-color:var(--bd);box-shadow:0 8px 22px rgba(0,0,0,.32)}
      .ref.you{border-left:3px solid var(--good)} .ref.exp{border-left:3px solid var(--exp)} .ref.grp{border-left:3px solid var(--grp)}
      .ref-h{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;display:flex;align-items:center;gap:6px;margin-bottom:10px}
      .ref.you .ref-h{color:var(--good)} .ref.exp .ref-h{color:var(--exp)} .ref.grp .ref-h{color:var(--grp)}
      .ref-h .pt{width:8px;height:8px;border-radius:50%}
      .ref.you .pt{background:var(--good)} .ref.exp .pt{background:var(--exp)} .ref.grp .pt{background:var(--grp)}
      .ref-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:4px}
      .rst{text-align:center} .rst b{font-family:var(--display);font-weight:700;font-size:14px;line-height:1;display:block} .rst span{font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:var(--txt-3);display:block;margin-top:3px}
      .scale{position:relative;height:38px;margin:8px 6px 16px}
      .scale::before{content:'';position:absolute;left:0;right:0;top:23px;height:1px;background:linear-gradient(90deg,transparent,var(--bd) 12%,var(--bd) 88%,transparent)}
      .se{position:absolute;top:26px;font-size:9px;letter-spacing:.08em;color:var(--txt-3)} .se.l{left:0} .se.r{right:0}
      .smk{position:absolute;top:6px;transform:translateX(-50%);text-align:center} .smk i{display:block;width:0;height:17px;margin:0 auto} .smk em{display:block;font-style:normal;font-size:9px;letter-spacing:.04em;margin-top:4px;white-space:nowrap}
      .smk .cap{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:3px;font-size:8px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}
      .smk.exp{left:50%} .smk.exp i{border-left:2px dashed var(--exp)} .smk.exp em{color:var(--exp);font-weight:600} .smk.exp .cap{color:var(--exp)}
      .smk.min{left:40%} .smk.min i{border-left:1px dotted var(--txt-2)} .smk.min em{color:var(--txt-3)}
      .metrics{display:grid;gap:10px}
      .m{border:1px solid var(--bd-soft);border-radius:12px;padding:13px 15px;background:var(--panel);position:relative;transition:transform .18s,border-color .18s,box-shadow .18s}
      .m:hover{transform:translateX(3px);border-color:var(--bd);box-shadow:0 6px 20px rgba(0,0,0,.3)}
      .m.flag-good{border-left:3px solid var(--good)} .m.flag-bad{border-left:3px solid var(--bad)}
      .m-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .m-name{display:flex;align-items:center;gap:9px;font-weight:500;font-size:13.5px;color:var(--txt)} .m-name .ico{width:17px;height:17px;flex:0 0 17px}
      .chip{font-size:8.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:2px 7px;border-radius:6px}
      .chip.good{color:var(--good);background:rgba(132,204,22,0.13)} .chip.bad{color:var(--bad);background:rgba(239,68,68,0.13)}
      .m-note{font-size:10px;color:var(--txt-3);font-weight:400}
      .m-right{text-align:right;white-space:nowrap} .m-pct{font-family:var(--display);font-weight:700;font-size:21px;line-height:1} .m-raw{font-size:11px;color:var(--txt-3);margin-left:5px}
      .pct-good{color:var(--good)} .pct-warn{color:var(--warn)} .pct-bad{color:var(--bad)} .pct-na{color:var(--txt-2)}
      .chip.na{color:var(--txt-2);background:rgba(233,243,225,0.06)} .m.naoaval{opacity:.6} .mk.na{color:var(--txt-3)}
      .track{position:relative;height:8px;margin:15px 0 4px;background:rgba(255,255,255,0.06);border-radius:99px}
      .fill{position:absolute;top:0;bottom:0;left:0;border-radius:99px;width:0;transition:width .9s cubic-bezier(.22,1,.36,1),opacity .2s,filter .2s}
      .fill.good{background:linear-gradient(90deg,#4d7c0f,#a3e635);box-shadow:0 0 10px rgba(132,204,22,.45)} .fill.warn{background:linear-gradient(90deg,#b45309,#f59e0b);box-shadow:0 0 10px rgba(245,158,11,.35)} .fill.bad{background:linear-gradient(90deg,#b91c1c,#ef4444);box-shadow:0 0 10px rgba(239,68,68,.35)} .fill.na{background:linear-gradient(90deg,rgba(233,243,225,0.16),rgba(233,243,225,0.30))}
      .thr{position:absolute;top:-5px;bottom:-5px;left:40%;width:0;border-left:1px dotted var(--txt-3);opacity:.45}
      .bead{position:absolute;top:50%;width:23px;height:23px;border-radius:50%;transform:translate(-50%,-58%);z-index:3;cursor:default;display:flex;align-items:center;justify-content:center;font-family:var(--display);font-weight:700;font-size:11px;line-height:1;border:1.5px solid rgba(0,0,0,.35);box-shadow:0 3px 8px rgba(0,0,0,.55),inset 0 2px 2px rgba(255,255,255,.6),inset 0 -2px 3px rgba(0,0,0,.28);transition:transform .2s,box-shadow .2s,opacity .2s}
      .bead.exp{background:radial-gradient(circle at 34% 26%,#fef3c7,#facc15 52%,#b58900);color:#3a2d04}
      .bead.grp{background:radial-gradient(circle at 34% 26%,#d4f0ff,#38bdf8 52%,#075985);color:#062538}
      .bead:hover{transform:translate(-50%,-66%) scale(1.14)}
      .bead.exp:hover{box-shadow:0 5px 13px rgba(0,0,0,.55),inset 0 2px 2px rgba(255,255,255,.65),0 0 14px rgba(250,204,21,.75)}
      .bead.grp:hover{box-shadow:0 5px 13px rgba(0,0,0,.55),inset 0 2px 2px rgba(255,255,255,.65),0 0 14px rgba(56,189,248,.75)}
      .bead .tip{position:absolute;bottom:135%;left:50%;transform:translateX(-50%);background:#0a160d;border:1px solid var(--bd);border-radius:6px;padding:3px 8px;font-family:var(--body);font-weight:500;font-size:10px;color:var(--txt);white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .15s}
      .bead:hover .tip{opacity:1}
      .m-foot{display:flex;align-items:center;gap:7px;margin-top:11px;font-size:11px;color:var(--txt-2)} .m-foot .mk{font-weight:700} .mk.good{color:var(--good)} .mk.warn{color:var(--warn)} .mk.bad{color:var(--bad)}
      .metrics.hl-you .bead{opacity:.18} .metrics.hl-you .fill{filter:brightness(1.22) saturate(1.2)}
      .metrics.hl-exp .bead.grp{opacity:.16} .metrics.hl-exp .fill{opacity:.32} .metrics.hl-exp .bead.exp{transform:translate(-50%,-66%) scale(1.16);box-shadow:0 5px 13px rgba(0,0,0,.55),0 0 14px rgba(250,204,21,.8)}
      .metrics.hl-grp .bead.exp{opacity:.16} .metrics.hl-grp .fill{opacity:.32} .metrics.hl-grp .bead.grp{transform:translate(-50%,-66%) scale(1.16);box-shadow:0 5px 13px rgba(0,0,0,.55),0 0 14px rgba(56,189,248,.8)}
      .verdict-panel{margin-top:14px} .verdict{display:flex;align-items:stretch;flex-wrap:wrap}
      .v-seg{display:flex;align-items:center;gap:16px;padding:16px 22px} .v-seg + .v-seg{border-left:1px solid var(--bd-soft)} .v-seg.grow{flex:1;min-width:200px}
      .ring{width:92px;height:92px;flex:0 0 92px;border-radius:50%;position:relative;background:conic-gradient(var(--ring-c) var(--sweep,0%),rgba(255,255,255,0.07) 0);transition:--sweep 1.1s cubic-bezier(.22,1,.36,1);filter:drop-shadow(0 0 11px color-mix(in srgb,var(--ring-c) 50%,transparent))}
      .ring::after{content:'';position:absolute;inset:9px;border-radius:50%;background:#0a160d;border:1px solid var(--bd-soft)}
      .ring .num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;z-index:1}
      .ring .num b{font-family:var(--display);font-weight:700;font-size:25px;line-height:1;color:var(--ring-c)} .ring .num small{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--txt-3);margin-top:2px}
      .v-title .lbl{font-family:var(--display);font-weight:600;font-size:16px;letter-spacing:.3px;color:var(--txt)} .v-title .sub{font-size:11px;color:var(--txt-3);margin-top:3px}
      .v-stats{display:flex;gap:26px} .v-stats .lk{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--txt-3);display:block;margin-bottom:4px} .v-stats .rv{font-family:var(--display);font-weight:700;font-size:15px;letter-spacing:.3px}
      .counts{display:flex;gap:8px} .cnt{flex:0 0 auto;min-width:74px;text-align:center;border:1px solid var(--bd-soft);border-radius:10px;padding:8px 6px;background:rgba(163,230,53,0.015);transition:transform .18s,border-color .18s} .cnt:hover{transform:translateY(-2px);border-color:var(--bd)}
      .cnt b{font-family:var(--display);font-weight:700;font-size:20px;line-height:1;display:block} .cnt span{font-size:9px;letter-spacing:.09em;text-transform:uppercase;color:var(--txt-3);display:block;margin-top:4px;white-space:nowrap}
      @media(max-width:680px){.verdict{flex-direction:column}.v-seg{border-left:0!important;justify-content:flex-start}.v-seg + .v-seg{border-top:1px solid var(--bd-soft)}.counts{width:100%}.cnt{flex:1}}
      .foot{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid var(--bd-soft);font-size:10px;color:var(--txt-3);letter-spacing:.04em} .foot code{font-family:var(--display);color:var(--txt-2)}
      `}</style>

      <header className="hd">
        <div className="avatar">{avatar ? <img src={avatar} alt="" /> : (nome.charAt(0).toUpperCase() || "?")}</div>
        <div className="hd-info">
          <div className="name">{nome}</div>
          <div className="meta">
            {classe && <span className="badge cls">⚔ {classe}{tipo ? ` · ${tipo}` : ""}</span>}
            <span className="badge grp">◧ {grupo}</span>
            <span className="wars">{nWars} wars registradas{isCore ? " · core" : ""}</span>
          </div>
        </div>
        <div className="hd-right">
          <div className="navx"><a href="/painel">Painel</a><a href="/confirmados">Confirmados</a><a href="/evolucao">Evolução</a></div>
          <div className="live"><span className="dot" />Telemetria</div>
          <div className="k" style={{ marginTop: 6 }}>Janela</div>
          <div className="v">{win.label}</div>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.k} className={`tab${t.k === winKey ? " active" : ""}`} onClick={() => setWinKey(t.k)}>{t.l}</button>
        ))}
      </nav>

      <div className="content">
        <div className="ttl">Médias da janela</div>
        <div className="refs">
          {([
            { cls: "you", h: "Você", who: (m: Metrica) => m.minhaRaw, key: "you" },
            { cls: "exp", h: "Esperado", who: (m: Metrica) => m.coreRaw, key: "exp" },
            { cls: "grp", h: grupo, who: (m: Metrica) => m.grupoRaw, key: "grp" },
          ] as const).map((ref) => (
            <div key={ref.cls} className={`ref ${ref.cls}`}
              onMouseEnter={() => setHl(ref.key as "you" | "exp" | "grp")} onMouseLeave={() => setHl("")}>
              <div className="ref-h"><span className="pt" />{ref.h}</div>
              <div className="ref-stats">
                {ms.map((m) => (
                  <div key={m.metrica} className="rst" style={{ opacity: isAval(m) ? 1 : 0.4 }}><b>{fmt(ref.who(m), FMT[m.metrica])}</b><span>{SHORT[m.metrica]}</span></div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="ttl" style={{ marginTop: 20 }}>Telemetria por métrica</div>
        <div className="scale">
          <span className="se l">0%</span><span className="se r">200%</span>
          <span className="smk min"><i /><em>80%</em></span>
          <span className="smk exp"><span className="cap">esperado</span><i /><em>100%</em></span>
        </div>

        <div className={`metrics${hl ? " hl-" + hl : ""}`}>
          {ms.map((m, i) => {
            const naoAval = !isAval(m);
            const p = pctExp(m);
            const pR = p == null ? null : Math.round(p);
            const semDado = !naoAval && pR == null;
            const t = naoAval || pR == null ? "na" : tier(pR);
            const gP = pctGrp(m);
            const bE = pR != null && pR >= 100;
            const bG = p != null && m.grupoPct != null && p >= m.grupoPct;
            const isBest = !naoAval && !semDado && i === bestI;
            const isWorst = !naoAval && !semDado && i === worstI;
            const flag = isBest ? "flag-good" : isWorst ? "flag-bad" : "";
            let mk = "▼", mkc = pR != null && pR >= 70 ? "warn" : "bad", note = isWorst ? "Maior lacuna da janela" : "Abaixo das médias";
            if (naoAval) { mk = "○"; mkc = "na"; note = "Não entra no índice (não avaliado no seu grupo)"; }
            else if (semDado) { mk = "○"; mkc = "na"; note = "Sem dado nesta janela"; }
            else if (bE && bG) { mk = "✓"; mkc = "good"; note = "Acima do esperado e do grupo"; }
            else if (bG) { mk = "▲"; mkc = "warn"; note = "Acima do grupo · abaixo do esperado"; }
            else if (bE) { mk = "✓"; mkc = "good"; note = "Acima do esperado"; }
            return (
              <div key={m.metrica} className={`m ${flag}${naoAval ? " naoaval" : ""}`}>
                <div className="m-top">
                  <div className="m-name">
                    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke={`var(--${t})`} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: ICON[m.metrica] }} />
                    <span>{NAME[m.metrica]}</span>
                    {naoAval ? <span className="chip na">não avaliado</span> : isBest ? <span className="chip good">Destaque</span> : isWorst ? <span className="chip bad">Ponto fraco</span> : null}
                  </div>
                  <div className="m-right"><span className={`m-pct pct-${t}`}>{pR == null ? "—" : pR + "%"}</span><span className="m-raw">{fmt(m.minhaRaw, FMT[m.metrica])}</span></div>
                </div>
                <div className="track">
                  <div className={`fill ${t}`} style={{ width: `${mounted ? posBar(p) : 0}%` }} />
                  <div className="thr" />
                  {gP != null && <div className="bead grp" style={{ left: `${posBar(gP)}%` }}><span className="tip">{grupo} · {fmt(m.grupoRaw, FMT[m.metrica])} ({Math.round(gP)}%)</span>{grupoLetra}</div>}
                  <div className="bead exp" style={{ left: "50%" }}><span className="tip">Esperado · {fmt(m.coreRaw, FMT[m.metrica])}</span>E</div>
                </div>
                <div className="m-foot"><span className={`mk ${mkc}`}>{mk}</span><span>{note}</span>{lower(m) ? <span className="m-note"> · ↓ menos é melhor</span> : null}</div>
              </div>
            );
          })}
        </div>

        <section className="panel brk verdict-panel">
          <div className="verdict">
            <div className="v-seg">
              <div className="ring" style={{ "--sweep": `${mounted ? score : 0}%`, "--ring-c": ringC } as unknown as CSSProperties}>
                <div className="num"><b>{score}%</b><small>índice</small></div>
              </div>
              <div className="v-title"><div className="lbl">Índice de combate</div><div className="sub">vs esperado · média de {validIdx.length} métrica{validIdx.length === 1 ? "" : "s"} avaliada{validIdx.length === 1 ? "" : "s"}</div></div>
            </div>
            <div className="v-seg grow v-stats">
              <div><span className="lk">Destaque</span><span className="rv pct-good">{bestI < 0 ? "—" : `${NAME[ms[bestI].metrica]} · ${Math.round(pcts[bestI] as number)}%`}</span></div>
              <div><span className="lk">Ponto fraco</span><span className="rv pct-bad">{worstI < 0 ? "—" : `${NAME[ms[worstI].metrica]} · ${Math.round(pcts[worstI] as number)}%`}</span></div>
            </div>
            <div className="v-seg">
              <div className="counts">
                <div className="cnt"><b className="pct-good">{above}</b><span>acima do esperado</span></div>
                <div className="cnt"><b className="pct-warn">{near}</b><span>próximo</span></div>
                <div className="cnt"><b className="pct-bad">{below}</b><span>abaixo</span></div>
              </div>
            </div>
          </div>
        </section>

        <div className="foot">
          <span>Escala <code>0–200%</code> · esperado = baseline 100% · grupo = média do {grupo} · <span style={{ color: "var(--txt-2)" }}>não avaliado</span> = não conta no índice (config do grupo)</span>
          <span>Medido nas mesmas wars que você jogou</span>
        </div>
      </div>
    </div>
  );
}
