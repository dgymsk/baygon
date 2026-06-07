import { listPlayers } from "@/lib/players";
import MembrosTable from "./MembrosTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Membros · Sala de Guerra" };

export default async function MembrosPage() {
  const players = await listPlayers();
  return <MembrosTable initial={players} />;
}
