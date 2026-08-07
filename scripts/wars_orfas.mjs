// Wars ÓRFÃS: estatística de combate que não pertence a evento nenhum.
//
// Elas são o resíduo do comportamento antigo — apagar o evento levava `evento_resultado` junto
// (CASCADE) e deixava `wars`/`desempenho` para trás. O dano continuava contando nas médias, nos
// rankings e na evolução, sem nenhuma tela onde reatá-lo. A exclusão de evento já não cria mais
// órfã (ver lib/eventos.deletarEvento); isto é pra limpar o que ficou.
//
// LISTA por padrão. Só apaga com --apagar, e só as wars que você nomear:
//   node --env-file=.env.local scripts/wars_orfas.mjs
//   node --env-file=.env.local scripts/wars_orfas.mjs --apagar 41 43
//
// Não existe "apagar todas" de propósito: uma war órfã pode ser uma guerra de verdade cujo print
// foi subido antes de o evento existir, e nesse caso o certo é criar o evento e reatar, não apagar.
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const args = process.argv.slice(2);
const apagar = args.includes("--apagar");
const alvos = args.filter((a) => /^\d+$/.test(a)).map(Number);
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  const { rows: orfas } = await client.query(`
    SELECT w.war_id, w.data::text AS data,
           (SELECT count(*)::int FROM desempenho d  WHERE d.war_id = w.war_id) dano,
           (SELECT count(DISTINCT d.nome_familia)::int FROM desempenho d WHERE d.war_id = w.war_id) jogadores,
           (SELECT count(*)::int FROM benchmarks b   WHERE b.war_id = w.war_id) bench,
           (SELECT count(*)::int FROM discrepancia x WHERE x.war_id = w.war_id) disc,
           (SELECT count(*)::int FROM war_guilda g   WHERE g.war_id = w.war_id) guilda,
           (SELECT count(*)::int FROM war_player p   WHERE p.war_id = w.war_id) wplayer
    FROM wars w
    WHERE NOT EXISTS (SELECT 1 FROM evento_resultado r WHERE r.war_id = w.war_id)
    ORDER BY w.data, w.war_id`);

  if (!orfas.length) { console.log("nenhuma war órfã — todo dano gravado pertence a um evento."); process.exit(0); }

  console.log(`${orfas.length} war(s) órfã(s):`);
  for (const o of orfas) {
    console.log(`  war ${o.war_id} · ${o.data} · ${o.dano} linhas de dano de ${o.jogadores} jogador(es)` +
      ` · bench ${o.bench} · discrep ${o.disc} · guilda ${o.guilda} · snapshot ${o.wplayer}`);
  }

  if (!apagar) {
    console.log(`\nPra apagar, nomeie as wars: node --env-file=.env.local scripts/wars_orfas.mjs --apagar ${orfas.map((o) => o.war_id).join(" ")}`);
    console.log("Se a war for de verdade, o certo é criar o evento dela em /hub e reatar o resultado — não apagar.");
    process.exit(0);
  }

  const validos = alvos.filter((id) => orfas.some((o) => o.war_id === id));
  const ignorados = alvos.filter((id) => !validos.includes(id));
  if (ignorados.length) console.log(`\nignorando ${ignorados.join(", ")}: não são órfãs (ou não existem)`);
  if (!validos.length) { console.error("\nnenhuma war válida informada — nada foi apagado."); process.exit(1); }

  for (const id of validos) {
    // mesma ordem do lib/eventos: as tabelas derivadas referenciam wars sem regra de exclusão
    await client.query("BEGIN");
    try {
      for (const t of ["discrepancia", "benchmarks", "war_guilda", "desempenho", "war_player"]) {
        await client.query(`DELETE FROM ${t} WHERE war_id = $1`, [id]);
      }
      await client.query(`DELETE FROM wars WHERE war_id = $1`, [id]);
      await client.query("COMMIT");
      console.log(`war ${id} apagada`);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error(`war ${id} NÃO foi apagada: ${e.message}`);
      process.exitCode = 1;
    }
  }
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
