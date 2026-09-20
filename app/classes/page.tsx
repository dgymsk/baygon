import { canEditNow } from "@/lib/requireAuth";
import { cadastroClasses, combosClasse, comparativoClasse, janelaOk, semCarimboClasse } from "@/lib/statsClasse";
import Classes from "./Classes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Por classe · BAYGON" };

/**
 * /classes — todo mundo de uma classe+tipo, contra o core e entre si.
 *
 * Estado inteiro na URL (classe, tipo, n, m, foco), então o link é compartilhável e o cartão do
 * jogador em /membros aponta pra cá com a pessoa já destacada. Sem rota de API: a página é servidor,
 * e a consulta devolve as cinco métricas de uma vez — trocar de métrica é troca de cliente.
 */
export default async function ClassesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const n = janelaOk(s("n"));

  const [combos, cadastro, semCarimbo, canEdit] = await Promise.all([
    combosClasse(n), cadastroClasses(), semCarimboClasse(n), canEditNow(),
  ]);
  // combo pedido na URL, se existir na janela; senão o maior. Pedir uma classe que ninguém jogou
  // na janela cai no maior em vez de numa tabela vazia sem explicação.
  const pedido = combos.find((c) => c.classe === s("classe") && c.tipo === s("tipo")) ?? null;
  const combo = pedido ?? combos[0] ?? null;
  const linhas = combo ? await comparativoClasse(combo.classe, combo.tipo, n) : [];

  return (
    <Classes combos={combos} combo={combo} n={n} linhas={linhas} cadastro={cadastro} semCarimbo={semCarimbo}
      canEdit={canEdit} metricaInicial={s("m")} foco={s("foco")} />
  );
}
