import { getConfig } from "@/lib/config";
import { canEditNow } from "@/lib/requireAuth";
import ConfigForm from "./ConfigForm";

// sempre dados frescos do banco (não prerenderizar)
export const dynamic = "force-dynamic";

export const metadata = { title: "Configuração · BAYGON" };

export default async function ConfigPage() {
  const [config, canEdit] = await Promise.all([getConfig(), canEditNow()]);
  return <ConfigForm initial={config} canEdit={canEdit} />;
}
