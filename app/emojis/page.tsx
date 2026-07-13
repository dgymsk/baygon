import { getEmojiMap } from "@/lib/emojiConfig";
import { listarEmojisGuild } from "@/lib/discordApi";
import { CLASSE_NOMES } from "@/lib/bdoClasses";
import { canEditNow } from "@/lib/requireAuth";
import { getGuildMeta } from "@/lib/guildConfig";
import EmojiConfigForm from "./EmojiConfigForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Emojis · BAYGON" };

export default async function EmojisPage() {
  const [mapa, emojis, canEdit, meta] = await Promise.all([getEmojiMap(), listarEmojisGuild(), canEditNow(), getGuildMeta()]);
  return <EmojiConfigForm initial={mapa} emojis={emojis} classes={CLASSE_NOMES} guildas={meta.guildas} canEdit={canEdit} />;
}
