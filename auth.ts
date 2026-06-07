import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";

// IDs dos servidores Discord cuja participação libera o acesso (1+ separados por vírgula).
const GUILD_IDS = (process.env.DISCORD_GUILD_ID ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  // AUTH_DISCORD_ID / AUTH_DISCORD_SECRET são lidos do ambiente automaticamente.
  providers: [
    Discord({ authorization: { params: { scope: "identify guilds" } } }),
  ],
  pages: { signIn: "/login" },
  callbacks: {
    /** Só entra quem está no servidor Discord da guilda (escopo `guilds`). */
    async signIn({ account }) {
      const token = account?.access_token;
      if (!token) return false;
      if (!GUILD_IDS.length) return true; // sem servidor configurado: não bloqueia por guild
      try {
        const res = await fetch("https://discord.com/api/users/@me/guilds", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return false;
        const guilds = (await res.json()) as { id: string }[];
        return Array.isArray(guilds) && guilds.some((g) => GUILD_IDS.includes(g.id));
      } catch {
        return false;
      }
    },
  },
});
