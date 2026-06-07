import { listWars } from "@/lib/score";
import Painel from "./Painel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Painel · Sala de Guerra" };

export default async function PainelPage() {
  const wars = await listWars();
  return <Painel wars={wars} />;
}
