/**
 * Integração com a API do Garmoth (gear/build de cada personagem BDO).
 * Doc: GET https://api.garmoth.com/api/external/gear-planner/getCharacterBuilds?ids=a,b,c
 *      header apiKey: <GARMOTH_API_KEY>. Resposta = array de personagens.
 * O worker (sempre-ligado) dispara atualizarTodos() a cada 2h via POST /api/garmoth/refresh.
 */
import { sql } from "@/lib/db";
import { parseGarmothId } from "@/lib/garmothId";

export { parseGarmothId };

export type GarmothScore = { ap?: number; aap?: number; dp?: number; acc?: number; [k: string]: number | undefined };
export type GarmothChar = { name?: string; class?: number; url?: string; level?: number; spec?: string; builds?: { score?: GarmothScore }[] };
export type BuildResumo = { garmoth_id: string; char_name: string | null; char_class: number | null; spec: string | null; level: number | null; ap: number | null; aap: number | null; dp: number | null; acc: number | null; dados: GarmothChar };

const BASE = "https://api.garmoth.com/api/external/gear-planner/getCharacterBuilds";
const inteiro = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x) : null);

/** Extrai os campos que exibimos/ordenamos (do 1º build) + guarda o cru. */
export function resumoBuild(c: GarmothChar): BuildResumo | null {
  const gid = typeof c?.url === "string" ? c.url : null;
  if (!gid) return null;
  const s = c.builds?.[0]?.score ?? {};
  return {
    garmoth_id: gid, char_name: c.name ?? null, char_class: inteiro(c.class), spec: c.spec ?? null, level: inteiro(c.level),
    ap: inteiro(s.ap), aap: inteiro(s.aap), dp: inteiro(s.dp), acc: inteiro(s.acc), dados: c,
  };
}

/** Chama a API (em lotes) e devolve os personagens crus. */
export async function fetchBuilds(ids: string[]): Promise<GarmothChar[]> {
  const key = process.env.GARMOTH_API_KEY;
  if (!key) throw new Error("GARMOTH_API_KEY não configurada");
  const unicos = [...new Set(ids.filter(Boolean))];
  const out: GarmothChar[] = [];
  const LOTE = 40;
  for (let i = 0; i < unicos.length; i += LOTE) {
    const chunk = unicos.slice(i, i + LOTE);
    const res = await fetch(`${BASE}?ids=${encodeURIComponent(chunk.join(","))}`, { headers: { apiKey: key } });
    if (!res.ok) throw new Error(`Garmoth ${res.status}: ${(await res.text().catch(() => "")).slice(0, 150) || res.statusText}`);
    const data = await res.json().catch(() => null);
    if (Array.isArray(data)) out.push(...(data as GarmothChar[]));
  }
  return out;
}

/** Lê os garmoth_id dos players, busca na API e faz upsert em garmoth_build. Limpa cache de quem não tem mais id. */
export async function atualizarTodos(): Promise<{ pedidos: number; atualizados: number; erros: string[] }> {
  // remove cache de players que não têm mais garmoth_id (staff limpou)
  await sql`DELETE FROM garmoth_build gb WHERE NOT EXISTS (
    SELECT 1 FROM players p WHERE p.nome_familia = gb.nome_familia AND p.garmoth_id IS NOT NULL AND p.garmoth_id <> '')`;

  const rows = (await sql`SELECT nome_familia, garmoth_id FROM players WHERE garmoth_id IS NOT NULL AND garmoth_id <> ''`) as { nome_familia: string; garmoth_id: string }[];
  if (!rows.length) return { pedidos: 0, atualizados: 0, erros: [] };

  const porId = new Map<string, string[]>(); // garmoth_id -> [nome_familia...]
  for (const r of rows) { const a = porId.get(r.garmoth_id) ?? []; a.push(r.nome_familia); porId.set(r.garmoth_id, a); }

  const chars = await fetchBuilds([...porId.keys()]);
  const porUrl = new Map<string, GarmothChar>();
  for (const c of chars) if (typeof c.url === "string") porUrl.set(c.url, c);

  const upserts = [];
  const erros: string[] = [];
  let atualizados = 0;
  for (const [id, nomes] of porId) {
    const c = porUrl.get(id);
    const r = c ? resumoBuild(c) : null;
    if (!r) { erros.push(`sem retorno p/ ${id}`); continue; }
    for (const nome of nomes) {
      upserts.push(sql`INSERT INTO garmoth_build (nome_familia, garmoth_id, char_name, char_class, spec, level, ap, aap, dp, acc, dados, atualizado)
        VALUES (${nome}, ${r.garmoth_id}, ${r.char_name}, ${r.char_class}, ${r.spec}, ${r.level}, ${r.ap}, ${r.aap}, ${r.dp}, ${r.acc}, ${JSON.stringify(r.dados)}::jsonb, now())
        ON CONFLICT (nome_familia) DO UPDATE SET garmoth_id=EXCLUDED.garmoth_id, char_name=EXCLUDED.char_name, char_class=EXCLUDED.char_class,
          spec=EXCLUDED.spec, level=EXCLUDED.level, ap=EXCLUDED.ap, aap=EXCLUDED.aap, dp=EXCLUDED.dp, acc=EXCLUDED.acc, dados=EXCLUDED.dados, atualizado=now()`);
      atualizados++;
    }
  }
  // grava em lotes (cada `dados` é um JSONB grande; um transaction único de ~100 poderia estourar o body do neon-http)
  for (let i = 0; i < upserts.length; i += 30) await sql.transaction(upserts.slice(i, i + 30));
  return { pedidos: porId.size, atualizados, erros };
}
