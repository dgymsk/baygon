import { gradePresenca } from "@/lib/presencaGlobal";
import { canEditNow } from "@/lib/requireAuth";
import PresencaBoard from "./PresencaBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Presença · BAYGON" };

/**
 * Grade global de presença: o elenco de uma guilda × os eventos de um período.
 *
 * O período padrão é a última semana e meia — longo o bastante pra enxergar quem sumiu, curto o
 * bastante pra caber na tela sem rolagem lateral no desktop.
 */
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function PresencaPage({ searchParams }: {
  searchParams: Promise<{ de?: string; ate?: string; guilda?: string; ev?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const hoje = new Date();
  const ateP = sp.ate ?? iso(hoje);
  const deP = sp.de ?? iso(new Date(hoje.getTime() - 10 * 864e5));
  const evP = Number(sp.ev);
  const eventoProvisorio = Number.isFinite(evP) && evP > 0 ? evP : null;

  const [grade, canEdit] = await Promise.all([
    gradePresenca({ de: deP, ate: ateP, guilda: sp.guilda ?? null, eventoProvisorio }),
    canEditNow(),
  ]);

  return (
    <PresencaBoard grade={grade} de={deP} ate={ateP} guilda={sp.guilda ?? ""}
      eventoProvisorio={eventoProvisorio} canEdit={canEdit} />
  );
}
