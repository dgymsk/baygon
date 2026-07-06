import { listEventos } from "@/lib/eventos";
import EventosBoard from "./EventosBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Eventos · BAYGON" };

// Registro/histórico de eventos (browse + detalhe). A OPERAÇÃO (disparar, acompanhar ao vivo,
// travar/finalizar) fica na aba Disparo/Situação de /participacao.
export default async function EventosPage({ searchParams }: { searchParams: Promise<{ q?: string; tipo?: string; de?: string; ate?: string; aba?: string }> }) {
  const sp = await searchParams;
  const aba = sp.aba === "historico" ? "historico" : "ativos";
  const [ativos, historico] = await Promise.all([
    listEventos({ status: "ativos", limit: 100 }),
    listEventos({ status: "historico", q: sp.q, tipo: sp.tipo, de: sp.de, ate: sp.ate, limit: 200 }),
  ]);
  return <EventosBoard ativos={ativos} historico={historico} filtros={{ q: sp.q ?? "", tipo: sp.tipo ?? "", de: sp.de ?? "", ate: sp.ate ?? "" }} aba={aba} />;
}
