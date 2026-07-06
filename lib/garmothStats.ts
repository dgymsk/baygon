import { sql } from "@/lib/db";

/** Leituras do gear do Garmoth p/ a página /gear (ranking atual + evolução no tempo). */

export const gsDe = (ap: number | null, aap: number | null, dp: number | null): number | null =>
  ap != null && aap != null && dp != null ? Math.round((ap + aap) / 2 + dp) : null;

export type GearAtual = {
  nome_familia: string; classe_bdo: string | null; classe_tipo: string | null; guilda: string;
  garmoth_id: string | null; char_name: string | null; spec: string | null; level: number | null;
  ap: number | null; aap: number | null; dp: number | null; gs: number | null; atualizado: string | null;
};

/** Todos os players ATIVOS com build no Garmoth, ordenados por GS desc (ranking + seletor). */
export async function gearRanking(): Promise<GearAtual[]> {
  const rows = (await sql`
    SELECT p.nome_familia, p.classe_bdo, p.classe_tipo, p.guilda, p.garmoth_id,
           gb.char_name, gb.spec, gb.level, gb.ap, gb.aap, gb.dp, gb.atualizado::text AS atualizado
    FROM players p JOIN garmoth_build gb ON gb.nome_familia = p.nome_familia
    WHERE p.ativo
  `) as Omit<GearAtual, "gs">[];
  return rows
    .map((r) => ({ ...r, gs: gsDe(r.ap, r.aap, r.dp) }))
    .sort((a, b) => (b.gs ?? -1) - (a.gs ?? -1) || a.nome_familia.localeCompare(b.nome_familia, "pt-BR"));
}

export type PontoGear = { capturado: string; ap: number | null; aap: number | null; dp: number | null; gs: number | null };

/** Série de gear de um player no tempo (1 ponto por captura em que ap/aap/dp mudaram). */
export async function evolucaoGearPlayer(nome: string, from?: string, to?: string): Promise<PontoGear[]> {
  const de = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null;
  const ate = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : null;
  // binning por DIA no fuso da guilda (America/Sao_Paulo), igual ao resto do app — senão captura noturna cai no dia UTC seguinte
  const rows = (await sql`
    SELECT (capturado AT TIME ZONE 'America/Sao_Paulo')::text AS capturado, ap, aap, dp FROM garmoth_gear_hist
    WHERE nome_familia = ${nome}
      AND (${de}::date IS NULL OR (capturado AT TIME ZONE 'America/Sao_Paulo') >= ${de}::date)
      AND (${ate}::date IS NULL OR (capturado AT TIME ZONE 'America/Sao_Paulo') < (${ate}::date + 1))
    ORDER BY capturado
  `) as { capturado: string; ap: number | null; aap: number | null; dp: number | null }[];
  return rows.map((r) => ({ ...r, gs: gsDe(r.ap, r.aap, r.dp) }));
}

/** Intervalo de datas disponível no histórico (p/ os inputs de data). */
export async function gearBounds(): Promise<{ min: string | null; max: string | null }> {
  const r = (await sql`SELECT min(capturado AT TIME ZONE 'America/Sao_Paulo')::text AS min, max(capturado AT TIME ZONE 'America/Sao_Paulo')::text AS max FROM garmoth_gear_hist`) as { min: string | null; max: string | null }[];
  return { min: r[0]?.min ? r[0].min.slice(0, 10) : null, max: r[0]?.max ? r[0].max.slice(0, 10) : null };
}
