"use client";

import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import type { SalaConf, Escolha } from "@/lib/confirmados";

/**
 * Seletor da sala do Apollo. O padrão é AUTOMÁTICO (a war de hoje) — o Apollo publica a war
 * de amanhã ~20:20, então "post mais recente" trocava a tela no meio da war em andamento.
 * Some quando só há uma sala configurada.
 */
export default function SalaSelect({ salas, atual, escolha }: { salas: SalaConf[]; atual: string | null; escolha?: Escolha }) {
  const router = useRouter();
  if (salas.length <= 1) return null;

  const hora = (u?: number) =>
    u ? new Date(u * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit" }) : "sem evento";

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <select
        value={escolha === "manual" ? (atual ?? "") : ""}
        onChange={(e) => router.push(e.target.value ? `/confirmados?sala=${e.target.value}` : "/confirmados")}
        title="qual sala do Apollo ler"
        style={{ background: C.inputBg, color: C.texto, border: `1px solid ${escolha === "manual" ? C.amarelo : C.border2}`, borderRadius: 8, padding: "4px 8px", fontSize: 12, fontFamily: "inherit", cursor: "pointer", outline: "none", maxWidth: 260 }}
      >
        <option value="">🕑 Automático (war de hoje)</option>
        {salas.map((s) => (
          <option key={s.id} value={s.id}>
            {s.hoje ? "• " : ""}#{s.nome ?? s.id} — {s.titulo ? `${s.titulo}, ` : ""}{hora(s.inicioUnix)}
          </option>
        ))}
      </select>
      {escolha === "manual" && (
        <button
          onClick={() => router.push("/confirmados")}
          title="voltar pra escolha automática"
          style={{ borderRadius: 6, border: `1px solid ${C.border2}`, background: "transparent", color: C.mute, cursor: "pointer", fontSize: 11, padding: "2px 7px" }}
        >
          ↺ auto
        </button>
      )}
    </span>
  );
}
