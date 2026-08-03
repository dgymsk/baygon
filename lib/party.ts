import { sql } from "@/lib/db";
import { listarEmojisGuild, resolverEmoji } from "@/lib/discordApi";

/**
 * PARTY in-game — onde a pessoa fica de fato no jogo. É o ALVO da escalação: a staff pega quem
 * marcou uma função no bot e distribui nas parties.
 *
 * Lista livre (nome + ícone + ordem), sem tamanho fixo: o limite de vaga foi tirado de propósito
 * do fluxo todo. Não confundir com FUNÇÃO (lib/funcao.ts), que é o papel marcado no bot, nem com
 * o participacao_pt do bot legado.
 */
export type Party = { id: number; nome: string; icone: string; ordem: number };

const nomeOk = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 40) : "");
const iconeOk = (s: unknown) => (typeof s === "string" ? s.trim().slice(0, 64) : "");
const num = (v: unknown) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : null; };

export async function listParties(): Promise<Party[]> {
  return (await sql`SELECT id::int AS id, nome, COALESCE(icone,'') AS icone, ordem FROM party ORDER BY ordem, id`) as Party[];
}

export async function criarParty(nome: unknown, icone: unknown): Promise<Party | null> {
  const n = nomeOk(nome);
  if (!n) return null;
  const ic = resolverEmoji(iconeOk(icone), await listarEmojisGuild()) || null;
  const rows = (await sql`INSERT INTO party (nome, icone, ordem)
    VALUES (${n}, ${ic}, COALESCE((SELECT max(ordem) + 1 FROM party), 0))
    RETURNING id::int AS id, nome, COALESCE(icone,'') AS icone, ordem`) as Party[];
  return rows[0] ?? null;
}

export async function atualizarParty(id: unknown, patch: { nome?: unknown; icone?: unknown }): Promise<void> {
  const pid = num(id);
  const n = nomeOk(patch.nome);
  if (pid == null || !n) return;
  const ic = resolverEmoji(iconeOk(patch.icone), await listarEmojisGuild()) || null;
  await sql`UPDATE party SET nome = ${n}, icone = ${ic} WHERE id = ${pid}`;
}

/** Excluir a party solta quem estava escalado nela (FK ON DELETE SET NULL) — ninguém some. */
export async function excluirParty(id: unknown): Promise<void> {
  const pid = num(id);
  if (pid != null) await sql`DELETE FROM party WHERE id = ${pid}`;
}

export async function ordenarParties(ids: unknown): Promise<void> {
  const arr = Array.isArray(ids) ? ids.map(num).filter((x): x is number => x != null) : [];
  for (let i = 0; i < arr.length; i++) await sql`UPDATE party SET ordem = ${i} WHERE id = ${arr[i]}`;
}

/** Marcação de LENDÁRIO — propriedade da pessoa, NUNCA exibida no bot; só destaca na escalação. */
export async function setLendario(nomeFamilia: unknown, valor: boolean): Promise<void> {
  const n = typeof nomeFamilia === "string" ? nomeFamilia.trim().slice(0, 80) : "";
  if (!n) return;
  await sql`UPDATE players SET lendario = ${valor} WHERE nome_familia = ${n}`;
}

export async function listLendarios(): Promise<string[]> {
  const rows = (await sql`SELECT nome_familia FROM players WHERE lendario ORDER BY nome_familia`) as { nome_familia: string }[];
  return rows.map((r) => r.nome_familia);
}
