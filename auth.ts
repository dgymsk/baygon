import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";

// Servidores que liberam acesso, e cargos que liberam EDIÇÃO (IDs, separados por vírgula).
const GUILD_IDS = (process.env.DISCORD_GUILD_ID ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const STAFF_ROLE_IDS = (process.env.DISCORD_STAFF_ROLE_IDS ?? "")
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

/** True se o usuário tem algum cargo de staff. Sem cargos configurados → todo
 *  membro edita (comportamento atual, até a guilda definir os cargos). */
async function isEditor(accessToken: string): Promise<boolean> {
  if (!STAFF_ROLE_IDS.length) return true;
  for (const gid of GUILD_IDS) {
    try {
      const res = await fetch(`https://discord.com/api/users/@me/guilds/${gid}/member`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) continue;
      const member = (await res.json()) as { roles?: string[] };
      if (Array.isArray(member.roles) && member.roles.some((r) => STAFF_ROLE_IDS.includes(r))) return true;
    } catch {
      /* tenta o próximo guild */
    }
  }
  return false;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { maxAge: 60 * 60 * 8 }, // 8h — re-login re-checa servidor + cargos
  providers: [
    Discord({ authorization: { params: { scope: "identify guilds guilds.members.read" } } }),
  ],
  pages: { signIn: "/login" },
  callbacks: {
    /** Só entra quem está no servidor da guilda. Fail-closed. */
    async signIn({ account }) {
      if (!GUILD_IDS.length) return false;
      const token = account?.access_token;
      return token ? await isInGuild(token) : false;
    },
    /** No login, resolve se pode editar (cargo de staff) e guarda no token. */
    async jwt({ token, account }) {
      if (account?.access_token) {
        (token as { canEdit?: boolean }).canEdit = await isEditor(account.access_token);
      }
      return token;
    },
    async session({ session, token }) {
      // Sem cargos de staff configurados → todo logado edita (inclui sessões
      // antigas sem canEdit no token). Com staff configurado → vale o token.
      const semStaff = STAFF_ROLE_IDS.length === 0;
      (session as { canEdit?: boolean }).canEdit = semStaff || (token as { canEdit?: boolean }).canEdit === true;
      return session;
    },
  },
});
