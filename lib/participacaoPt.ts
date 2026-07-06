import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import { ehTipo } from "@/lib/participacaoConfig";
import { listarEmojisGuild, resolverEmoji } from "@/lib/discordApi";

/** Modelo do bot de participação: PTs (catálogo global) + atribuição por tipo + templates. */
export type Pt = { id: number; nome: string; emoji: string; cor: string }; // cor = "#rrggbb" ou "" (usa paleta)
export type Membro = { tipo: string; chave: string; familia: string; pt_id: number };
export type TemplatePt = { pt_id: number; limite: number | null }; // limite = quantos players nesse PT
export type Template = { id: number; nome: string; tipo: string; tamanho_max: number | null; pts: TemplatePt[] };

const nomeOk = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 50) : "");
const emojiOk = (s: unknown) => (typeof s === "string" ? s.trim().slice(0, 64) : "");
const corOk = (s: unknown) => (typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s.trim()) ? s.trim().toLowerCase() : null); // null → sem cor (paleta)
const limiteOk = (n: unknown) => { const v = Math.trunc(Number(n)); return Number.isFinite(v) && v > 0 && v <= 500 ? v : null; };
// ids serial vêm como BIGINT (string) do Postgres → normaliza p/ número em todo lugar (::int nas queries)

// ---------- PTs (catálogo global) ----------
export async function listPts(): Promise<Pt[]> {
  return (await sql`SELECT id::int AS id, nome, COALESCE(emoji,'') AS emoji, COALESCE(cor,'') AS cor FROM participacao_pt ORDER BY nome`) as Pt[];
}
export async function criarPt(nome: unknown, emoji: unknown, cor?: unknown): Promise<Pt | null> {
  const n = nomeOk(nome);
  if (!n) return null;
  const emj = resolverEmoji(emojiOk(emoji), await listarEmojisGuild()) || null;
  const rows = (await sql`INSERT INTO participacao_pt (nome, emoji, cor) VALUES (${n}, ${emj}, ${corOk(cor)}) RETURNING id::int AS id, nome, COALESCE(emoji,'') AS emoji, COALESCE(cor,'') AS cor`) as Pt[];
  return rows[0] ?? null;
}
export async function atualizarPt(id: unknown, patch: { nome?: unknown; emoji?: unknown; cor?: unknown }): Promise<void> {
  const pid = Math.trunc(Number(id));
  if (!Number.isFinite(pid)) return;
  const n = nomeOk(patch.nome);
  if (!n) return;
  const emj = resolverEmoji(emojiOk(patch.emoji), await listarEmojisGuild()) || null;
  await sql`UPDATE participacao_pt SET nome = ${n}, emoji = ${emj}, cor = ${corOk(patch.cor)} WHERE id = ${pid}`;
}
export async function excluirPt(id: unknown): Promise<void> {
  const pid = Math.trunc(Number(id));
  if (!Number.isFinite(pid)) return;
  await sql`DELETE FROM participacao_pt WHERE id = ${pid}`; // cascata remove membros e vínculos de template
}

// ---------- Atribuição (jogador → PT, por tipo) ----------
export async function listMembros(tipo?: string): Promise<Membro[]> {
  return (tipo
    ? await sql`SELECT tipo, chave, familia, pt_id::int AS pt_id FROM participacao_membro WHERE tipo = ${tipo}`
    : await sql`SELECT tipo, chave, familia, pt_id::int AS pt_id FROM participacao_membro`) as Membro[];
}
export async function atribuirMembro(tipo: unknown, familia: unknown, ptId: unknown): Promise<void> {
  if (!ehTipo(tipo)) return;
  const fam = typeof familia === "string" ? familia.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  const chave = chaveNome(fam);
  if (!chave) return;
  if (ptId === null || ptId === undefined || ptId === "") {
    await sql`DELETE FROM participacao_membro WHERE tipo = ${tipo} AND chave = ${chave}`;
    return;
  }
  const pid = Math.trunc(Number(ptId));
  if (!Number.isFinite(pid)) return;
  await sql`
    INSERT INTO participacao_membro (tipo, chave, familia, pt_id)
    SELECT ${tipo}, ${chave}, ${fam}, p.id FROM participacao_pt p WHERE p.id = ${pid}
    ON CONFLICT (tipo, chave) DO UPDATE SET familia = EXCLUDED.familia, pt_id = EXCLUDED.pt_id`;
}

// ---------- Templates ----------
async function sanPts(pts: unknown): Promise<TemplatePt[]> {
  const validos = new Set((await listPts()).map((p) => p.id));
  const seen = new Set<number>();
  const out: TemplatePt[] = [];
  for (const x of Array.isArray(pts) ? pts : []) {
    const o = (x ?? {}) as { ptId?: unknown; limite?: unknown };
    const pid = Math.trunc(Number(o.ptId));
    if (!Number.isFinite(pid) || !validos.has(pid) || seen.has(pid)) continue;
    seen.add(pid);
    out.push({ pt_id: pid, limite: limiteOk(o.limite) });
  }
  return out;
}
export async function listTemplates(): Promise<Template[]> {
  const tpls = (await sql`SELECT id::int AS id, nome, tipo, tamanho_max FROM participacao_template ORDER BY tipo, nome`) as Omit<Template, "pts">[];
  const rels = (await sql`SELECT template_id::int AS template_id, pt_id::int AS pt_id, limite FROM participacao_template_pt ORDER BY ordem, pt_id`) as { template_id: number; pt_id: number; limite: number | null }[];
  const porTpl = new Map<number, TemplatePt[]>();
  for (const r of rels) { const a = porTpl.get(r.template_id) ?? []; a.push({ pt_id: r.pt_id, limite: r.limite }); porTpl.set(r.template_id, a); }
  return tpls.map((t) => ({ ...t, pts: porTpl.get(t.id) ?? [] }));
}
export async function getTemplate(id: number): Promise<Template | null> {
  const rows = (await sql`SELECT id::int AS id, nome, tipo, tamanho_max FROM participacao_template WHERE id = ${id}`) as Omit<Template, "pts">[];
  if (!rows[0]) return null;
  const rels = (await sql`SELECT pt_id::int AS pt_id, limite FROM participacao_template_pt WHERE template_id = ${id} ORDER BY ordem, pt_id`) as { pt_id: number; limite: number | null }[];
  return { ...rows[0], pts: rels.map((r) => ({ pt_id: r.pt_id, limite: r.limite })) };
}
export async function criarTemplate(nome: unknown, tipo: unknown, tamanhoMax: unknown, pts: unknown): Promise<Template | null> {
  if (!ehTipo(tipo)) return null;
  const n = nomeOk(nome);
  if (!n) return null;
  const rows = (await sql`INSERT INTO participacao_template (nome, tipo, tamanho_max) VALUES (${n}, ${tipo}, ${limiteOk(tamanhoMax)}) RETURNING id::int AS id, nome, tipo, tamanho_max`) as Omit<Template, "pts">[];
  const tpl = rows[0];
  if (!tpl) return null;
  const p = await sanPts(pts);
  if (p.length) await sql.transaction(p.map((x, i) => sql`INSERT INTO participacao_template_pt (template_id, pt_id, ordem, limite) VALUES (${tpl.id}, ${x.pt_id}, ${i}, ${x.limite}) ON CONFLICT DO NOTHING`));
  return { ...tpl, pts: p };
}
export async function atualizarTemplate(id: unknown, patch: { nome?: unknown; tipo?: unknown; tamanhoMax?: unknown; pts?: unknown }): Promise<void> {
  const tid = Math.trunc(Number(id));
  if (!Number.isFinite(tid)) return;
  const n = nomeOk(patch.nome);
  if (!n || !ehTipo(patch.tipo)) return;
  const p = await sanPts(patch.pts);
  await sql.transaction([
    sql`UPDATE participacao_template SET nome = ${n}, tipo = ${patch.tipo}, tamanho_max = ${limiteOk(patch.tamanhoMax)} WHERE id = ${tid}`,
    sql`DELETE FROM participacao_template_pt WHERE template_id = ${tid}`,
    ...p.map((x, i) => sql`INSERT INTO participacao_template_pt (template_id, pt_id, ordem, limite) VALUES (${tid}, ${x.pt_id}, ${i}, ${x.limite}) ON CONFLICT DO NOTHING`),
  ]);
}
export async function excluirTemplate(id: unknown): Promise<void> {
  const tid = Math.trunc(Number(id));
  if (!Number.isFinite(tid)) return;
  await sql`DELETE FROM participacao_template WHERE id = ${tid}`;
}
