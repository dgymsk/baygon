import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { sql } from "@/lib/db";
import { METRICAS_RESULTADO } from "@/lib/metricasResultado";

const METRICAS_OK = new Set(METRICAS_RESULTADO.map((m) => m.metrica));

// POST /api/eventos/[id]/resultado/gravar
//   { linhas:[{nome_familia, valores:{metrica:number}}], data?, territorio?, tier? }
//   -> cria/reusa a `wars`, grava `desempenho` (upsert) e liga evento_resultado.war_id. Staff.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const eid = Math.trunc(Number((await params).id));
  if (!Number.isFinite(eid) || eid <= 0) return NextResponse.json({ error: "evento inválido" }, { status: 400 });

  let body: { linhas?: { nome_familia?: unknown; valores?: Record<string, unknown> }[]; data?: unknown; territorio?: unknown; tier?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  if (!Array.isArray(body.linhas) || body.linhas.length === 0) return NextResponse.json({ error: "sem linhas" }, { status: 400 });

  const ev = (await sql`SELECT data::text AS data FROM evento WHERE id = ${eid}`) as { data: string }[];
  if (!ev[0]) return NextResponse.json({ error: "evento não encontrado" }, { status: 404 });
  const erRow = (await sql`SELECT resultado, war_id::int AS war_id FROM evento_resultado WHERE evento_id = ${eid}`) as { resultado: string | null; war_id: number | null }[];
  const resultadoWar = erRow[0]?.resultado ? erRow[0].resultado.toLowerCase() : null; // canônico minúsculo (= evento_resultado/RESULTADOS)

  const players = (await sql`SELECT nome_familia FROM players`) as { nome_familia: string }[];
  const validos = new Set(players.map((p) => p.nome_familia));

  // monta as tuplas (dedupe por nome|metrica) + coleta nomes ignorados (não são players → FK barraria)
  const tuplas = new Map<string, { nome: string; metrica: string; valor: number }>();
  const ignorados = new Set<string>();
  for (const l of body.linhas) {
    const nome = typeof l?.nome_familia === "string" ? l.nome_familia.trim() : "";
    if (!nome) continue;
    if (!validos.has(nome)) { ignorados.add(nome); continue; }
    for (const [metrica, v] of Object.entries(l.valores ?? {})) {
      if (!METRICAS_OK.has(metrica)) continue;
      const valor = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(valor) || valor === 0) continue; // 0 = ausência (a visão omite; mantemos coerente p/ os benchmarks não mentirem)
      tuplas.set(`${nome}|${metrica}`, { nome, metrica, valor });
    }
  }
  if (tuplas.size === 0) return NextResponse.json({ error: "nenhum dado válido (nomes não batem com players cadastrados, ou valores vazios)", ignorados: [...ignorados] }, { status: 400 });

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
  return NextResponse.json({ ok: true, warId, gravadas: arr.length, players: nPlayers, ignorados: [...ignorados] });
}
