"use client";

import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";

// seletor do evento ativo do bot (navega ?ev=uuid). Some quando só há 1 (ou nenhum).
export default function EventoSelect({ eventos, atual }: { eventos: { uuid: string; titulo: string; tipo: string }[]; atual: string | null }) {
  const router = useRouter();
  if (eventos.length <= 1) return null;
  return (
    <select value={atual ?? ""} onChange={(e) => router.push(`/confirmados-bot?ev=${e.target.value}`)}
      title="evento do bot" style={{ background: C.inputBg, color: C.texto, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "6px 10px", fontSize: 13, fontFamily: "inherit", cursor: "pointer", outline: "none" }}>
      {eventos.map((e) => <option key={e.uuid} value={e.uuid}>{e.titulo} · {e.tipo}</option>)}
    </select>
  );
}
