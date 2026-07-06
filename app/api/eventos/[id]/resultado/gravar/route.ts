import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { sql } from "@/lib/db";
import { METRICAS_RESULTADO } from "@/lib/metricasResultado";
import { chaveNome } from "@/lib/nomes";

const METRICAS_OK = new Set(METRICAS_RESULTADO.map((m) => m.metrica));
// nome de player novo: tira controles, colapsa espaço e limita tamanho (vira PK — input confiado do client).
const CTRL = new RegExp("[\\u0000-\\u001f\\u007f]", "g");
const limparNome = (s: string) => s.replace(CTRL, "").replace(/\s+/g, " ").trim().slice(0, 60);

// POST /api/eventos/[id]/resultado/gravar
//   { linhas:[{nome_familia, valores:{metrica:number}}], data?, territorio?, tier? }
//   -> cria/reusa a `wars`, grava `desempenho` (upsert) e liga evento_resultado.war_id. Staff.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const eid = Math.trunc(Number((await params).id));
  if (!Number.isFinite(eid) || eid <= 0) return NextResponse.json({ error: "evento inválido" }, { status: 400 });

  let body: { linhas?: { nome_familia?: unknown; valores?: Record<string, unknown>; novo?: unknown }[]; data?: unknown; territorio?: unknown; tier?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  if (!Array.isArray(body.linhas) || body.linhas.length === 0) return NextResponse.json({ error: "sem linhas" }, { status: 400 });

  const ev = (await sql`SELECT data::text AS data FROM evento WHERE id = ${eid}`) as { data: string }[];
  if (!ev[0]) return NextResponse.json({ error: "evento não encontrado" }, { status: 404 });
  const erRow = (await sql`SELECT resultado, war_id::int AS war_id FROM evento_resultado WHERE evento_id = ${eid}`) as { resultado: string | null; war_id: number | null }[];
  const resultadoWar = erRow[0]?.resultado ? erRow[0].resultado.toLowerCase() : null; // canônico minúsculo (= evento_resultado/RESULTADOS)

  const players = (await sql`SELECT nome_familia FROM players`) as { nome_familia: string }[];
  // identidade = chaveNome (igual ao resto do app): resolve todo nome ao player canônico por essa chave,
  // pra "Alaska"/"Aláska" não virarem 2 players. porChave: chaveNome -> nome_familia canônico.
  const porChave = new Map<string, string>();
  for (const p of players) porChave.set(chaveNome(p.nome_familia), p.nome_familia);

  // resolve cada linha a um nome_familia canônico; decide quem cadastrar (novo cujo chaveNome não existe)
  const tuplas = new Map<string, { nome: string; metrica: string; valor: number }>();
  const aCadastrar = new Map<string, string>(); // chaveNome -> nome_familia (limpo) a criar
  const ignorados = new Set<string>();
  for (const l of body.linhas) {
    const ehNovo = l?.novo === true;
    const bruto = typeof l?.nome_familia === "string" ? l.nome_familia : "";
    const nome0 = ehNovo ? limparNome(bruto) : bruto.trim();
    if (!nome0) continue;
    const k = chaveNome(nome0);
    if (!k) continue;
    let canonical = porChave.get(k);
    if (!canonical) {
      if (!ehNovo) { ignorados.add(nome0); continue; } // "casado" mas não existe (stale) → não cria à revelia
      canonical = aCadastrar.get(k) ?? nome0;
      aCadastrar.set(k, canonical);
      porChave.set(k, canonical); // próximas linhas da mesma pessoa resolvem ao mesmo nome
    }
    for (const [metrica, v] of Object.entries(l.valores ?? {})) {
      if (!METRICAS_OK.has(metrica)) continue;
      const valor = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(valor) || valor === 0) continue; // 0 = ausência (a visão omite; mantemos coerente p/ os benchmarks não mentirem)
      tuplas.set(`${canonical}|${metrica}`, { nome: canonical, metrica, valor });
    }
  }
  if (tuplas.size === 0) return NextResponse.json({ error: "nenhum dado válido (nomes vazios ou só zeros)", ignorados: [...ignorados] }, { status: 400 });

  // CADASTRA os players novos (após o guard, pra um early-return não deixar player órfão): guilda MANI
  // (Manicômio) + grupo 'Indefinido'. A staff completa grupo/classe/guilda depois em /membros.
  const cadastrados = [...aCadastrar.values()];
  if (cadastrados.length) {
    await sql`INSERT INTO players (nome_familia, grupo, guilda)
      SELECT u.nome, 'Indefinido', 'MANI' FROM UNNEST(${cadastrados}::text[]) AS u(nome)
      ON CONFLICT (nome_familia) DO NOTHING`;
  }

  const dataWar = typeof body.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.data) ? body.data : ev[0].data;
  const territorio = typeof body.territorio === "string" && body.territorio.trim() ? body.territorio.trim().slice(0, 120) : null;
  const tier = Number.isFinite(Number(body.tier)) && body.tier != null && body.tier !== "" ? Math.trunc(Number(body.tier)) : null;

  const arr = [...tuplas.values()];
  const nomes = arr.map((t) => t.nome), metricas = arr.map((t) => t.metrica), valores = arr.map((t) => t.valor);

  // war: reusa a já ligada (regrava) ou cria nova — SEMPRE atômico (senão uma falha no meio deixa
  // war órfã / desempenho zerado; ver revisão adversarial). Cada bloco = 1 transação com rollback.
  let warId = erRow[0]?.war_id ?? null;
  if (warId) {
    // reusa: replace-all seguro num único transaction (upsert → apaga só o que saiu; nunca esvazia a war se falhar)
    await sql.transaction([
      sql`UPDATE wars SET data = ${dataWar}::date, resultado = ${resultadoWar}, territorio = ${territorio}, tier = ${tier} WHERE war_id = ${warId}`,
      sql`INSERT INTO desempenho (war_id, nome_familia, metrica, valor)
          SELECT ${warId}, u.nome, u.metrica, u.valor
          FROM UNNEST(${nomes}::text[], ${metricas}::text[], ${valores}::float8[]) AS u(nome, metrica, valor)
          ON CONFLICT (war_id, nome_familia, metrica) DO UPDATE SET valor = EXCLUDED.valor`,
      sql`DELETE FROM desempenho d WHERE d.war_id = ${warId}
          AND NOT EXISTS (SELECT 1 FROM UNNEST(${nomes}::text[], ${metricas}::text[]) AS u(nome, metrica)
                          WHERE u.nome = d.nome_familia AND u.metrica = d.metrica)`,
      sql`INSERT INTO evento_resultado (evento_id, war_id) VALUES (${eid}, ${warId})
          ON CONFLICT (evento_id) DO UPDATE SET war_id = EXCLUDED.war_id, gravado = now()`,
    ]);
  } else {
    // nova war: CTE única e atômica (cria war + insere desempenho + liga evento_resultado juntos → retry não vaza war órfã)
    const rows = (await sql`
      WITH w AS (
        INSERT INTO wars (data, territorio, resultado, tier)
        VALUES (${dataWar}::date, ${territorio}, ${resultadoWar}, ${tier}) RETURNING war_id
      ), d AS (
        INSERT INTO desempenho (war_id, nome_familia, metrica, valor)
        SELECT w.war_id, u.nome, u.metrica, u.valor
        FROM w, UNNEST(${nomes}::text[], ${metricas}::text[], ${valores}::float8[]) AS u(nome, metrica, valor)
        ON CONFLICT (war_id, nome_familia, metrica) DO UPDATE SET valor = EXCLUDED.valor
      )
      INSERT INTO evento_resultado (evento_id, war_id)
      SELECT ${eid}, w.war_id FROM w
      ON CONFLICT (evento_id) DO UPDATE SET war_id = EXCLUDED.war_id, gravado = now()
      RETURNING war_id::int AS war_id`) as { war_id: number }[];
    warId = rows[0].war_id;
  }

  const nPlayers = new Set(nomes).size;
  return NextResponse.json({ ok: true, warId, gravadas: arr.length, players: nPlayers, cadastrados, ignorados: [...ignorados] });
}
