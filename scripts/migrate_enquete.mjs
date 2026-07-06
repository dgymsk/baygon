// Enquete: primitiva genérica de votação (poll/opção/voto) desacoplada.
// 1 enquete = título + N opções (label+estilo+emoji). 1 voto por (enquete,user), trocável.
// Reusada pelo Buzinador (botões na DM) e, no futuro, pelo confirm da participação por DM.
// Uso: node --env-file=.env.local scripts/migrate_enquete.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();

  await client.query(`CREATE TABLE IF NOT EXISTS enquete (
    id            BIGSERIAL PRIMARY KEY,
    titulo        TEXT NOT NULL DEFAULT '',
    contexto      TEXT NOT NULL DEFAULT 'buzinador',   -- 'buzinador' | 'participacao' (origem p/ reuso/hook)
    ref_id        TEXT,                                 -- ponteiro livre pro dono (ex: war_key da participacao)
    escolha_unica BOOLEAN NOT NULL DEFAULT TRUE,        -- reservado; hoje sempre TRUE
    status        TEXT NOT NULL DEFAULT 'aberta',       -- 'aberta' | 'fechada'
    criado_por    TEXT,
    criado        TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS enquete_ctx_ref ON enquete (contexto, ref_id)`);

  await client.query(`CREATE TABLE IF NOT EXISTS enquete_opcao (
    id         BIGSERIAL PRIMARY KEY,
    enquete_id BIGINT   NOT NULL REFERENCES enquete(id) ON DELETE CASCADE,
    idx        SMALLINT NOT NULL,                       -- 0..24; entra no custom_id
    label      TEXT     NOT NULL,                       -- <=80 chars (limite Discord)
    estilo     SMALLINT NOT NULL DEFAULT 2,             -- 1 azul | 2 cinza | 3 verde | 4 vermelho
    emoji      TEXT,                                    -- '<:nome:id>' | '<a:nome:id>' | unicode | NULL
    CONSTRAINT enquete_opcao_estilo_ck CHECK (estilo IN (1,2,3,4)),
    CONSTRAINT enquete_opcao_idx_ck    CHECK (idx >= 0 AND idx <= 24),
    UNIQUE (enquete_id, idx)
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS enquete_opcao_enq ON enquete_opcao (enquete_id, idx)`);

  await client.query(`CREATE TABLE IF NOT EXISTS enquete_voto (
    enquete_id BIGINT NOT NULL REFERENCES enquete(id) ON DELETE CASCADE,
    user_id    TEXT   NOT NULL,
    opcao_id   BIGINT NOT NULL REFERENCES enquete_opcao(id) ON DELETE CASCADE,
    username   TEXT,                                    -- snapshot p/ o relatório
    votado     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (enquete_id, user_id)                   -- 1 voto/pessoa; troca via ON CONFLICT (anti-corrida)
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS enquete_voto_opcao ON enquete_voto (opcao_id)`);

  // Tally eficiente: LEFT JOIN garante opção com 0 voto.
  await client.query(`CREATE OR REPLACE VIEW enquete_tally AS
    SELECT o.enquete_id, o.id AS opcao_id, o.idx, o.label, o.estilo, o.emoji,
           count(v.user_id)::int AS votos
    FROM enquete_opcao o
    LEFT JOIN enquete_voto v ON v.opcao_id = o.id
    GROUP BY o.enquete_id, o.id, o.idx, o.label, o.estilo, o.emoji`);

  // Buzinador: liga um envio a uma enquete opcional (NULL = envio sem botões, comportamento atual intacto).
  await client.query(`ALTER TABLE buzinador_envio ADD COLUMN IF NOT EXISTS enquete_id BIGINT REFERENCES enquete(id) ON DELETE SET NULL`);

  const t = await client.query(`SELECT to_regclass('enquete') e, to_regclass('enquete_opcao') o, to_regclass('enquete_voto') v, to_regclass('enquete_tally') w`);
  console.log("OK — enquete:", t.rows[0]);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
