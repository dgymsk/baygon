// Funções POR PRESET — quais botões aparecem em cada chamada.
//
// Hoje `funcoesDoPreset` devolve o catálogo INTEIRO (lib/intencao.ts), então toda chamada mostra
// todas as funções, dê no que der: a chamada de siege oferece Shai, a de T1 oferece as funções que
// só existem no T3. O preset já decide as PTs e o teto de gente; faltava decidir os botões.
//
// Tabela nova e não reaproveitamento de intencao_preset_pt: aquela virou preset→PARTY na migração
// do modelo (as PTs da escalação). São eixos diferentes — função é o que a pessoa marca no bot,
// party é onde ela joga in-game.
//
// Backfill: todo preset existente recebe TODAS as funções de hoje, pra o comportamento não mudar
// sozinho no primeiro deploy. Preset sem nenhuma linha aqui continua caindo no catálogo inteiro —
// assim um preset novo funciona antes de alguém configurar.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_preset_funcao.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS intencao_preset_funcao (
    preset_id BIGINT NOT NULL REFERENCES intencao_preset(id) ON DELETE CASCADE,
    funcao_id BIGINT NOT NULL REFERENCES funcao(id) ON DELETE CASCADE,
    ordem     INT    NOT NULL DEFAULT 0,   -- ordem dos BOTÕES na mensagem
    PRIMARY KEY (preset_id, funcao_id)
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_preset_funcao ON intencao_preset_funcao (preset_id, ordem)`);

  const { rowCount: bf } = await client.query(`
    INSERT INTO intencao_preset_funcao (preset_id, funcao_id, ordem)
    SELECT p.id, f.id, f.ordem FROM intencao_preset p CROSS JOIN funcao f
    WHERE NOT EXISTS (SELECT 1 FROM intencao_preset_funcao x WHERE x.preset_id = p.id)
    ON CONFLICT DO NOTHING`);
  if (bf) console.log(`${bf} vínculo(s) criados no backfill (todo preset com todas as funções)`);

  const { rows } = await client.query(`
    SELECT p.nome AS preset, string_agg(f.nome, ', ' ORDER BY pf.ordem, f.id) AS funcoes
    FROM intencao_preset p
    LEFT JOIN intencao_preset_funcao pf ON pf.preset_id = p.id
    LEFT JOIN funcao f ON f.id = pf.funcao_id
    GROUP BY p.id, p.nome ORDER BY p.nome`);
  console.table(rows);
} catch (e) { console.error("ERRO:", e.message); process.exitCode = 1; }
finally { await client.end(); }
