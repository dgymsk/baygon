import { listEventos } from "@/lib/eventos";
import { listTemplates } from "@/lib/participacaoPt";
import { canEditNow } from "@/lib/requireAuth";
import EventosBoard from "./EventosBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Eventos · BAYGON" };

export type TemplateOpt = { id: number; nome: string; tipo: string; tamanhoMax: number | null };

// Ativos (aberto+travado) sempre; Histórico (finalizado) com busca server-side por texto/tipo/datas.
export default async function EventosPage({ searchParams }: { searchParams: Promise<{ q?: string; tipo?: string; de?: string; ate?: string; aba?: string }> }) {
  const sp = await searchParams;
  const aba = sp.aba === "historico" ? "historico" : "ativos";
  const [ativos, historico, templates, canEdit] = await Promise.all([
    listEventos({ status: "ativos", limit: 100 }),
    listEventos({ status: "historico", q: sp.q, tipo: sp.tipo, de: sp.de, ate: sp.ate, limit: 200 }),
    listTemplates(),
    canEditNow(),
  ]);
  const templateOpts: TemplateOpt[] = templates.map((t) => ({ id: t.id, nome: t.nome, tipo: t.tipo, tamanhoMax: t.tamanho_max }));
  return <EventosBoard ativos={ativos} historico={historico} templates={templateOpts} filtros={{ q: sp.q ?? "", tipo: sp.tipo ?? "", de: sp.de ?? "", ate: sp.ate ?? "" }} aba={aba} canEdit={canEdit} />;
}
