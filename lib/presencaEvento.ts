import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";

/**
 * Confirmação in-game POR EVENTO — o passo "vai jogar a guerra", distinto da presença oficial
 * (que só existe quando as estatísticas da war entram).
 *
 * Existe separado do `participar_scan` de hoje porque aquele é um scan GLOBAL, resetado a cada
 * troca de war: serve pra tela do momento, mas não deixa histórico. Aqui a linha fica presa ao
 * evento, que é o que permite dizer "faz 3 guerras que marca e não aparece".
 */
export type PresencaRow = { chave: string; familia: string; participar: boolean; origem: string; atualizado: string | null };

export async function getPresenca(eventoId: number): Promise<PresencaRow[]> {
  return (await sql`SELECT chave, familia, participar, origem, atualizado::text AS atualizado FROM evento_presenca WHERE evento_id = ${eventoId} ORDER BY familia`) as PresencaRow[];
}

/** Upsert de um lote (a leitura por visão manda a lista inteira). Linha a linha = idempotente. */
export async function salvarPresenca(eventoId: number, membros: unknown, origem: "print" | "manual" = "print"): Promise<PresencaRow[]> {
  const lista = Array.isArray(membros) ? membros : [];
  for (const m of lista) {
    const o = (m ?? {}) as { familia?: unknown; participar?: unknown };
    const familia = typeof o.familia === "string" ? o.familia.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    const chave = chaveNome(familia);
    if (!chave) continue;
    await sql`INSERT INTO evento_presenca (evento_id, chave, familia, participar, origem, atualizado)
      VALUES (${eventoId}, ${chave}, ${familia}, ${!!o.participar}, ${origem}, now())
      ON CONFLICT (evento_id, chave) DO UPDATE SET familia = EXCLUDED.familia, participar = EXCLUDED.participar,
        origem = EXCLUDED.origem, atualizado = now()`;
  }
  return getPresenca(eventoId);
}

/** Liga/desliga uma pessoa na mão (override do que a visão leu). */
export async function marcarPresenca(eventoId: number, familia: string, participar: boolean): Promise<void> {
  const fam = familia.replace(/\s+/g, " ").trim().slice(0, 80);
  const chave = chaveNome(fam);
  if (!chave) return;
  await sql`INSERT INTO evento_presenca (evento_id, chave, familia, participar, origem, atualizado)
    VALUES (${eventoId}, ${chave}, ${fam}, ${participar}, 'manual', now())
    ON CONFLICT (evento_id, chave) DO UPDATE SET participar = EXCLUDED.participar, origem = 'manual', atualizado = now()`;
}
