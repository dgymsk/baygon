import { getConfig } from "@/lib/config";
import ConfigForm from "./ConfigForm";

// sempre dados frescos do banco (não prerenderizar)
export const dynamic = "force-dynamic";

export const metadata = { title: "Configuração · Sala de Guerra" };

export default async function ConfigPage() {
  const config = await getConfig();
  return <ConfigForm initial={config} />;
}
