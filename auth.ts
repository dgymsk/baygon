import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { getDiscordConfig } from "@/lib/discordConfig";

// O servidor ativo e os cargos de staff vêm da CONFIG (discord_config, com fallback pro env).

async function isInGuild(accessToken: string, guildId: string): Promise<boolean> {
  try {
    const res = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return false;
    const guilds = (await res.json()) as { id: string }[];
    return Array.isArray(guilds) && guilds.some((g) => g.id === guildId);
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

/** Lê o membro no servidor ativo: cargo de staff (pode editar) + família (do apelido).
 *  Sem cargos de staff configurados → todo membro edita. */
async function dadosMembro(accessToken: string, guildId: string, staffRoleIds: string[]): Promise<{ canEdit: boolean; familia: string | null }> {
  let canEdit = staffRoleIds.length === 0;
  let familia: string | null = null;
  try {
    const res = await fetch(`https://discord.com/api/users/@me/guilds/${guildId}/member`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const member = (await res.json()) as { roles?: string[]; nick?: string | null; user?: { global_name?: string | null } };
      familia = familiaDoNick(member.nick) ?? familiaDoNick(member.user?.global_name);
      if (staffRoleIds.length && Array.isArray(member.roles) && member.roles.some((r) => staffRoleIds.includes(r))) canEdit = true;
    }
  } catch { /* ignora */ }
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
    /** Só entra quem está no servidor ATIVO (da config). Fail-closed. */
    async signIn({ account }) {
      const { guildId } = await getDiscordConfig();
      if (!guildId) return false;
      const token = account?.access_token;
      return token ? await isInGuild(token, guildId) : false;
    },
    /**
     * No login, resolve cargo (pode editar), o ID do DISCORD e a família do apelido.
     *
     * O `discordId` é o que identifica a pessoa de verdade: ele vem do provedor e ninguém troca. O
     * apelido do servidor continua sendo lido, mas virou PLANO B — ver app/eu/page.tsx.
     *
     * Vem de `account.providerAccountId` e não de `token.sub` porque sub é detalhe do NextAuth
     * (muda se um dia entrar um adapter de banco); providerAccountId é o snowflake do Discord, que é
     * exatamente o que `players.discord_id` guarda.
     */
    async jwt({ token, account }) {
      if (account?.access_token) {
        const { guildId, staffRoleIds } = await getDiscordConfig();
        const d = await dadosMembro(account.access_token, guildId, staffRoleIds);
        const t = token as { canEdit?: boolean; familia?: string | null; discordId?: string | null };
        t.canEdit = d.canEdit;
        t.familia = d.familia;
        t.discordId = account.providerAccountId ?? (typeof token.sub === "string" ? token.sub : null);
      }
      return token;
    },
    async session({ session, token }) {
      const t = token as { canEdit?: boolean; familia?: string | null; discordId?: string | null };
      const s = session as { canEdit?: boolean; familia?: string | null; discordId?: string | null };
      s.canEdit = t.canEdit === true; // canEdit é resolvido no jwt (login) com a config
      s.familia = t.familia ?? null;
      s.discordId = t.discordId ?? (typeof token.sub === "string" ? token.sub : null);
      return session;
    },
  },
});
