import { gearRanking, gearBounds } from "@/lib/garmothStats";
import GearEvolucao from "./GearEvolucao";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gear · BAYGON" };

export default async function GearPage() {
  const [ranking, bounds] = await Promise.all([gearRanking(), gearBounds()]);
  return <GearEvolucao ranking={ranking} minData={bounds.min} maxData={bounds.max} />;
}
