"use client";

import { useMemo, useState } from "react";
import { C } from "@/lib/theme";
import { chaveNome } from "@/lib/nomes";
import { METRICAS_RESULTADO } from "@/lib/metricasResultado";
import { formatarMetrica, abreviar, segParaTempo } from "@/lib/formatarMetrica";

/**
 * Os números da war, por jogador, do jeito que saíram do print — sem nota, sem régua, sem % contra
 * média. É o acompanhamento cru: quem estava escalado, quem apareceu, e o que cada um fez.
 *
 * Comparar contra benchmark é outra conversa e depende de config (grupo, core) que hoje não está de
 * pé; enquanto não estiver, um número relativo mentiria com cara de precisão. Soma e média da
 * guilda a tabela mostra porque saem direto do dado, sem interpretar nada.
 *
 * As duas linhas que mais interessam não são as maiores: quem foi escalado e NÃO tem estatística
 * (prometeu e não jogou) e quem tem estatística sem ter sido escalado (entrou por fora).
 */
export type LinhaStat = { nome_familia: string; valores: Record<string, number> };
export type ContextoJogador = { chave: string; escalado: boolean; confirmouIngame: boolean; party: string | null; lendario: boolean };

type Ordem = { col: string; desc: boolean };

export default function StatsWar({ stats, contexto, aliancas = [] }: { stats: LinhaStat[]; contexto: ContextoJogador[]; aliancas?: string[] }) {
  const [ordem, setOrdem] = useState<Ordem>({ col: "dano_em_player", desc: true });
  const [soEscalados, setSoEscalados] = useState(false);

  const ctxPorChave = useMemo(() => new Map(contexto.map((c) => [c.chave, c])), [contexto]);

  const linhas = useMemo(() => {
    const comStat = stats.map((s) => {
      const chave = chaveNome(s.nome_familia);
      const c = ctxPorChave.get(chave);
      return { chave, familia: s.nome_familia, valores: s.valores, jogou: true, ...vazio(c) };
    });
    // escalado sem estatística: não é linha faltando, é a informação principal — não jogou
    const chavesComStat = new Set(comStat.map((l) => l.chave));
    const ausentes = contexto
      .filter((c) => c.escalado && !chavesComStat.has(c.chave))
      .map((c) => ({ chave: c.chave, familia: c.chave, valores: {} as Record<string, number>, jogou: false, ...vazio(c) }));
    return [...comStat, ...ausentes];
  }, [stats, contexto, ctxPorChave]);

  const ordenadas = useMemo(() => {
    const dir = ordem.desc ? -1 : 1;
    return [...linhas].sort((a, b) => {
      if (ordem.col === "familia") return a.familia.localeCompare(b.familia, "pt-BR") * dir;
      const va = a.valores[ordem.col], vb = b.valores[ordem.col];
      // quem não tem o número fica sempre no fim, independente da direção — senão inverter a ordem
      // enche a primeira tela de traços
      if (va == null && vb == null) return a.familia.localeCompare(b.familia, "pt-BR");
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
  }, [linhas, ordem]);

  const visiveis = soEscalados ? ordenadas.filter((l) => l.escalado) : ordenadas;

  /** Soma e média sobre quem TEM o número — média com ausente viraria outra conta. */
  const totais = useMemo(() => {
    const out: Record<string, { soma: number; n: number }> = {};
    for (const m of METRICAS_RESULTADO) {
      let soma = 0, n = 0;
      for (const l of linhas) { const v = l.valores[m.metrica]; if (v != null && Number.isFinite(v)) { soma += v; n++; } }
      out[m.metrica] = { soma, n };
    }
    return out;
  }, [linhas]);

  const nJogaram = linhas.filter((l) => l.jogou).length;
  const nFaltaram = linhas.filter((l) => l.escalado && !l.jogou).length;
  const nSemEscalar = linhas.filter((l) => l.jogou && !l.escalado).length;

  if (!stats.length) return null;

  const th = (col: string, rot: string, titulo?: string) => (
    <th key={col} onClick={() => setOrdem((o) => ({ col, desc: o.col === col ? !o.desc : true }))}
      title={titulo ?? `ordenar por ${rot}`}
      style={{ padding: "6px 8px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", textAlign: col === "familia" ? "left" : "right", color: ordem.col === col ? C.verde : C.mute, userSelect: "none" }}>
      {rot}{ordem.col === col ? (ordem.desc ? " ▾" : " ▴") : ""}
    </th>
  );

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ color: C.verde, fontWeight: 700, fontSize: 13 }}>Números da war</span>
        {aliancas.length > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }} title="alianças que estavam em campo">
            <span style={{ color: C.mute, fontSize: 11 }}>contra</span>
            {aliancas.map((a) => (
              <span key={a} style={{ border: `1px solid ${C.border2}`, borderRadius: 999, background: C.inputBg, color: C.texto, padding: "1px 8px", fontSize: 11 }}>{a}</span>
            ))}
          </span>
        )}
        <span style={{ color: C.mute, fontSize: 12 }}>
          <b style={{ color: C.texto }}>{nJogaram}</b> com estatística
          {nFaltaram > 0 && <> · <b style={{ color: C.vermelho }}>{nFaltaram}</b> escalados que não jogaram</>}
          {nSemEscalar > 0 && <> · <b style={{ color: C.amarelo }}>{nSemEscalar}</b> jogaram sem estar escalados</>}
        </span>
        <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, color: C.mute, fontSize: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={soEscalados} onChange={(e) => setSoEscalados(e.target.checked)} /> só escalados
        </label>
      </div>
      <div style={{ color: C.borderSoft, fontSize: 11, marginBottom: 8 }}>
        Números crus do print, sem comparação com média. Clique no cabeçalho pra ordenar.
      </div>

      <div style={{ border: `1px solid ${C.border2}`, borderRadius: 10, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
          <thead>
            <tr style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5, background: C.inputBg }}>
              {th("familia", "Jogador")}
              <th style={{ padding: "6px 8px", fontWeight: 600, color: C.mute, whiteSpace: "nowrap" }}>PT</th>
              {METRICAS_RESULTADO.map((m) => th(m.metrica, m.rotulo, m.dica))}
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => (
              <tr key={l.chave} style={{ borderTop: `1px solid ${C.borderSoft}`, background: !l.jogou ? "rgba(204,0,0,.10)" : l.jogou && !l.escalado ? "rgba(214,178,42,.08)" : undefined }}>
                <td style={{ padding: "5px 8px", color: C.texto, whiteSpace: "nowrap" }}>
                  {l.familia}
                  {!l.jogou && <span style={{ color: C.vermelho, fontSize: 10, marginLeft: 5 }}>não jogou</span>}
                  {l.jogou && !l.escalado && <span style={{ color: C.amarelo, fontSize: 10, marginLeft: 5 }}>fora da escalação</span>}
                </td>
                <td style={{ padding: "5px 8px", color: l.party ? C.verde : C.borderSoft, whiteSpace: "nowrap" }}>{l.party ?? "—"}</td>
                {METRICAS_RESULTADO.map((m) => (
                  <td key={m.metrica} style={{ padding: "5px 8px", textAlign: "right", whiteSpace: "nowrap", color: l.valores[m.metrica] == null ? C.borderSoft : C.mute }}>
                    {formatarMetrica(m.metrica, l.valores[m.metrica])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: `2px solid ${C.border2}`, background: C.inputBg, color: C.texto, fontWeight: 700 }}>
              <td style={{ padding: "6px 8px" }}>Total da guilda</td>
              <td />
              {METRICAS_RESULTADO.map((m) => (
                <td key={m.metrica} style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                  {m.formato === "tempo" ? "—" : totais[m.metrica].n ? abreviar(totais[m.metrica].soma) : "—"}
                </td>
              ))}
            </tr>
            <tr style={{ background: C.inputBg, color: C.mute, fontSize: 11 }}>
              <td style={{ padding: "0 8px 6px" }}>Média por jogador</td>
              <td />
              {METRICAS_RESULTADO.map((m) => {
                const t = totais[m.metrica];
                const med = t.n ? t.soma / t.n : null;
                return (
                  <td key={m.metrica} style={{ padding: "0 8px 6px", textAlign: "right", whiteSpace: "nowrap" }}>
                    {med == null ? "—" : m.formato === "tempo" ? segParaTempo(med) : abreviar(med)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

const vazio = (c?: ContextoJogador) => ({
  escalado: !!c?.escalado, confirmouIngame: !!c?.confirmouIngame, party: c?.party ?? null, lendario: !!c?.lendario,
});
