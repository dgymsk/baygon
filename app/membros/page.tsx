import { listPlayers } from "@/lib/players";
import { listGruposCanonicos } from "@/lib/grupos";
import MembrosTable from "./MembrosTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Membros · BAYGON" };

export default async function MembrosPage() {
  const [players, grupos] = await Promise.all([listPlayers(), listGruposCanonicos()]);
  return <MembrosTable initial={players} gruposExtra={grupos} />;
}
