import { sql } from "@/lib/db";
import { chaveNome, acharSimilar } from "@/lib/nomes";

/**
 * RENOMEAR o nome de família de um jogador.
 *
 * É a operação mais invasiva do app: `players.nome_familia` é a PK, 5 tabelas apontam pra ela por
 * FK e outras 12 guardam o nome DENORMALIZADO, sem FK — dessas, 11 guardam também a `chave`
 * (chaveNome do nome), que em 8 delas faz parte de um índice único.
 *
 * As 5 FKs andam sozinhas desde scripts/migrate_rename_cascade.mjs (ON UPDATE CASCADE): desempenho,
 * discrepancia, garmoth_build, garmoth_gear_hist e war_player, inclusive as PKs compostas deles.
 * O que esta função faz à mão é o resto — o que não tem FK e por isso ninguém propaga.
 *
 * RENOME NÃO É FUSÃO. Se o nome de destino já existe, ou se a chave dele já pertence a outra
 * pessoa, a operação é RECUSADA. Escolher qual das duas linhas sobrevive, e o que fazer com o
 * histórico de cada uma, é decisão humana — e um UPDATE que "resolve" isso sozinho junta duas
 * pessoas em silêncio.
 */
export type ColisaoRenome = { tabela: string; n: number };
export type ResultadoRenome =
  | { ok: true; de: string; para: string; cosmetico: boolean; movidas: Record<string, number> }
  | { ok: false; erro: string; codigo: "nome_invalido" | "nao_existe" | "nada_a_renomear" | "fusao" | "chave_duplicada" | "colisao"; colisoes?: ColisaoRenome[]; parecido?: string };

const CTRL = new RegExp("[\\u0000-\\u001f\\u007f]", "g");
/** Mesmo saneamento do cadastro de jogador novo em gravar/route.ts — nome é PK, entra limpo ou não entra. */
const limpar = (s: string) => (s ?? "").replace(CTRL, "").replace(/\s+/g, " ").trim().slice(0, 60);

export async function renomearPlayer(deBruto: unknown, paraBruto: unknown): Promise<ResultadoRenome> {
  const de = typeof deBruto === "string" ? deBruto.trim() : "";
  const para = limpar(typeof paraBruto === "string" ? paraBruto : "");
  if (!de) return { ok: false, codigo: "nao_existe", erro: "jogador não informado" };
  if (!para) return { ok: false, codigo: "nome_invalido", erro: "o nome novo não pode ser vazio" };
  if (de === para) return { ok: false, codigo: "nada_a_renomear", erro: "o nome novo é igual ao atual" };

  const kDe = chaveNome(de), kPara = chaveNome(para);

  /**
   * CENSO — tudo que impede o renome, num round-trip.
   *
   * As colisões de chave são medidas por INTERSECT dentro da partição de cada índice único: o que
   * quebra não é "a chave nova existe em algum lugar", é "ela existe no MESMO evento / MESMO tipo /
   * MESMA função / MESMO lote". Nas três tabelas de scan a chave é a PK inteira, então basta existir.
   *
   * intencao_marca, intencao_resp e participacao_resp ficam de fora: nelas a chave está fora de
   * qualquer índice único (a identidade lá é o user_id do Discord), e o UPDATE nunca colide.
   */
  const [censo] = (await sql`
    SELECT
      (SELECT count(*) FROM players WHERE nome_familia = ${para})::int AS alvo_existe,
      (SELECT count(*) FROM (SELECT evento_id FROM evento_escalacao WHERE chave = ${kDe}
         INTERSECT SELECT evento_id FROM evento_escalacao WHERE chave = ${kPara}) x)::int AS evento_escalacao,
      (SELECT count(*) FROM (SELECT evento_id FROM evento_presenca WHERE chave = ${kDe}
         INTERSECT SELECT evento_id FROM evento_presenca WHERE chave = ${kPara}) x)::int AS evento_presenca,
      (SELECT count(*) FROM (SELECT tipo FROM participacao_membro WHERE chave = ${kDe}
         INTERSECT SELECT tipo FROM participacao_membro WHERE chave = ${kPara}) x)::int AS participacao_membro,
      (SELECT count(*) FROM (SELECT funcao_id FROM player_funcao WHERE chave = ${kDe}
         INTERSECT SELECT funcao_id FROM player_funcao WHERE chave = ${kPara}) x)::int AS player_funcao,
      (SELECT count(*) FROM (SELECT lote_id FROM dm_lote_alvo WHERE chave = ${kDe}
         INTERSECT SELECT lote_id FROM dm_lote_alvo WHERE chave = ${kPara}) x)::int AS dm_lote_alvo,
      (SELECT count(*) FROM pt_scan         WHERE chave = ${kPara})::int AS pt_scan,
      (SELECT count(*) FROM participar_scan WHERE chave = ${kPara})::int AS participar_scan,
      (SELECT count(*) FROM remocao_scan    WHERE chave = ${kPara})::int AS remocao_scan,
      (SELECT count(*) FROM players WHERE nome_familia = ${de})::int AS origem_existe
  `) as { alvo_existe: number; origem_existe: number; [k: string]: number }[];

  if (!censo.origem_existe) return { ok: false, codigo: "nao_existe", erro: `"${de}" não está no cadastro` };
  if (censo.alvo_existe) {
    return { ok: false, codigo: "fusao", erro: `Já existe um jogador chamado "${para}". Renomear não funde dois cadastros — decida qual fica e apague o outro em Membros.` };
  }

  /**
   * Chave duplicada: outro jogador cujo nome dá a MESMA chave que a nova.
   *
   * Feito em JS com o chaveNome de verdade, e não com um LOWER() paralelo no SQL: a normalização
   * tira acento decomponível, e reescrever isso em SQL criaria uma segunda definição de identidade
   * que só divergiria no dia em que alguém com acento no nome fosse renomeado.
   */
  const nomes = ((await sql`SELECT nome_familia FROM players`) as { nome_familia: string }[]).map((r) => r.nome_familia);
  const dono = nomes.find((n) => n !== de && chaveNome(n) === kPara);
  if (dono) return { ok: false, codigo: "chave_duplicada", erro: `"${para}" tem a mesma chave de "${dono}" — o app trataria os dois como a mesma pessoa.` };

  const colisoes = (["evento_escalacao", "evento_presenca", "participacao_membro", "player_funcao", "dm_lote_alvo", "pt_scan", "participar_scan", "remocao_scan"] as const)
    .map((t) => ({ tabela: t, n: censo[t] ?? 0 })).filter((c) => c.n > 0);
  if (colisoes.length) {
    return { ok: false, codigo: "colisao", colisoes,
      erro: `O nome novo já tem registro nas mesmas linhas em: ${colisoes.map((c) => `${c.tabela} (${c.n})`).join(", ")}. Isso é fusão de histórico, não renome.` };
  }

  // parecido demais: não bloqueia, mas volta no resultado pra tela pedir um segundo clique
  const parecido = acharSimilar(kPara, nomes.filter((n) => n !== de).map((n) => ({ chave: chaveNome(n), nome: n })))?.nome ?? undefined;

  /**
   * A ESCRITA. Uma transação, sem ON CONFLICT em lugar nenhum de propósito: se uma colisão nascer
   * entre o censo e a escrita (outra aba, o bot, um print sendo gravado), o índice único estoura e
   * a transação inteira volta — em vez de fundir duas pessoas em silêncio.
   *
   * `RETURNING 1` em todo statement porque o driver HTTP do Neon não devolve rowCount: sem isso,
   * renomear alguém que não existe seria um 200 mudo.
   *
   * chave E familia sempre juntas, inclusive nas tabelas em que a chave não é única. O invariante
   * `chave = chaveNome(familia)` vale hoje em todas as linhas, e quebrá-lo de propósito produziria
   * registro cujas duas colunas de identidade discordam — e `familia` não é só rótulo: ela é
   * comparada por igualdade crua com players.nome_familia em vários lugares.
   */
  const r = await sql.transaction([
    sql`UPDATE players SET nome_familia = ${para} WHERE nome_familia = ${de} RETURNING 1 AS n`,
    sql`UPDATE dm_lote_alvo        SET chave = ${kPara}, familia = ${para} WHERE chave = ${kDe} RETURNING 1 AS n`,
    sql`UPDATE evento_escalacao    SET chave = ${kPara}, familia = ${para} WHERE chave = ${kDe} RETURNING 1 AS n`,
    sql`UPDATE evento_presenca     SET chave = ${kPara}, familia = ${para} WHERE chave = ${kDe} RETURNING 1 AS n`,
    sql`UPDATE intencao_marca      SET chave = ${kPara}, familia = ${para} WHERE chave = ${kDe} RETURNING 1 AS n`,
    sql`UPDATE intencao_resp       SET chave = ${kPara}, familia = ${para} WHERE chave = ${kDe} RETURNING 1 AS n`,
    sql`UPDATE participacao_membro SET chave = ${kPara}, familia = ${para} WHERE chave = ${kDe} RETURNING 1 AS n`,
    sql`UPDATE participacao_resp   SET chave = ${kPara}, familia = ${para} WHERE chave = ${kDe} RETURNING 1 AS n`,
    sql`UPDATE participar_scan     SET chave = ${kPara}, familia = ${para} WHERE chave = ${kDe} RETURNING 1 AS n`,
    sql`UPDATE player_funcao       SET chave = ${kPara}, familia = ${para} WHERE chave = ${kDe} RETURNING 1 AS n`,
    sql`UPDATE pt_scan             SET chave = ${kPara}, familia = ${para} WHERE chave = ${kDe} RETURNING 1 AS n`,
    sql`UPDATE remocao_scan        SET chave = ${kPara}, familia = ${para} WHERE chave = ${kDe} RETURNING 1 AS n`,
    // registro_jornada não tem chave: casa por texto exato. Deixar o nome velho aqui faz a jornada
    // de registro não reconhecer a pessoa e CRIAR um segundo cadastro com o nome antigo.
    sql`UPDATE registro_jornada    SET familia = ${para} WHERE familia = ${de} RETURNING 1 AS n`,
  ]);

  const TAB = ["players", "dm_lote_alvo", "evento_escalacao", "evento_presenca", "intencao_marca", "intencao_resp",
    "participacao_membro", "participacao_resp", "participar_scan", "player_funcao", "pt_scan", "remocao_scan", "registro_jornada"];
  const movidas: Record<string, number> = {};
  r.forEach((linhas, i) => { const n = (linhas as unknown[]).length; if (n) movidas[TAB[i]] = n; });

  return { ok: true, de, para, cosmetico: kDe === kPara, movidas, ...(parecido ? { parecido } : {}) } as ResultadoRenome;
}
