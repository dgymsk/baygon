import { listFuncoes } from "@/lib/funcao";
import { listParties } from "@/lib/party";
import { listPresets, listPlayerFuncoes } from "@/lib/intencaoPreset";
import { getIntencaoConfig } from "@/lib/intencaoConfig";
import { listPlayers } from "@/lib/players";
import { getGuildMeta } from "@/lib/guildConfig";
import { listarRolesGuild } from "@/lib/discordApi";
import { canEditNow } from "@/lib/requireAuth";
import ConfigBoard from "./ConfigBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Definições · BAYGON" };

export default async function HubConfigPage() {
  const [funcoes, parties, presets, membros, players, canais, meta, roles, canEdit] = await Promise.all([
    listFuncoes(), listParties(), listPresets(), listPlayerFuncoes(), listPlayers(), getIntencaoConfig(), getGuildMeta(), listarRolesGuild(), canEditNow(),
  ]);
  const jogadores = players.map((p: (typeof players)[number]) => ({ nome: p.nome_familia, lendario: !!p.lendario, ativo: !!p.ativo, guilda: p.guilda }));
  return <ConfigBoard funcoes={funcoes} parties={parties} presets={presets} membros={membros} jogadores={jogadores} canais={canais} guildas={meta.guildas} roles={roles} canEdit={canEdit} />;
}
