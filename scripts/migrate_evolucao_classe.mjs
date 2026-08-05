// Evolução de gear/classe: classe no histórico + carimbo do jogador na war.
//
// DOIS PROBLEMAS, um visível e um que move número.
//
// 1) garmoth_gear_hist só grava quando ap/aap/dp mudam. No BDO o gear é da FAMÍLIA: quem rerolla
//    leva o mesmo equipamento, e trocar Sucessão↔Despertar não mexe em ap/aap/dp. Resultado: hoje o
//    reroll não gera uma linha sequer — players.classe_bdo e garmoth_build.char_class são
//    sobrescritos e a transição some. Sem classe aqui, não existe "evolução de classe".
//    Guardamos o CRU (char_class INT + spec) e não o nome resolvido: assim, se o mapa de classes do
//    código estiver errado, corrigir o mapa conserta o histórico inteiro em vez de congelar o erro.
//
// 2) `desempenho` é (war_id, nome_familia, metrica, valor) — sem classe e SEM GRUPO. Todas as telas
//    leem `players` AO VIVO (lib/score.ts, lib/evolucao.ts, lib/stats.ts). Então quem reroda de
//    Ranger pra Striker não fica só com o rótulo errado numa war de junho: muda de Backline pra
//    Frontline e RECALCULA A RÉGUA daquela war pra todo mundo dos dois grupos. Classe é o sintoma
//    visível; grupo/is_core é o que mexe no número. `war_player` congela isso na hora da gravação.
//    Tabela própria e não coluna em `desempenho`: lá o formato é longo (~15 linhas por pessoa por
//    war) e a classe seria repetida 15x, com risco de divergir.
//
// Feito agora porque `wars` e `desempenho` estão VAZIOS — é a janela em que isto custa uma migração
// e um INSERT. Daqui a três meses custa "das primeiras 25 wars a gente não sabe mais quem era o quê".
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_evolucao_classe.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const temCol = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;
const addCol = async (t, c, tipo) => {
  if (await temCol(t, c)) return;
  await client.query(`ALTER TABLE ${t} ADD COLUMN ${c} ${tipo}`);
  console.log(`${t}.${c} criado`);
};

try {
  await client.connect();

  // --- 1) classe no histórico de gear ---
  await addCol("garmoth_gear_hist", "char_class", "INT");        // cru do Garmoth
  await addCol("garmoth_gear_hist", "spec", "TEXT");             // succ | awak
  await addCol("garmoth_gear_hist", "char_name", "TEXT");        // o personagem: muda no reroll
  await addCol("garmoth_gear_hist", "motivo", "TEXT");           // 'gear' | 'classe' | 'registro'
  await addCol("garmoth_gear_hist", "garmoth_updated", "TIMESTAMPTZ"); // hora do evento no Garmoth

  // backfill: ninguém rerolou desde que a tabela existe (nenhum garmoth_id do hist difere do atual),
  // então a classe de hoje É a daqueles pontos — MENOS quando o id é compartilhado por 2 players,
  // onde não dá pra saber de quem era
  const { rowCount: bf } = await client.query(`
    UPDATE garmoth_gear_hist h
       SET char_class = gb.char_class, spec = gb.spec, char_name = gb.char_name,
           motivo = COALESCE(h.motivo, 'gear')
      FROM garmoth_build gb
     WHERE gb.nome_familia = h.nome_familia AND gb.garmoth_id IS NOT DISTINCT FROM h.garmoth_id
       AND h.char_class IS NULL
       AND (SELECT count(*) FROM players p WHERE p.garmoth_id = h.garmoth_id) = 1`);
  if (bf) console.log(`${bf} ponto(s) do histórico receberam a classe`);

  // --- 2) carimbo do jogador na war ---
  await client.query(`CREATE TABLE IF NOT EXISTS war_player (
    war_id       BIGINT  NOT NULL REFERENCES wars(war_id) ON DELETE CASCADE,
    nome_familia TEXT    NOT NULL REFERENCES players(nome_familia) ON DELETE CASCADE,
    grupo        TEXT    NOT NULL,        -- define a régua do score; é o campo que MOVE número
    is_core      BOOLEAN NOT NULL DEFAULT FALSE,
    classe_bdo   TEXT,
    classe_tipo  TEXT,
    guilda       TEXT,
    garmoth_id   TEXT,                    -- qual personagem era; muda no reroll
    char_name    TEXT,
    char_class   INT,
    spec         TEXT,
    ap INT, aap INT, dp INT,
    gear_lido    TIMESTAMPTZ,             -- o gear é DESTE instante, não da hora da war
    carimbado    TIMESTAMPTZ NOT NULL DEFAULT now(),  -- hora da gravação: mede o atraso do print
    PRIMARY KEY (war_id, nome_familia)
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_war_player_nome ON war_player (nome_familia, war_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_war_player_classe ON war_player (classe_bdo, war_id)`);

  // --- 3) garmoth_id único: DETECTA, não força ---
  const { rows: dup } = await client.query(`
    SELECT garmoth_id, string_agg(nome_familia, ', ' ORDER BY nome_familia) AS quem
    FROM players WHERE garmoth_id IS NOT NULL AND garmoth_id <> '' GROUP BY 1 HAVING count(*) > 1`);
  if (dup.length) {
    console.warn("⚠ garmoth_id compartilhado — o índice único NÃO foi criado. A classe destes fica");
    console.warn("  congelada (o refresh não atualiza classe de id compartilhado). Conserte em /membros:");
    for (const d of dup) console.warn(`    ${d.garmoth_id} → ${d.quem}`);
  } else {
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_players_garmoth_id
      ON players (garmoth_id) WHERE garmoth_id IS NOT NULL AND garmoth_id <> ''`);
    console.log("índice único de garmoth_id criado");
  }

  const { rows: [r] } = await client.query(`SELECT
    (SELECT count(*)::int FROM garmoth_gear_hist) pontos,
    (SELECT count(*)::int FROM garmoth_gear_hist WHERE char_class IS NOT NULL) com_classe,
    (SELECT count(*)::int FROM war_player) carimbos,
    (SELECT count(*)::int FROM wars) wars,
    (SELECT count(*)::int FROM players WHERE classe_tipo IS NULL AND classe_bdo IS NOT NULL) sem_tipo`);
  console.log("OK —", JSON.stringify(r));
} catch (e) { console.error("ERRO:", e.message); process.exitCode = 1; }
finally { await client.end(); }
