import { listFuncoes } from "@/lib/funcao";
import { listParties } from "@/lib/party";
import { listPresets, listPlayerFuncoes } from "@/lib/intencaoPreset";
import { listPlayers } from "@/lib/players";
import { canEditNow } from "@/lib/requireAuth";
import ConfigBoard from "./ConfigBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Definições · BAYGON" };

export default async function HubConfigPage() {
  const [funcoes, parties, presets, membros, players, canEdit] = await Promise.all([
    listFuncoes(), listParties(), listPresets(), listPlayerFuncoes(), listPlayers(), canEditNow(),
  ]);
  const jogadores = players.map((p: (typeof players)[number]) => ({ nome: p.nome_familia, lendario: !!p.lendario }));
  return <ConfigBoard funcoes={funcoes} parties={parties} presets={presets} membros={membros} jogadores={jogadores} canEdit={canEdit} />;
}
