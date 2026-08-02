import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import { fetchConfirmados } from "@/lib/confirmados";

/**
 * Substituições manuais, por LINHA (delta) — seguro p/ duas pessoas editando junto:
 * cada ação mexe só na sua linha, sem sobrescrever o que o outro fez.
 *   tipo='remover' — staff tira alguém do grupo do bot (abre vaga);
 *   tipo='subir'   — staff CONFIRMA quem sobe da espera pra ocupar a vaga.
 * Atrelado à war_key (auto-reset ao trocar a war).
 */
export type RemocaoRow = { chave: string; familia: string; tipo: string };
export type RemocaoOp = { familia: string; tipo?: "remover" | "subir" | null };

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
 * Aplica um lote de deltas (upsert/delete por linha). Relê a war no servidor; rejeita
 * cliente stale e não escreve com war desconhecida; limpa o scan ao trocar de war.
 */
export async function aplicarOps(ops: unknown, warKeyCliente?: string | null): Promise<RemocaoRow[]> {
  // resolve pela war que o CLIENTE está vendo (pode ser uma sala escolhida à mão no seletor)
  const conf = await fetchConfirmados({ warKey: warKeyCliente ?? undefined });
  const warKey = conf.ok ? (conf.messageId ?? null) : null;
  if (!warKey) return readRemocoes(); // war desconhecida (bot fora) → não escreve
  if (warKeyCliente && warKeyCliente !== warKey) return getRemocoes(warKey); // cliente stale

  const lista = Array.isArray(ops) ? ops : [];
  // limpa só se a war mudou — guardado pela meta DENTRO da transação (atômico): se outro
  // cliente já carimbou a war nova, este DELETE vira no-op e não apaga o op dele.
  const stmts = [sql`DELETE FROM remocao_scan WHERE (SELECT war_key FROM remocao_meta WHERE id = 1) IS DISTINCT FROM ${warKey}`];
  stmts.push(sql`INSERT INTO remocao_meta (id, war_key) VALUES (1, ${warKey}) ON CONFLICT (id) DO UPDATE SET war_key = EXCLUDED.war_key`);
  for (const o of lista) {
    const famRaw = (o as { familia?: unknown })?.familia;
    const familia = typeof famRaw === "string" ? famRaw.replace(/\s+/g, " ").trim() : "";
    const k = chaveNome(familia);
    if (!k) continue;
    const tipo = (o as { tipo?: unknown })?.tipo;
    if (tipo === "remover" || tipo === "subir") {
      stmts.push(sql`INSERT INTO remocao_scan (chave, familia, tipo, atualizado) VALUES (${k}, ${familia}, ${tipo}, now())
        ON CONFLICT (chave) DO UPDATE SET familia = EXCLUDED.familia, tipo = EXCLUDED.tipo, atualizado = now()`);
    } else {
      stmts.push(sql`DELETE FROM remocao_scan WHERE chave = ${k}`);
    }
  }
  await sql.transaction(stmts);
  return readRemocoes();
}

export async function resetRemocoes(): Promise<void> {
  await sql`DELETE FROM remocao_scan`;
}
