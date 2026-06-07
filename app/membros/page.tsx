import { listPlayers } from "@/lib/players";
import { listGruposCanonicos } from "@/lib/grupos";
import { mediasMembros } from "@/lib/stats";
import { canEditNow } from "@/lib/requireAuth";
import MembrosTable from "./MembrosTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Membros · BAYGON" };

export default async function MembrosPage() {
  const [players, grupos, medias, canEdit] = await Promise.all([
    listPlayers(),
    listGruposCanonicos(),
    mediasMembros(),
    canEditNow(),
  ]);
  return <MembrosTable initial={players} gruposExtra={grupos} medias={medias} canEdit={canEdit} />;
}
