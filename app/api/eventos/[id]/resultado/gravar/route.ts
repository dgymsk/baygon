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

  let body: { linhas?: { nome_familia?: unknown; valores?: Record<string, unknown>; novo?: unknown }[]; data?: unknown; territorio?: unknown; tier?: unknown; aliancas?: unknown; soAliancas?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  // alianças em campo: rótulo digitado pela staff. Sem duplicata (case-insensitive), sem vazio,
  // teto de 20 — é contexto da war, não lista de convidados.
  //
  // `temAliancas` separa "não mandou o campo" de "mandou vazio". Sem essa distinção, gravar os
  // stats APAGAVA a lista de oponentes: a tela semeia o array no mount e um segundo escritor (a
  // outra rota, outra aba, outro staff) deixava o cliente com a lista velha, que ia por cima.
  const temAliancas = Array.isArray(body.aliancas);
  const aliancas: string[] = [];
  for (const raw of Array.isArray(body.aliancas) ? body.aliancas : []) {
    const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    if (s && !aliancas.some((x) => x.toLowerCase() === s.toLowerCase())) aliancas.push(s);
    if (aliancas.length >= 20) break;
  }

  /**
   * Modo "só alianças": grava o oponente SEM mexer na estatística.
   *
   * Existe porque as duas coisas estavam amarradas — a lista de oponentes só ia junto com a tabela
   * de stats, e quem quisesse registrar quem estava em campo antes de ter o print batia em "sem
   * linhas" e perdia o que digitou. Aqui NÃO se toca em `desempenho`: a gravação normal é
   * replace-all, e passar por ela com a tabela vazia apagaria a war inteira.
   */
  if (body.soAliancas === true) {
    const er = (await sql`SELECT war_id::int AS war_id FROM evento_resultado WHERE evento_id = ${eid}`) as { war_id: number | null }[];
    const wid = er[0]?.war_id ?? null;
    if (!wid) return NextResponse.json({ error: "este evento ainda não tem war — grave a estatística uma vez e as alianças passam a poder ser editadas sozinhas" }, { status: 400 });
    await sql`UPDATE wars SET aliancas = ${aliancas}::text[] WHERE war_id = ${wid}`;
    return NextResponse.json({ ok: true, warId: wid, aliancas });
  }

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
      // zero é DADO, não ausência: quem tem linha esteve na war. Descartá-lo fazia o jogador de
      // 0 kills sumir do ranking em vez de ficar em último, inflava a média de quem pontuou, e
      // apagava o melhor resultado possível das métricas menor_melhor (0 morte, 0 tempo morto).
      // Ausência de verdade é a chave não vir na linha.
      if (!Number.isFinite(valor)) continue;
      tuplas.set(`${canonical}|${metrica}`, { nome: canonical, metrica, valor });
    }
  }
  if (tuplas.size === 0) return NextResponse.json({ error: "nenhum dado válido (nenhum nome reconhecido)", ignorados: [...ignorados] }, { status: 400 });

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
      // a coluna de alianças só é tocada quando o corpo trouxe o campo — ver `temAliancas`
      sql`UPDATE wars SET data = ${dataWar}::date, resultado = ${resultadoWar}, territorio = ${territorio}, tier = ${tier},
              aliancas = CASE WHEN ${temAliancas} THEN ${aliancas}::text[] ELSE aliancas END
          WHERE war_id = ${warId}`,
      sql`INSERT INTO desempenho (war_id, nome_familia, metrica, valor)
          SELECT ${warId}, u.nome, u.metrica, u.valor
          FROM UNNEST(${nomes}::text[], ${metricas}::text[], ${valores}::float8[]) AS u(nome, metrica, valor)
          ON CONFLICT (war_id, nome_familia, metrica) DO UPDATE SET valor = EXCLUDED.valor`,
      sql`DELETE FROM desempenho d WHERE d.war_id = ${warId}
          AND NOT EXISTS (SELECT 1 FROM UNNEST(${nomes}::text[], ${metricas}::text[]) AS u(nome, metrica)
                          WHERE u.nome = d.nome_familia AND u.metrica = d.metrica)`,
      sql`INSERT INTO evento_resultado (evento_id, war_id) VALUES (${eid}, ${warId})
          ON CONFLICT (evento_id) DO UPDATE SET war_id = EXCLUDED.war_id, gravado = now()`,
      // CARIMBO: congela quem a pessoa ERA nesta war — classe, tipo, grupo, is_core e o gear do
      // momento. Sem isto toda tela lê `players` ao vivo, e um reroll reescreve o passado: quem sai
      // de Backline pra Frontline muda a régua daquela war pra TODO MUNDO dos dois grupos.
      // DO NOTHING de propósito neste ramo (regravação): o primeiro carimbo vence — regravar o print
      // três semanas depois não pode reetiquetar a war com a classe de hoje.
      sql`INSERT INTO war_player (war_id, nome_familia, grupo, is_core, classe_bdo, classe_tipo, guilda,
                                  garmoth_id, char_name, char_class, spec, ap, aap, dp, gear_lido)
          SELECT DISTINCT ${warId}::bigint, p.nome_familia, p.grupo, p.is_core, p.classe_bdo, p.classe_tipo, p.guilda,
                 gb.garmoth_id, gb.char_name, gb.char_class, gb.spec, gb.ap, gb.aap, gb.dp, gb.atualizado
          FROM UNNEST(${nomes}::text[]) AS u(nome)
          JOIN players p ON p.nome_familia = u.nome
          LEFT JOIN garmoth_build gb ON gb.nome_familia = p.nome_familia
          ON CONFLICT (war_id, nome_familia) DO NOTHING`,
      // quem saiu da war na regravação não pode deixar carimbo órfão
      sql`DELETE FROM war_player wp WHERE wp.war_id = ${warId}
          AND NOT EXISTS (SELECT 1 FROM UNNEST(${nomes}::text[]) AS u(nome) WHERE u.nome = wp.nome_familia)`,
    ]);
  } else {
    // nova war: CTE única e atômica (cria war + insere desempenho + liga evento_resultado juntos → retry não vaza war órfã)
    const rows = (await sql`
      WITH w AS (
        INSERT INTO wars (data, territorio, resultado, tier, aliancas)
        VALUES (${dataWar}::date, ${territorio}, ${resultadoWar}, ${tier}, ${aliancas}::text[]) RETURNING war_id
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
    // carimbo fora da CTE: lá dentro o war_id ainda não está visível pra um segundo INSERT que
    // precisa fazer JOIN com players. War recém-criada não tem carimbo pra conflitar.
    await sql`INSERT INTO war_player (war_id, nome_familia, grupo, is_core, classe_bdo, classe_tipo, guilda,
                                      garmoth_id, char_name, char_class, spec, ap, aap, dp, gear_lido)
      SELECT DISTINCT ${warId}::bigint, p.nome_familia, p.grupo, p.is_core, p.classe_bdo, p.classe_tipo, p.guilda,
             gb.garmoth_id, gb.char_name, gb.char_class, gb.spec, gb.ap, gb.aap, gb.dp, gb.atualizado
      FROM UNNEST(${nomes}::text[]) AS u(nome)
      JOIN players p ON p.nome_familia = u.nome
      LEFT JOIN garmoth_build gb ON gb.nome_familia = p.nome_familia
      ON CONFLICT (war_id, nome_familia) DO NOTHING`;
  }

  const nPlayers = new Set(nomes).size;
  return NextResponse.json({ ok: true, warId, gravadas: arr.length, players: nPlayers, cadastrados, ignorados: [...ignorados] });
}
