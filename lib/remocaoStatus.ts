import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import { fetchConfirmados } from "@/lib/confirmados";

/**
 * Remoções manuais (staff marca quem sai do grupo do bot). Atreladas à mensagem
 * do bot (war_key) p/ auto-reset quando troca a war. Semântica "replace-all": o
 * conjunto enviado É a verdade (a lista é pequena — meia dúzia perto da guerra).
 */
export type RemocaoRow = { chave: string; familia: string };

async function readRemocoes(): Promise<RemocaoRow[]> {
  return (await sql`SELECT chave, familia FROM remocao_scan ORDER BY familia`) as RemocaoRow[];
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
 * Substitui todo o conjunto de remoções pelo enviado. Relê a war ATUAL no servidor.
 * `warKeyCliente` = a war que o board renderizou: se o bot já trocou de war, o
 * cliente está stale e NÃO gravamos seus nomes obsoletos como se fossem da war nova.
 */
export async function saveRemocoes(familias: unknown, warKeyCliente?: string | null): Promise<RemocaoRow[]> {
  const conf = await fetchConfirmados();
  const warKey = conf.ok ? (conf.messageId ?? null) : null;
  if (warKeyCliente && warKey && warKeyCliente !== warKey) return getRemocoes(warKey); // cliente stale → ignora

  const lista = Array.isArray(familias) ? familias : [];
  const map = new Map<string, string>();
  for (const f of lista) {
    const familia = typeof f === "string" ? f.replace(/\s+/g, " ").trim() : "";
    const k = chaveNome(familia);
    if (k) map.set(k, familia);
  }

  const stmts = [sql`DELETE FROM remocao_scan`]; // replace-all
  if (warKey) stmts.push(sql`INSERT INTO remocao_meta (id, war_key) VALUES (1, ${warKey}) ON CONFLICT (id) DO UPDATE SET war_key = EXCLUDED.war_key`);
  for (const [k, v] of map) {
    stmts.push(sql`INSERT INTO remocao_scan (chave, familia, atualizado) VALUES (${k}, ${v}, now())`);
  }
  await sql.transaction(stmts);
  return readRemocoes();
}

export async function resetRemocoes(): Promise<void> {
  await sql`DELETE FROM remocao_scan`;
}
