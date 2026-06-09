import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import { fetchConfirmados } from "@/lib/confirmados";

/**
 * Substituições manuais. Duas marcas, atreladas à war_key (auto-reset ao trocar a war):
 *   tipo='remover' — staff tira alguém do grupo do bot (abre vaga);
 *   tipo='subir'   — staff CONFIRMA quem sobe da espera pra ocupar a vaga.
 * Semântica "replace-all": o conjunto enviado É a verdade.
 */
export type RemocaoRow = { chave: string; familia: string; tipo: string };

async function readRemocoes(): Promise<RemocaoRow[]> {
  return (await sql`SELECT chave, familia, tipo FROM remocao_scan ORDER BY familia`) as RemocaoRow[];
}

/** LEITURA PURA (sem escrita — seguro no render). War nova → conjunto antigo não conta. */
export async function getRemocoes(currentWarKey: string | null): Promise<RemocaoRow[]> {
  if (!currentWarKey) return readRemocoes();
  const meta = (await sql`SELECT war_key FROM remocao_meta WHERE id = 1`) as { war_key: string | null }[];
  const stored = meta[0]?.war_key ?? null;
  if (stored !== currentWarKey) return [];
  return readRemocoes();
}

/**
 * Substitui todo o conjunto (remoções + promoções confirmadas) pelo enviado. Relê a
 * war ATUAL no servidor; rejeita cliente stale e não escreve com war desconhecida.
 */
export async function saveRemocoes(removidos: unknown, promovidos: unknown, warKeyCliente?: string | null): Promise<RemocaoRow[]> {
  const conf = await fetchConfirmados();
  const warKey = conf.ok ? (conf.messageId ?? null) : null;
  if (!warKey) return readRemocoes(); // war desconhecida (bot fora do ar) → não escreve (evita DELETE destrutivo)
  if (warKeyCliente && warKeyCliente !== warKey) return getRemocoes(warKey); // cliente stale → ignora

  const map = new Map<string, { familia: string; tipo: string }>();
  const add = (lista: unknown, tipo: string) => {
    for (const f of Array.isArray(lista) ? lista : []) {
      const familia = typeof f === "string" ? f.replace(/\s+/g, " ").trim() : "";
      const k = chaveNome(familia);
      if (k && !map.has(k)) map.set(k, { familia, tipo }); // remover tem prioridade (vem 1º)
    }
  };
  add(removidos, "remover");
  add(promovidos, "subir");

  const stmts = [sql`DELETE FROM remocao_scan`]; // replace-all
  stmts.push(sql`INSERT INTO remocao_meta (id, war_key) VALUES (1, ${warKey}) ON CONFLICT (id) DO UPDATE SET war_key = EXCLUDED.war_key`);
  for (const [k, v] of map) {
    stmts.push(sql`INSERT INTO remocao_scan (chave, familia, tipo, atualizado) VALUES (${k}, ${v.familia}, ${v.tipo}, now())`);
  }
  await sql.transaction(stmts);
  return readRemocoes();
}

export async function resetRemocoes(): Promise<void> {
  await sql`DELETE FROM remocao_scan`;
}
