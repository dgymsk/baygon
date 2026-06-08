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

/** Extrai o nome de família do apelido do servidor (ex.: "[M] Doug" → "Doug"). */
function familiaDoNick(nick?: string | null): string | null {
  if (!nick) return null;
  const s = nick.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  return s || null;
}

/** Lê o membro no servidor: cargo de staff (pode editar) + família (do apelido).
 *  Sem cargos configurados → todo membro edita (comportamento atual). */
async function dadosMembro(accessToken: string): Promise<{ canEdit: boolean; familia: string | null }> {
  let canEdit = STAFF_ROLE_IDS.length === 0;
  let familia: string | null = null;
  for (const gid of GUILD_IDS) {
    try {
      const res = await fetch(`https://discord.com/api/users/@me/guilds/${gid}/member`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) continue;
      const member = (await res.json()) as { roles?: string[]; nick?: string | null; user?: { global_name?: string | null } };
      if (!familia) familia = familiaDoNick(member.nick) ?? familiaDoNick(member.user?.global_name);
      if (STAFF_ROLE_IDS.length && Array.isArray(member.roles) && member.roles.some((r) => STAFF_ROLE_IDS.includes(r))) canEdit = true;
    } catch {
      /* tenta o próximo guild */
    }
  }
  return { canEdit, familia };
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
    /** No login, resolve cargo (pode editar) + família (do apelido) e guarda no token. */
    async jwt({ token, account }) {
      if (account?.access_token) {
        const d = await dadosMembro(account.access_token);
        const t = token as { canEdit?: boolean; familia?: string | null };
        t.canEdit = d.canEdit;
        t.familia = d.familia;
      }
      return token;
    },
    async session({ session, token }) {
      // Sem cargos de staff configurados → todo logado edita (inclui sessões
      // antigas sem canEdit no token). Com staff configurado → vale o token.
      const semStaff = STAFF_ROLE_IDS.length === 0;
      const t = token as { canEdit?: boolean; familia?: string | null };
      const s = session as { canEdit?: boolean; familia?: string | null };
      s.canEdit = semStaff || t.canEdit === true;
      s.familia = t.familia ?? null;
      return session;
    },
  },
});
