import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import { ehTipo } from "@/lib/participacaoConfig";

/**
 * PRESET — o formato da guerra: quais PTs entram em campo e quantas pessoas cabem no total.
 * É só isso. O preset NÃO decide funções.
 *
 * FUNÇÃO é atributo do JOGADOR (player_funcao): o que ele sabe fazer, valendo em todo preset.
 * Uma pessoa pode ter várias. No bot ela marca UMA — a que vai jogar naquela war.
 *
 * Fluxo: o bot colhe a função de hoje → na escalação você preenche as PTs do preset puxando
 * dos grupos de função.
 */
export type PresetParty = { party_id: number; ordem: number };
export type Preset = { id: number; nome: string; tipo: string; tamanho_max: number | null; canal_id: string | null; parties: PresetParty[] };
export type PlayerFuncao = { chave: string; familia: string; funcao_id: number };

const nomeOk = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 50) : "");
const famOk = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 80) : "");
const num = (v: unknown) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : null; };
const maxOk = (v: unknown) => { const n = num(v); return n != null && n > 0 && n <= 500 ? n : null; };

/** Ids de party sanitizados, sem repetidos, na ordem recebida. */
function partiesOk(raw: unknown): number[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: number[] = [];
  for (const x of arr) {
    const id = num(typeof x === "object" && x ? (x as { party_id?: unknown }).party_id : x);
    if (id != null && !out.includes(id)) out.push(id);
  }
  return out.slice(0, 40);
}

// ---------- presets ----------
export async function listPresets(): Promise<Preset[]> {
  const ps = (await sql`SELECT id::int AS id, nome, tipo, tamanho_max, canal_id FROM intencao_preset ORDER BY nome`) as Omit<Preset, "parties">[];
  if (!ps.length) return [];
  const vin = (await sql`SELECT preset_id::int AS preset_id, party_id::int AS party_id, ordem FROM intencao_preset_pt ORDER BY ordem, party_id`) as { preset_id: number; party_id: number; ordem: number }[];
  return ps.map((p) => ({ ...p, parties: vin.filter((v) => v.preset_id === p.id).map((v) => ({ party_id: v.party_id, ordem: v.ordem })) }));
}

export async function getPreset(id: number): Promise<Preset | null> {
  const rows = (await sql`SELECT id::int AS id, nome, tipo, tamanho_max, canal_id FROM intencao_preset WHERE id = ${id}`) as Omit<Preset, "parties">[];
  if (!rows[0]) return null;
  const parties = (await sql`SELECT party_id::int AS party_id, ordem FROM intencao_preset_pt WHERE preset_id = ${id} ORDER BY ordem, party_id`) as PresetParty[];
  return { ...rows[0], parties };
}

export async function criarPreset(nome: unknown, tipo: unknown, parties: unknown, tamanhoMax?: unknown): Promise<Preset | null> {
  const n = nomeOk(nome);
  if (!n || !ehTipo(tipo)) return null;
  const rows = (await sql`INSERT INTO intencao_preset (nome, tipo, tamanho_max) VALUES (${n}, ${tipo}, ${maxOk(tamanhoMax)}) RETURNING id::int AS id`) as { id: number }[];
  const id = rows[0]?.id;
  if (!id) return null;
  await gravarParties(id, partiesOk(parties));
  return getPreset(id);
}

export async function atualizarPreset(id: unknown, patch: { nome?: unknown; tipo?: unknown; parties?: unknown; tamanhoMax?: unknown; canalId?: unknown }): Promise<void> {
  const pid = num(id);
  if (pid == null) return;
  const n = nomeOk(patch.nome);
  if (n) {
    if (ehTipo(patch.tipo)) await sql`UPDATE intencao_preset SET nome = ${n}, tipo = ${patch.tipo} WHERE id = ${pid}`;
    else await sql`UPDATE intencao_preset SET nome = ${n} WHERE id = ${pid}`;
  }
  if (patch.tamanhoMax !== undefined) await sql`UPDATE intencao_preset SET tamanho_max = ${maxOk(patch.tamanhoMax)} WHERE id = ${pid}`;
  if (patch.canalId !== undefined) await sql`UPDATE intencao_preset SET canal_id = ${typeof patch.canalId === "string" ? patch.canalId.replace(/[^0-9]/g, "").slice(0, 25) || null : null} WHERE id = ${pid}`;
  if (patch.parties !== undefined) await gravarParties(pid, partiesOk(patch.parties));
}

export async function excluirPreset(id: unknown): Promise<void> {
  const pid = num(id);
  if (pid != null) await sql`DELETE FROM intencao_preset WHERE id = ${pid}`;
}

/** Reescreve os vínculos preset→PT; a ordem é a posição no array (ordem das colunas na escalação). */
async function gravarParties(presetId: number, partyIds: number[]): Promise<void> {
  await sql`DELETE FROM intencao_preset_pt WHERE preset_id = ${presetId}`;
  for (let i = 0; i < partyIds.length; i++) {
    await sql`INSERT INTO intencao_preset_pt (preset_id, party_id, ordem) VALUES (${presetId}, ${partyIds[i]}, ${i})
      ON CONFLICT (preset_id, party_id) DO UPDATE SET ordem = EXCLUDED.ordem`;
  }
}

// ---------- função do jogador (atributo dele, global, várias por pessoa) ----------
export async function listPlayerFuncoes(): Promise<PlayerFuncao[]> {
  return (await sql`SELECT chave, familia, funcao_id::int AS funcao_id FROM player_funcao ORDER BY familia`) as PlayerFuncao[];
}

export async function addPlayerFuncao(familia: unknown, funcaoId: unknown): Promise<void> {
  const fam = famOk(familia);
  const chave = chaveNome(fam);
  const fid = num(funcaoId);
  if (!chave || fid == null) return;
  await sql`INSERT INTO player_funcao (chave, familia, funcao_id) VALUES (${chave}, ${fam}, ${fid})
    ON CONFLICT (chave, funcao_id) DO UPDATE SET familia = EXCLUDED.familia`;
}

export async function delPlayerFuncao(familia: unknown, funcaoId: unknown): Promise<void> {
  const chave = chaveNome(famOk(familia));
  if (!chave) return;
  const fid = num(funcaoId);
  if (fid == null) await sql`DELETE FROM player_funcao WHERE chave = ${chave}`; // tira de todas
  else await sql`DELETE FROM player_funcao WHERE chave = ${chave} AND funcao_id = ${fid}`;
}
