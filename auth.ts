import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";

// IDs dos servidores Discord cuja participação libera o acesso (1+ separados por vírgula).
const GUILD_IDS = (process.env.DISCORD_GUILD_ID ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

async function isInGuild(accessToken: string): Promise<boolean> {
  try {
    const res = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return false;
    const guilds = (await res.json()) as { id: string }[];
    return Array.isArray(guilds) && guilds.some((g) => GUILD_IDS.includes(g.id));
  } catch {
    return false;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  // Sessão curta: limita a janela de acesso de quem saiu/foi kikado do servidor
  // (a participação só é re-checada no login). Re-login re-roda a verificação.
  session: { maxAge: 60 * 60 * 8 }, // 8 horas
  // AUTH_DISCORD_ID / AUTH_DISCORD_SECRET são lidos do ambiente automaticamente.
  providers: [
    Discord({ authorization: { params: { scope: "identify guilds" } } }),
  ],
  pages: { signIn: "/login" },
  callbacks: {
    /** Só entra quem está no servidor Discord da guilda. Fail-closed. */
    async signIn({ account }) {
      if (!GUILD_IDS.length) return false; // sem servidor configurado → NINGUÉM entra
      const token = account?.access_token;
      return token ? await isInGuild(token) : false;
    },
  },
});
