import { sql } from "@/lib/db";
import { listarEmojisGuild, resolverEmoji } from "@/lib/discordApi";

/**
 * FUNÇÃO — o papel que a pessoa marca no bot (Shai, Flanco, Ataque, Rangeds…). É o que vira
 * BOTÃO na chamada de intenção.
 *
 * Não confundir com PARTY (lib/party.ts): função é o papel, party é onde a pessoa fica in-game.
 * Uma função como Flanco reúne classes diferentes — o que importa é quem faz aquele papel.
 * Nasceu copiando participacao_pt com os mesmos ids; o catálogo antigo continua exclusivo do bot
 * de participação legado.
 */
export type Funcao = { id: number; nome: string; emoji: string; ordem: number;
  /** cargo do Discord exigido pra marcar esta função. null = aberta a todo mundo. */
  role_id: string | null };

const nomeOk = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 40) : "");
const emojiOk = (s: unknown) => (typeof s === "string" ? s.trim().slice(0, 64) : "");
const num = (v: unknown) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : null; };
// id de cargo é snowflake: só dígitos. Vazio vira null = "sem exigência".
const roleOk = (v: unknown) => { const s = typeof v === "string" ? v.replace(/[^0-9]/g, "").slice(0, 25) : ""; return s || null; };

export async function listFuncoes(): Promise<Funcao[]> {
  return (await sql`SELECT id::int AS id, nome, COALESCE(emoji,'') AS emoji, ordem, role_id FROM funcao ORDER BY ordem, id`) as Funcao[];
}

export async function criarFuncao(nome: unknown, emoji: unknown): Promise<Funcao | null> {
  const n = nomeOk(nome);
  if (!n) return null;
  const emj = resolverEmoji(emojiOk(emoji), await listarEmojisGuild()) || null;
  const rows = (await sql`INSERT INTO funcao (nome, emoji, ordem)
    VALUES (${n}, ${emj}, COALESCE((SELECT max(ordem) + 1 FROM funcao), 0))
    RETURNING id::int AS id, nome, COALESCE(emoji,'') AS emoji, ordem, role_id`) as Funcao[];
  return rows[0] ?? null;
}

export async function atualizarFuncao(id: unknown, patch: { nome?: unknown; emoji?: unknown; roleId?: unknown }): Promise<void> {
  const fid = num(id);
  if (fid == null) return;
  const n = nomeOk(patch.nome);
  if (n) {
    const emj = resolverEmoji(emojiOk(patch.emoji), await listarEmojisGuild()) || null;
    await sql`UPDATE funcao SET nome = ${n}, emoji = ${emj} WHERE id = ${fid}`;
  }
  // separado do nome: trocar só o cargo não deve exigir reenviar nome e emoji, e "sem cargo" é uma
  // escolha válida — por isso só mexe quando o campo veio no patch
  if (patch.roleId !== undefined) await sql`UPDATE funcao SET role_id = ${roleOk(patch.roleId)} WHERE id = ${fid}`;
}

/** Cargo exigido por uma função (null = aberta). Leitura enxuta pro gate do clique no bot. */
export async function roleDaFuncao(funcaoId: number): Promise<{ nome: string; roleId: string | null } | null> {
  const r = (await sql`SELECT nome, role_id FROM funcao WHERE id = ${funcaoId}`) as { nome: string; role_id: string | null }[];
  return r[0] ? { nome: r[0].nome, roleId: r[0].role_id } : null;
}

/** Some da função: cascata leva as marcas/atribuições/vínculos de preset que apontavam pra ela. */
export async function excluirFuncao(id: unknown): Promise<void> {
  const fid = num(id);
  if (fid != null) await sql`DELETE FROM funcao WHERE id = ${fid}`;
}

/** Reordena pela posição no array (a ordem dos botões na mensagem do bot). */
export async function ordenarFuncoes(ids: unknown): Promise<void> {
  const arr = Array.isArray(ids) ? ids.map(num).filter((x): x is number => x != null) : [];
  for (let i = 0; i < arr.length; i++) await sql`UPDATE funcao SET ordem = ${i} WHERE id = ${arr[i]}`;
}
