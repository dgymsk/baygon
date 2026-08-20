/**
 * Integração com a API do Garmoth (gear/build de cada personagem BDO).
 * Doc: GET https://api.garmoth.com/api/external/gear-planner/getCharacterBuilds?ids=a,b,c
 *      header apiKey: <GARMOTH_API_KEY>. Resposta = array de personagens.
 * O worker (sempre-ligado) dispara atualizarTodos() a cada 2h via POST /api/garmoth/refresh.
 */
import { sql } from "@/lib/db";
import { parseGarmothId } from "@/lib/garmothId";
import { classeGarmoth, tipoGarmoth } from "@/lib/garmothClasses";

export { parseGarmothId };

export type GarmothScore = { ap?: number; aap?: number; dp?: number; acc?: number; [k: string]: number | undefined };
export type GarmothChar = { name?: string; class?: number; url?: string; level?: number; spec?: string; updated_at?: string; builds?: { score?: GarmothScore }[] };
export type BuildResumo = { garmoth_id: string; char_name: string | null; char_class: number | null; spec: string | null; level: number | null; ap: number | null; aap: number | null; dp: number | null; acc: number | null; atualizado_em: string | null; dados: GarmothChar };

const BASE = "https://api.garmoth.com/api/external/gear-planner/getCharacterBuilds";
const inteiro = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x) : null);

/** Extrai os campos que exibimos/ordenamos (do 1º build) + guarda o cru. */
export function resumoBuild(c: GarmothChar): BuildResumo | null {
  const gid = typeof c?.url === "string" ? c.url : null;
  if (!gid) return null;
  const s = c.builds?.[0]?.score ?? {};
  return {
    garmoth_id: gid, char_name: c.name ?? null, char_class: inteiro(c.class), spec: c.spec ?? null, level: inteiro(c.level),
    ap: inteiro(s.ap), aap: inteiro(s.aap), dp: inteiro(s.dp), acc: inteiro(s.acc),
    // quando o PRÓPRIO Garmoth diz que o personagem mudou. É o carimbo honesto do evento; o nosso
    // `capturado` é só quando o worker passou por ali, e erra em até 2h.
    atualizado_em: typeof c.updated_at === "string" ? c.updated_at : null,
    dados: c,
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
export async function atualizarTodos(): Promise<{ pedidos: number; atualizados: number; gravados: number; semRetorno: string[]; falhasGravacao: string[]; erros: string[] }> {
  // remove cache GARMOTH de players que não têm mais garmoth_id (staff limpou). Gear MANUAL (fonte='manual', do registro) fica.
  await sql`DELETE FROM garmoth_build gb WHERE gb.fonte = 'garmoth' AND NOT EXISTS (
    SELECT 1 FROM players p WHERE p.nome_familia = gb.nome_familia AND p.garmoth_id IS NOT NULL AND p.garmoth_id <> '')`;

  const rows = (await sql`SELECT nome_familia, garmoth_id FROM players WHERE garmoth_id IS NOT NULL AND garmoth_id <> ''`) as { nome_familia: string; garmoth_id: string }[];
  if (!rows.length) return { pedidos: 0, atualizados: 0, gravados: 0, semRetorno: [], falhasGravacao: [], erros: [] };

  const porId = new Map<string, string[]>(); // garmoth_id -> [nome_familia...]
  for (const r of rows) { const a = porId.get(r.garmoth_id) ?? []; a.push(r.nome_familia); porId.set(r.garmoth_id, a); }

  // valores ANTERIORES (p/ registrar no histórico só quando ap/aap/dp mudam)
  const antigos = new Map<string, { ap: number | null; aap: number | null; dp: number | null; char_class: number | null; spec: string | null }>();
  for (const a of (await sql`SELECT nome_familia, ap, aap, dp, char_class, spec FROM garmoth_build`) as { nome_familia: string; ap: number | null; aap: number | null; dp: number | null; char_class: number | null; spec: string | null }[]) antigos.set(a.nome_familia, a);

  const chars = await fetchBuilds([...porId.keys()]);
  const porUrl = new Map<string, GarmothChar>();
  for (const c of chars) if (typeof c.url === "string") porUrl.set(c.url, c);

  const upserts = [];
  /**
   * DUAS listas, e não uma. Antes as duas falhas caíam no mesmo `erros` e a tela chamava as duas de
   * "sem retorno" — o que escondia justamente a pior:
   *   semRetorno     — o Garmoth não devolveu aquele personagem (id errado, build privada). Nada a
   *                    fazer do nosso lado, e o resto da rodada é válido.
   *   falhasGravacao — o banco recusou o lote. É ERRO NOSSO e significa que aqueles jogadores NÃO
   *                    foram atualizados, mesmo que a API tenha respondido tudo.
   */
  const semRetorno: string[] = [];
  const falhasGravacao: string[] = [];
  let atualizados = 0;
  for (const [id, nomes] of porId) {
    const c = porUrl.get(id);
    const r = c ? resumoBuild(c) : null;
    if (!r) { semRetorno.push(`${id} (${nomes.join(", ")})`); continue; }
    const classe = classeGarmoth(r.char_class);          // Garmoth é a fonte da classe/spec
    const tipo = classe ? tipoGarmoth(classe, r.spec) : null;
    const idUnico = nomes.length === 1;                  // id compartilhado por >1 player não define a classe de ninguém
    const completo = r.ap != null && r.aap != null && r.dp != null;
    for (const nome of nomes) {
      upserts.push(sql`INSERT INTO garmoth_build (nome_familia, garmoth_id, char_name, char_class, spec, level, ap, aap, dp, acc, dados, atualizado)
        VALUES (${nome}, ${r.garmoth_id}, ${r.char_name}, ${r.char_class}, ${r.spec}, ${r.level}, ${r.ap}, ${r.aap}, ${r.dp}, ${r.acc}, ${JSON.stringify(r.dados)}::jsonb, now())
        ON CONFLICT (nome_familia) DO UPDATE SET garmoth_id=EXCLUDED.garmoth_id, fonte='garmoth', char_name=EXCLUDED.char_name, char_class=EXCLUDED.char_class,
          spec=EXCLUDED.spec, level=EXCLUDED.level, ap=EXCLUDED.ap, aap=EXCLUDED.aap, dp=EXCLUDED.dp, acc=EXCLUDED.acc, dados=EXCLUDED.dados, atualizado=now()`);
      // classe/tipo do player a partir do Garmoth (fonte da verdade p/ quem tem id único; tipo desconhecido preserva o manual)
      if (classe && idUnico) upserts.push(sql`UPDATE players SET classe_bdo = ${classe}, classe_tipo = COALESCE(${tipo}, classe_tipo) WHERE nome_familia = ${nome}`);
      /**
       * Histórico. Duas razões pra gravar um ponto, e elas são independentes:
       *  - GEAR: o trio ap/aap/dp mudou (e veio completo — resposta parcial não vira degrau falso);
       *  - CLASSE: char_class ou spec mudaram, ou seja, reroll ou troca de Sucessão↔Despertar.
       *
       * A segunda existe porque no BDO o gear é da FAMÍLIA: quem rerolla leva o mesmo equipamento e
       * o trio sai idêntico. Com o gate só no gear, o reroll não gerava linha nenhuma e a transição
       * desaparecia — que é exatamente o que a evolução de classe precisa enxergar.
       *
       * Sem `old` (primeira vez que vemos essa pessoa) grava só se o gear veio completo: um ponto
       * inicial sem números não serve pra curva nenhuma.
       */
      const old = antigos.get(nome);
      const mudouGear = !!old && (old.ap !== r.ap || old.aap !== r.aap || old.dp !== r.dp);
      const mudouClasse = !!old && (old.char_class !== r.char_class || (old.spec ?? null) !== (r.spec ?? null));
      const primeiraVez = !old;
      // id compartilhado por 2+ players não diz a classe de ninguém — o mesmo guard do UPDATE acima.
      // Sem ele, o personagem de um viraria o "histórico de classe" do outro.
      const registraClasse = mudouClasse && idUnico;
      if ((completo && (mudouGear || primeiraVez)) || registraClasse) {
        upserts.push(sql`INSERT INTO garmoth_gear_hist (nome_familia, garmoth_id, ap, aap, dp, char_class, spec, char_name, motivo, garmoth_updated)
          VALUES (${nome}, ${r.garmoth_id}, ${r.ap}, ${r.aap}, ${r.dp}, ${idUnico ? r.char_class : null}, ${idUnico ? r.spec : null}, ${idUnico ? r.char_name : null},
                  ${registraClasse ? "classe" : "gear"}, ${r.atualizado_em ?? null})`);
      }
      atualizados++;
    }
  }
  /**
   * Grava em lotes (cada `dados` é um JSONB grande — o roster inteiro passa de 900 KB, e um
   * transaction único estouraria o corpo do neon-http). try/catch por lote pra um FK-violation
   * (player apagado no meio do refresh) não abortar os outros.
   *
   * GRAVADOS conta o que o banco ACEITOU, statement a statement. Antes o retorno só tinha
   * `atualizados`, que é incrementado lá em cima, ANTES de qualquer escrita — então uma rodada em
   * que todos os lotes falhassem ainda reportava "165 atualizadas", e a tela pintava de verde.
   * Contar depois é o que faz o número dizer a verdade.
   */
  let gravados = 0;
  for (let i = 0; i < upserts.length; i += 30) {
    const lote = upserts.slice(i, i + 30);
    try { await sql.transaction(lote); gravados += lote.length; }
    catch (e) { falhasGravacao.push(`lote ${Math.floor(i / 30)}: ${(e as Error).message.slice(0, 120)}`); }
  }
  // `erros` continua saindo, unindo as duas, pra não quebrar quem já lia esse campo (o worker loga ele)
  return { pedidos: porId.size, atualizados, gravados, semRetorno, falhasGravacao, erros: [...semRetorno.map((s) => `sem retorno p/ ${s}`), ...falhasGravacao] };
}
