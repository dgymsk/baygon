import { listPresets } from "@/lib/intencaoPreset";
import { listFuncoes } from "@/lib/funcao";
import { listParties } from "@/lib/party";
import { canEditNow } from "@/lib/requireAuth";
import PresetsBoard from "./PresetsBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chamadas · BAYGON" };

export default async function PresetsPage() {
  const [presets, funcoes, parties, canEdit] = await Promise.all([
    listPresets(), listFuncoes(), listParties(), canEditNow(),
  ]);
  return <PresetsBoard presets={presets} funcoes={funcoes} parties={parties} canEdit={canEdit} />;
}
