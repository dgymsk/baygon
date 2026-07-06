import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import { ehTipo } from "@/lib/participacaoConfig";

/** Grupos do bot de participação (staff pré-atribui). Catálogo por tipo + atribuição fixa. */
export type Grupo = { id: number; tipo: string; nome: string; emoji: string; limite_max: number | null; ordem: number };
export type Membro = { tipo: string; chave: string; familia: string; grupo_id: number };

const nomeOk = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 50) : "");
const emojiOk = (s: unknown) => (typeof s === "string" ? s.trim().slice(0, 64) : "");
const limiteOk = (n: unknown) => { const v = Math.trunc(Number(n)); return Number.isFinite(v) && v > 0 && v <= 200 ? v : null; };

export async function listGrupos(tipo?: string): Promise<Grupo[]> {
  const rows = tipo
    ? await sql`SELECT id, tipo, nome, COALESCE(emoji,'') AS emoji, limite_max, ordem FROM participacao_grupo WHERE ativo AND tipo = ${tipo} ORDER BY ordem, id`
    : await sql`SELECT id, tipo, nome, COALESCE(emoji,'') AS emoji, limite_max, ordem FROM participacao_grupo WHERE ativo ORDER BY tipo, ordem, id`;
  return rows as Grupo[];
}

export async function listMembros(tipo?: string): Promise<Membro[]> {
  const rows = tipo
    ? await sql`SELECT tipo, chave, familia, grupo_id FROM participacao_membro WHERE tipo = ${tipo}`
    : await sql`SELECT tipo, chave, familia, grupo_id FROM participacao_membro`;
  return rows as Membro[];
}

export async function criarGrupo(tipo: unknown, nome: unknown, emoji: unknown, limite: unknown): Promise<Grupo | null> {
  if (!ehTipo(tipo)) return null;
  const n = nomeOk(nome);
  if (!n) return null;
  const rows = (await sql`
    INSERT INTO participacao_grupo (tipo, nome, emoji, limite_max, ordem)
    VALUES (${tipo}, ${n}, ${emojiOk(emoji) || null}, ${limiteOk(limite)},
            (SELECT COALESCE(MAX(ordem), -1) + 1 FROM participacao_grupo WHERE tipo = ${tipo}))
    RETURNING id, tipo, nome, COALESCE(emoji,'') AS emoji, limite_max, ordem`) as Grupo[];
  return rows[0] ?? null;
}

export async function atualizarGrupo(id: unknown, patch: { nome?: unknown; emoji?: unknown; limite?: unknown }): Promise<void> {
  const gid = Math.trunc(Number(id));
  if (!Number.isFinite(gid)) return;
  const n = nomeOk(patch.nome);
  if (!n) return;
  // NÃO mexe em `ordem` (definida na criação) — editar nome/emoji/limite não reordena.
  await sql`UPDATE participacao_grupo SET nome = ${n}, emoji = ${emojiOk(patch.emoji) || null}, limite_max = ${limiteOk(patch.limite)} WHERE id = ${gid}`;
}

export async function excluirGrupo(id: unknown): Promise<void> {
  const gid = Math.trunc(Number(id));
  if (!Number.isFinite(gid)) return;
  await sql`DELETE FROM participacao_grupo WHERE id = ${gid}`; // cascata remove os membros
}

/** Atribui (ou remove, se grupoId null) um jogador a um grupo do tipo. */
export async function atribuirMembro(tipo: unknown, familia: unknown, grupoId: unknown): Promise<void> {
  if (!ehTipo(tipo)) return;
  const fam = typeof familia === "string" ? familia.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  const chave = chaveNome(fam);
  if (!chave) return;
  if (grupoId === null || grupoId === undefined || grupoId === "") {
    await sql`DELETE FROM participacao_membro WHERE tipo = ${tipo} AND chave = ${chave}`;
    return;
  }
  const gid = Math.trunc(Number(grupoId));
  if (!Number.isFinite(gid)) return;
  // só atribui se o grupo existe E é do mesmo tipo (evita cruzar nodewar/siege)
  await sql`
    INSERT INTO participacao_membro (tipo, chave, familia, grupo_id)
    SELECT ${tipo}, ${chave}, ${fam}, g.id FROM participacao_grupo g WHERE g.id = ${gid} AND g.tipo = ${tipo}
    ON CONFLICT (tipo, chave) DO UPDATE SET familia = EXCLUDED.familia, grupo_id = EXCLUDED.grupo_id`;
}
