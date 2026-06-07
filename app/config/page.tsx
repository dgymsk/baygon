import { getConfig } from "@/lib/config";
import { getVagas } from "@/lib/vagas";
import { canEditNow } from "@/lib/requireAuth";
import ConfigForm from "./ConfigForm";

// sempre dados frescos do banco (não prerenderizar)
export const dynamic = "force-dynamic";

export const metadata = { title: "Configuração · BAYGON" };

export default async function ConfigPage() {
  const [config, canEdit, vagas] = await Promise.all([getConfig(), canEditNow(), getVagas()]);
  return <ConfigForm initial={config} canEdit={canEdit} vagasInit={vagas} />;
}
