"use client";

import { C } from "@/lib/theme";

const VERDE_OK = "#3fbf5f";

/**
 * Uma medida na régua. A barra é 100% da largura quando a pessoa empatou com a referência, então o
 * traço vertical no meio é a régua — dá pra ler a coluna inteira sem ler número nenhum.
 *
 * O teto visual é 200%: acima disso a barra satura, e o número ao lado continua dizendo a verdade.
 * Sem teto, uma noite de 400% comprimiria todas as outras a nada.
 *
 * Compartilhada entre o cartão do jogador (/membros) e o comparativo por classe (/classes): a mesma
 * barra nas duas telas é o que faz "112%" significar a mesma coisa nas duas.
 */
export function BarraPct({ pct, semRegua = "jogou sozinho no grupo nessa guerra — não há com quem comparar" }: { pct: number | null; semRegua?: string }) {
  if (pct == null) return <span style={{ color: C.dim, fontSize: 11 }} title={semRegua}>sem régua</span>;
  const larg = Math.max(2, Math.min(pct, 200) / 2);   // 200% -> 100% da caixa
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ position: "relative", flex: "1 1 auto", height: 7, background: C.inputBg, borderRadius: 4, overflow: "hidden", minWidth: 40 }}>
        <div style={{ width: `${larg}%`, height: "100%", background: pct >= 100 ? VERDE_OK : C.mute, opacity: pct >= 100 ? 0.85 : 0.55 }} />
        {/* a régua: 100% cai exatamente no meio da caixa */}
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: C.border2 }} />
      </div>
      <span style={{ color: pct >= 100 ? VERDE_OK : C.mute, fontSize: 11.5, fontWeight: 700, minWidth: 38, textAlign: "right" }}>{Math.round(pct)}%</span>
    </div>
  );
}
