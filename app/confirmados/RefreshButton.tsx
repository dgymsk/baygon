"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { C } from "@/lib/theme";

export default function RefreshButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <button
      onClick={() => { setLoading(true); router.refresh(); setTimeout(() => setLoading(false), 1500); }}
      disabled={loading}
      style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.verdeTint, color: C.verde, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
    >
      {loading ? "Atualizando…" : "↻ Atualizar"}
    </button>
  );
}
