import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import { ehTipo } from "@/lib/participacaoConfig";

/**
 * Preset do bot de INTENÇÃO: quais PTs viram botão, em que ordem, e a "PT de casa" de cada
 * jogador — que aqui pode ser MAIS DE UMA (é a diferença central pro participacao_membro antigo,
 * cuja PK (tipo, chave) só admite uma).
 *
 * O catálogo de PTs (participacao_pt) é COMPARTILHADO e só lido daqui — quem cria/edita PT
 * continua sendo a tela /participacao.
 */
export type PresetPt = { pt_id: number; ordem: number };
export type Preset = { id: number; nome: string; tipo: string; pts: PresetPt[] };
export type MembroInt = { tipo: string; chave: string; familia: string; pt_id: number };

const nomeOk = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 50) : "");
const famOk = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 80) : "");
const num = (v: unknown) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : null; };

/** Lista de ids de PT sanitizada, sem repetidos, preservando a ordem recebida. */
function ptsOk(raw: unknown): number[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: number[] = [];
  for (const x of arr) {
    const id = num(typeof x === "object" && x ? (x as { pt_id?: unknown }).pt_id : x);
    if (id != null && !out.includes(id)) out.push(id);
  }
  return out.slice(0, 24); // teto dos botões (25 componentes menos o ❌)
}

// ---------- presets ----------
export async function listPresets(): Promise<Preset[]> {
  const ps = (await sql`SELECT id::int AS id, nome, tipo FROM intencao_preset ORDER BY nome`) as Omit<Preset, "pts">[];
  if (!ps.length) return [];
  const vin = (await sql`SELECT preset_id::int AS preset_id, pt_id::int AS pt_id, ordem FROM intencao_preset_pt ORDER BY ordem, pt_id`) as { preset_id: number; pt_id: number; ordem: number }[];
  return ps.map((p) => ({ ...p, pts: vin.filter((v) => v.preset_id === p.id).map((v) => ({ pt_id: v.pt_id, ordem: v.ordem })) }));
}

export async function getPreset(id: number): Promise<Preset | null> {
  const rows = (await sql`SELECT id::int AS id, nome, tipo FROM intencao_preset WHERE id = ${id}`) as Omit<Preset, "pts">[];
  if (!rows[0]) return null;
  const pts = (await sql`SELECT pt_id::int AS pt_id, ordem FROM intencao_preset_pt WHERE preset_id = ${id} ORDER BY ordem, pt_id`) as PresetPt[];
  return { ...rows[0], pts };
}

export async function criarPreset(nome: unknown, tipo: unknown, pts: unknown): Promise<Preset | null> {
  const n = nomeOk(nome);
  if (!n || !ehTipo(tipo)) return null;
  const rows = (await sql`INSERT INTO intencao_preset (nome, tipo) VALUES (${n}, ${tipo}) RETURNING id::int AS id`) as { id: number }[];
  const id = rows[0]?.id;
  if (!id) return null;
  await gravarPts(id, ptsOk(pts));
  return getPreset(id);
}

export async function atualizarPreset(id: unknown, patch: { nome?: unknown; tipo?: unknown; pts?: unknown }): Promise<void> {
  const pid = num(id);
  if (pid == null) return;
  const n = nomeOk(patch.nome);
  if (n && ehTipo(patch.tipo)) await sql`UPDATE intencao_preset SET nome = ${n}, tipo = ${patch.tipo} WHERE id = ${pid}`;
  else if (n) await sql`UPDATE intencao_preset SET nome = ${n} WHERE id = ${pid}`;
  if (patch.pts !== undefined) await gravarPts(pid, ptsOk(patch.pts));
}

export async function excluirPreset(id: unknown): Promise<void> {
  const pid = num(id);
  if (pid != null) await sql`DELETE FROM intencao_preset WHERE id = ${pid}`; // cascata leva os vínculos
}

/** Reescreve os vínculos preset→PT com a ordem sendo a posição no array. */
async function gravarPts(presetId: number, ptIds: number[]): Promise<void> {
  await sql`DELETE FROM intencao_preset_pt WHERE preset_id = ${presetId}`;
  for (let i = 0; i < ptIds.length; i++) {
    await sql`INSERT INTO intencao_preset_pt (preset_id, pt_id, ordem) VALUES (${presetId}, ${ptIds[i]}, ${i})
      ON CONFLICT (preset_id, pt_id) DO UPDATE SET ordem = EXCLUDED.ordem`;
  }
}

// ---------- "PT de casa" (MÚLTIPLA por jogador) ----------
export async function listMembrosInt(tipo?: string): Promise<MembroInt[]> {
  return (tipo
    ? await sql`SELECT tipo, chave, familia, pt_id::int AS pt_id FROM intencao_membro WHERE tipo = ${tipo} ORDER BY familia`
    : await sql`SELECT tipo, chave, familia, pt_id::int AS pt_id FROM intencao_membro ORDER BY familia`) as MembroInt[];
}

export async function adicionarMembroPt(tipo: unknown, familia: unknown, ptId: unknown): Promise<void> {
  if (!ehTipo(tipo)) return;
  const fam = famOk(familia);
  const chave = chaveNome(fam);
  const pid = num(ptId);
  if (!chave || pid == null) return;
  await sql`INSERT INTO intencao_membro (tipo, chave, familia, pt_id) VALUES (${tipo}, ${chave}, ${fam}, ${pid})
    ON CONFLICT (tipo, chave, pt_id) DO UPDATE SET familia = EXCLUDED.familia`;
}

export async function removerMembroPt(tipo: unknown, familia: unknown, ptId: unknown): Promise<void> {
  if (!ehTipo(tipo)) return;
  const chave = chaveNome(famOk(familia));
  if (!chave) return;
  const pid = num(ptId);
  // sem pt_id → tira a pessoa de TODAS as PTs daquele tipo
  if (pid == null) await sql`DELETE FROM intencao_membro WHERE tipo = ${tipo} AND chave = ${chave}`;
  else await sql`DELETE FROM intencao_membro WHERE tipo = ${tipo} AND chave = ${chave} AND pt_id = ${pid}`;
}
