import { listWars } from "@/lib/score";
import { listPlayers } from "@/lib/players";
import Evolucao from "./Evolucao";

export const dynamic = "force-dynamic";
export const metadata = { title: "Evolução · Sala de Guerra" };

export default async function EvolucaoPage() {
  const [wars, players] = await Promise.all([listWars(), listPlayers()]);
  const datas = wars.map((w) => w.data).sort();
  const grupos = [...new Set(players.filter((p) => p.grupo !== "Indefinido").map((p) => p.grupo))].sort();
  const playersComWar = players.filter((p) => p.n_wars > 0).map((p) => p.nome_familia).sort();
  return (
    <Evolucao
      minData={datas[0] ?? ""}
      maxData={datas[datas.length - 1] ?? ""}
      grupos={grupos}
      players={playersComWar}
    />
  );
}
