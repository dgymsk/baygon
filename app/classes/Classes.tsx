"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
// SÓ constantes e tipos de módulos de servidor: importar um VALOR de lib/stats ou lib/statsClasse
// puxaria lib/db pro navegador, que lança erro sem DATABASE_URL — foi o "This page couldn't load"
import { STAT_METRICAS, JANELAS } from "@/lib/statsConst";
import { METRICAS_RESULTADO } from "@/lib/metricasResultado";
import { formatarMetrica } from "@/lib/formatarMetrica";
import type { CadastroClasse, ComboClasse, LinhaClasse } from "@/lib/statsClasse";
import { BarraPct } from "@/app/BarraPct";

/**
 * A tabela do comparativo. Uma métrica por vez (chips), ordenada por "vs classe" por padrão — é a
 * coluna que esta tela existe pra mostrar; "vs core" está aqui pra ninguém precisar abrir outra
 * tela pra cruzar as duas.
 *
 * As duas barras APAGAM quando o número vale pouco, em vez de sumir: régua de classe de uma pessoa
 * só, ou core inexistente (grupo Indefinido). Sumir esconde; apagar avisa.
 */
const ROTULO: Record<string, string> = Object.fromEntries(METRICAS_RESULTADO.map((m) => [m.metrica, m.rotulo]));
const semGrupo = (g: string | null) => !g || g === "Indefinido";
const OURO = "#e0bd3a";

type Ordem = { col: "pctClasse" | "pctCore" | "valorMedio" | "nome"; desc: boolean };

const Select = ({ value, onChange, children, title }: { value: string; onChange: (v: string) => void; children: React.ReactNode; title?: string }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} title={title}
    style={{ background: C.inputBg, color: C.texto, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "7px 10px", fontFamily: "inherit", fontSize: 13, cursor: "pointer", maxWidth: "100%" }}>
    {children}
  </select>
);

export default function Classes({ combos, combo, n, linhas, cadastro, semCarimbo, canEdit, metricaInicial, foco }: {
  combos: ComboClasse[]; combo: ComboClasse | null; n: number; linhas: LinhaClasse[];
  cadastro: Record<string, CadastroClasse>; semCarimbo: { nome_familia: string; wars: number }[];
  canEdit: boolean; metricaInicial: string; foco: string;
}) {
  const router = useRouter();
  const [metrica, setMetrica] = useState(STAT_METRICAS.includes(metricaInicial) ? metricaInicial : "dano_em_player");
  const [ordem, setOrdem] = useState<Ordem>({ col: "pctClasse", desc: true });

  // a URL é o estado: trocar classe ou janela vai ao servidor; trocar métrica não precisa
  const ir = (p: Partial<{ classe: string; tipo: string; n: number }>) => {
    const u = new URLSearchParams();
    u.set("classe", p.classe ?? combo?.classe ?? "");
    u.set("tipo", p.tipo ?? combo?.tipo ?? "");
    u.set("n", String(p.n ?? n));
    if (metrica !== "dano_em_player") u.set("m", metrica);
    if (foco) u.set("foco", foco);
    router.replace(`/classes?${u.toString()}`);
  };

  const rows = useMemo(() => {
    const base = linhas.filter((l) => l.metrica === metrica);
    const val = (l: LinhaClasse) => (ordem.col === "nome" ? l.nome_familia : (l[ordem.col] ?? null));
    return [...base].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va == null && vb == null) return a.nome_familia.localeCompare(b.nome_familia, "pt-BR");
      if (va == null) return 1;                                     // sem número vai pro fim, sempre
      if (vb == null) return -1;
      if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb), "pt-BR") * (ordem.desc ? -1 : 1);
      return (vb - va) * (ordem.desc ? 1 : -1);
    });
  }, [linhas, metrica, ordem]);

  const alternar = (col: Ordem["col"]) => setOrdem((o) => (o.col === col ? { col, desc: !o.desc } : { col, desc: col !== "nome" }));
  const seta = (col: Ordem["col"]) => (ordem.col === col ? (ordem.desc ? " ↓" : " ↑") : "");
  const th = (col: Ordem["col"] | null, texto: string, title?: string, right = false) => (
    <th onClick={col ? () => alternar(col) : undefined} title={title}
      style={{ padding: "6px 8px", textAlign: right ? "right" : "left", cursor: col ? "pointer" : "default", whiteSpace: "nowrap", userSelect: "none", position: "sticky", top: 0, background: C.surfaceSolid, zIndex: 2 }}>
      {texto}{col ? seta(col) : ""}
    </th>
  );

  return (
    <div className="pg" style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600;700&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}
        .gp tbody tr:hover{background:rgba(255,255,255,.03)}`}</style>

      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 26, letterSpacing: 1, margin: 0, color: C.amarelo }}>
            BAYGON <span style={{ color: C.mute, fontSize: 14, letterSpacing: 2 }}>· POR CLASSE</span>
          </h1>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Link className="navlink" href="/painel">Painel</Link>
            <Link className="navlink" href="/membros">Membros</Link>
            <Link className="navlink" href="/evolucao">Evolução</Link>
          </div>
        </div>

        {/* filtros */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <Select value={combo ? `${combo.classe}|${combo.tipo}` : ""} title="classe + tipo, com quantos jogaram na janela e em quantas wars houve mais de um (régua de classe)"
            onChange={(v) => { const [classe, tipo] = v.split("|"); ir({ classe, tipo }); }}>
            {combos.map((c) => (
              <option key={`${c.classe}|${c.tipo}`} value={`${c.classe}|${c.tipo}`}>
                {c.classe} · {c.tipo} ({c.jogadores}{c.warsComPar ? ` · régua em ${c.warsComPar}/${c.wars}` : " — sem régua de classe"})
              </option>
            ))}
            {!combos.length && <option value="">— nenhuma classe carimbada na janela —</option>}
          </Select>
          <Select value={String(n)} onChange={(v) => ir({ n: Number(v) })} title="quantas guerras da guilda entram na conta — as mesmas pra todo mundo">
            {JANELAS.map((j) => <option key={j} value={j}>{j === 999 ? "todas as wars" : `últimas ${j} wars`}</option>)}
          </Select>
          <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}>
            {STAT_METRICAS.map((m) => (
              <button key={m} onClick={() => setMetrica(m)}
                style={{ borderRadius: 999, border: `1px solid ${metrica === m ? C.verde : C.border2}`, background: metrica === m ? C.verdeTint : C.inputBg,
                  color: metrica === m ? C.verde : C.mute, padding: "5px 11px", fontSize: 12, fontWeight: metrica === m ? 700 : 400, cursor: "pointer", fontFamily: "inherit" }}>
                {ROTULO[m] ?? m}
              </button>
            ))}
          </span>
        </div>

        {combo && (
          <div style={{ color: C.mute, fontSize: 12.5, marginBottom: 10 }}>
            <b style={{ color: C.texto }}>{combo.classe} · {combo.tipo}</b> — {combo.jogadores} jogador(es) nas {n === 999 ? "wars todas" : `últimas ${n} wars`} da guilda ·{" "}
            <b style={{ color: C.texto }}>{ROTULO[metrica] ?? metrica}</b>
          </div>
        )}

        <div className="rolx gp" style={{ border: `1px solid ${C.border2}`, borderRadius: 10, maxHeight: "70vh", overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: C.mute, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {th("nome", "Jogador")}
                {th(null, "Grupo", "o grupo dele na war mais recente da janela")}
                {th(null, "Wars", "wars na janela · em quantas havia outra pessoa da mesma classe pra comparar")}
                {th("valorMedio", "Média", "média bruta dele na métrica, na janela", true)}
                {th("pctClasse", "vs classe", "contra a média das OUTRAS pessoas da mesma classe+tipo naquela war (classe do carimbo da war)")}
                {th("pctCore", "vs core", "contra os outros cores do grupo dele naquela war (sem core, os outros do grupo) — a mesma régua do /eu")}
              </tr>
            </thead>
            <tbody>
              {!rows.length && <tr><td colSpan={6} style={{ padding: 14, color: C.dim, textAlign: "center" }}>ninguém dessa classe com estatística na janela</td></tr>}
              {rows.map((l) => {
                const hoje = cadastro[l.nome_familia];
                const trocou = hoje && (hoje.classe !== combo?.classe || hoje.tipo !== combo?.tipo);
                const emFoco = foco && l.nome_familia === foco;
                const semCore = l.warsComCore === 0 || semGrupo(l.grupoRecente);
                return (
                  <tr key={l.nome_familia} style={{ borderTop: `1px solid ${C.borderSoft}`, background: emFoco ? "rgba(224,189,58,.10)" : undefined }}>
                    <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
                      {canEdit
                        ? <Link href={`/eu?de=${encodeURIComponent(l.nome_familia)}`} style={{ color: C.texto, textDecoration: "none", fontWeight: 600 }}>{l.nome_familia}</Link>
                        : <span style={{ color: C.texto, fontWeight: 600 }}>{l.nome_familia}</span>}
                      {l.foiCore && <span title="foi core do grupo em pelo menos uma war da janela" style={{ color: OURO, fontSize: 10, marginLeft: 6, border: `1px solid ${OURO}`, borderRadius: 4, padding: "0 4px" }}>core</span>}
                      {hoje && !hoje.ativo && <span style={{ color: C.dim, fontSize: 10.5, marginLeft: 6 }}>saiu</span>}
                      {trocou && hoje && <span title="trocou de classe depois dessas wars — o carimbo da época é o que vale aqui" style={{ color: C.dim, fontSize: 10.5, marginLeft: 6 }}>hoje: {hoje.classe ?? "?"}/{hoje.tipo ?? "?"}</span>}
                    </td>
                    <td style={{ padding: "5px 8px", color: semGrupo(l.grupoRecente) ? C.dim : C.mute, whiteSpace: "nowrap" }}>{semGrupo(l.grupoRecente) ? "—" : l.grupoRecente}</td>
                    <td style={{ padding: "5px 8px", color: C.mute, whiteSpace: "nowrap" }}>{l.wars}<span style={{ color: C.dim }}> · {l.warsComPar} c/ par</span></td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: C.texto, whiteSpace: "nowrap" }}>{formatarMetrica(metrica, l.valorMedio)}</td>
                    <td style={{ padding: "5px 8px", minWidth: 150, opacity: (l.paresMedio ?? 0) < 2 ? 0.45 : 1 }}
                        title={l.pctClasse == null ? "em nenhuma war da janela havia outra pessoa da mesma classe" : `régua de classe em ${l.warsComPar} de ${l.wars} wars · ~${Math.round(l.paresMedio ?? 0)} par(es) por war`}>
                      <BarraPct pct={l.pctClasse} semRegua="em nenhuma war da janela havia outra pessoa da mesma classe" />
                      {l.pctClasse != null && <span style={{ color: C.dim, fontSize: 10.5 }}>~{Math.round(l.paresMedio ?? 0)} par(es)</span>}
                    </td>
                    <td style={{ padding: "5px 8px", minWidth: 150, opacity: semCore ? 0.45 : 1 }}
                        title={semGrupo(l.grupoRecente) ? "sem grupo definido: a régua vira a média dos outros sem grupo, que mistura papéis" : l.warsComCore === 0 ? "sem core no grupo nessas wars: régua = os outros do grupo" : `régua do core em ${l.warsComCore} de ${l.wars} wars`}>
                      <BarraPct pct={l.pctCore} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="leg" style={{ color: C.dim, fontSize: 11, marginTop: 10, lineHeight: 1.6 }}>
          <b style={{ color: C.mute }}>vs classe</b> = contra a média das <b>outras</b> pessoas da mesma classe+tipo naquela war — a classe é a do
          carimbo da war, não a do cadastro de hoje (quem trocou de classe aparece com “hoje: …”). <b style={{ color: C.mute }}>vs core</b> = a mesma
          régua do /eu: os outros cores do grupo dele; sem core, os outros do grupo. Ninguém entra na própria régua. Cada % é limitada a 200%
          antes da média. Barra apagada = régua fraca (uma pessoa só na classe, ou grupo indefinido). Marcar alguém como <b>fora da régua</b> numa
          war o tira das duas médias. Os grupos são avaliados por suas próprias métricas em /config; aqui as cinco valem pra todo mundo.
          {semCarimbo.length > 0 && (
            <> <b style={{ color: OURO }}>{semCarimbo.length}</b> pessoa(s) jogaram sem classe/tipo no carimbo e ficam fora de todo balde:{" "}
              {semCarimbo.slice(0, 6).map((s) => `${s.nome_familia} (${s.wars})`).join(", ")}{semCarimbo.length > 6 ? "…" : ""} — defina a classe em /membros.</>
          )}
        </div>
      </div>
    </div>
  );
}
