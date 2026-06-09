"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Puxa o estado compartilhado periodicamente (router.refresh) pra duas pessoas
 * editarem junto. Só quando a aba está visível (poupa o rate-limit do Discord).
 */
export default function AutoSync({ ms = 15000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") router.refresh(); };
    const id = setInterval(tick, ms);
    const onVis = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [ms, router]);
  return null;
}
