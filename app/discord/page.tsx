import { getDiscordConfig } from "@/lib/discordConfig";
import { canEditNow } from "@/lib/requireAuth";
import DiscordConfigForm from "./DiscordConfigForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Discord · BAYGON" };

export default async function DiscordPage() {
  const [cfg, canEdit] = await Promise.all([getDiscordConfig(), canEditNow()]);
  return <DiscordConfigForm initial={cfg} canEdit={canEdit} />;
}
