"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { C } from "@/lib/theme";

// menu global (canto inferior). Páginas de staff só aparecem pra quem edita.
const LINKS: { href: string; label: string; staff?: boolean }[] = [
  { href: "/painel", label: "🏠 Painel" },
  { href: "/membros", label: "👥 Membros" },
  { href: "/participacao", label: "📢 Participação" },
  { href: "/confirmados", label: "✅ Confirmados (Apollo)" },
  { href: "/confirmados-bot", label: "🤖 Confirmados (bot)" },
  { href: "/eventos", label: "📅 Eventos" },
  { href: "/hub", label: "🧩 Hub de eventos", staff: true },
  { href: "/gear", label: "⚔️ Gear" },
  { href: "/evolucao", label: "📈 Evolução" },
  { href: "/eu", label: "🧍 Minhas stats" },
  { href: "/guildas", label: "🛡️ Guildas", staff: true },
  { href: "/emojis", label: "😀 Emojis", staff: true },
  { href: "/config", label: "⚙️ Config", staff: true },
  { href: "/discord", label: "🤖 Discord", staff: true },
];

export default function NavMenu({ canEdit }: { canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const links = LINKS.filter((l) => !l.staff || canEdit);

  return (
    <div style={{ position: "relative", fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      {open && <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 49 }} />}
      <button
        type="button" onClick={() => setOpen((o) => !o)} title="Menu"
        style={{ cursor: "pointer", borderRadius: 999, border: `1px solid ${C.border2}`, background: open ? C.verdeTint : C.inputBg, color: open ? C.verde : C.mute, padding: "6px 12px", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}
      >
        ☰ Menu
      </button>
      {open && (
        <div className="menu-pop" style={{ position: "absolute", bottom: 40, right: 0, zIndex: 50, minWidth: 190, border: `1px solid ${C.border2}`, borderRadius: 12, background: C.bg0, boxShadow: "0 8px 30px rgba(0,0,0,.6)", padding: 6 }}>
          {links.map((l) => {
            const on = path === l.href || (l.href !== "/painel" && path?.startsWith(l.href + "/"));
            return (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)}
                style={{ display: "block", textDecoration: "none", borderRadius: 8, padding: "7px 11px", fontSize: 13, color: on ? C.verde : C.texto, background: on ? C.verdeTint : "transparent" }}>
                {l.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
