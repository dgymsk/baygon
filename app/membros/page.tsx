import { listPlayers } from "@/lib/players";
import { listGruposCanonicos } from "@/lib/grupos";
import { mediasMembros } from "@/lib/stats";
import { canEditNow } from "@/lib/requireAuth";
import { getGuildMeta } from "@/lib/guildConfig";
import MembrosTable from "./MembrosTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Membros · BAYGON" };

export default async function MembrosPage() {
  const [players, grupos, medias, canEdit, meta] = await Promise.all([
    listPlayers(),
    listGruposCanonicos(),
    mediasMembros(),
    canEditNow(),
    getGuildMeta(),
  ]);
  return <MembrosTable initial={players} guildas={meta.guildas} gruposExtra={grupos} medias={medias} canEdit={canEdit} />;
}
