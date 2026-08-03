import { listPresets, listMembrosInt } from "@/lib/intencaoPreset";
import { listPts } from "@/lib/participacaoPt";
import { listNomesFamilia } from "@/lib/players";
import { postsIntencaoAtivos } from "@/lib/intencao";
import { canEditNow } from "@/lib/requireAuth";
import IntencaoBoard from "./IntencaoBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Intenção · BAYGON" };

export default async function IntencaoPage() {
  const [presets, pts, membros, nomes, ativos, canEdit] = await Promise.all([
    listPresets(), listPts(), listMembrosInt(), listNomesFamilia(), postsIntencaoAtivos(), canEditNow(),
  ]);
  return <IntencaoBoard presets={presets} pts={pts} membros={membros} nomes={nomes} ativos={ativos} canEdit={canEdit} />;
}
