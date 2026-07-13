import { getGuildMeta, fetchAllianceFromDiscord } from "@/lib/guildConfig";
import { canEditNow } from "@/lib/requireAuth";
import GuildConfigForm from "./GuildConfigForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Guildas · BAYGON" };

export default async function GuildasPage() {
  const [config, discord, canEdit] = await Promise.all([getGuildMeta(), fetchAllianceFromDiscord(), canEditNow()]);
  return <GuildConfigForm initial={config} discord={discord} canEdit={canEdit} />;
}
