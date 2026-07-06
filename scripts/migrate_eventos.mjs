// Hub de EVENTOS: 1 evento por disparo. participacao_post vira a 1ª faceta (evento_id FK).
// Confirmados/resultado penduram DEPOIS como satélites (evento_id FK), sem tocar aqui. Idempotente.
// Uso: node --env-file=.env.local scripts/migrate_eventos.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();

  // HUB. id = FK interna (BIGINT, ::int no app); uuid = chave pública/URL; data = chave de negócio/busca (TZ BR).
  await client.query(`CREATE TABLE IF NOT EXISTS evento (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid          UUID NOT NULL DEFAULT gen_random_uuid(),
    data          DATE NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    tipo          TEXT NOT NULL,                                   -- 'nodewar' | 'siege'
    titulo        TEXT,                                            -- nome do template no disparo (denormalizado)
    status        TEXT NOT NULL DEFAULT 'aberto'
                  CHECK (status IN ('aberto','travado','finalizado')),
    template_id   BIGINT,                                          -- referência frouxa (template pode sumir)
    snapshot      JSONB,                                           -- "bot final": roster congelado (NULL até finalizar)
    criado        TIMESTAMPTZ NOT NULL DEFAULT now(),
    travado_em    TIMESTAMPTZ,
    finalizado_em TIMESTAMPTZ
  )`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_evento_uuid   ON evento (uuid)`);
  await client.query(`CREATE INDEX        IF NOT EXISTS ix_evento_data   ON evento (data DESC)`);
  await client.query(`CREATE INDEX        IF NOT EXISTS ix_evento_status ON evento (status, criado DESC)`);
  await client.query(`CREATE INDEX        IF NOT EXISTS ix_evento_tipo   ON evento (tipo, criado DESC)`);
  await client.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_evento_template') THEN
      ALTER TABLE evento ADD CONSTRAINT fk_evento_template
        FOREIGN KEY (template_id) REFERENCES participacao_template(id) ON DELETE SET NULL;
    END IF;
  END $$;`);

  // FACETA 1 (existente): liga o post ao evento. Única mudança no modelo atual.
  await client.query(`ALTER TABLE participacao_post ADD COLUMN IF NOT EXISTS evento_id BIGINT`);
  await client.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_participacao_post_evento') THEN
      ALTER TABLE participacao_post ADD CONSTRAINT fk_participacao_post_evento
        FOREIGN KEY (evento_id) REFERENCES evento(id) ON DELETE SET NULL;
    END IF;
  END $$;`);
  await client.query(`CREATE INDEX IF NOT EXISTS ix_participacao_post_evento ON participacao_post (evento_id)`);

  // BACKFILL bulletproof (por message_id): 1 evento por post sem evento. A rodada MAIS RECENTE de cada
  // tipo (a "ativa" que postsAtivos mostra) nasce 'aberto'; as passadas nascem 'finalizado' com finalizado_em.
  const posts = (await client.query(
    `SELECT message_id, tipo, titulo, template_id, criado FROM participacao_post WHERE evento_id IS NULL ORDER BY criado`,
  )).rows;
  const maisRecente = {}; // tipo -> message_id (ORDER BY criado ASC → o último visto é o mais recente)
  for (const p of posts) maisRecente[p.tipo] = p.message_id;
  for (const p of posts) {
    // template_id só entra se o template ainda existe (evita violar a FK do hub)
    const tid = p.template_id != null
      ? ((await client.query(`SELECT id FROM participacao_template WHERE id = $1`, [p.template_id])).rows[0]?.id ?? null)
      : null;
    const ativo = maisRecente[p.tipo] === p.message_id;
    const ev = await client.query(
      `INSERT INTO evento (tipo, titulo, template_id, status, data, criado, finalizado_em)
       VALUES ($1, $2, $3, $5, ($4 AT TIME ZONE 'America/Sao_Paulo')::date, $4, $6) RETURNING id`,
      [p.tipo, p.titulo, tid, p.criado, ativo ? "aberto" : "finalizado", ativo ? null : p.criado],
    );
    await client.query(`UPDATE participacao_post SET evento_id = $1 WHERE message_id = $2`, [ev.rows[0].id, p.message_id]);
  }

  console.log("OK — evento:", (await client.query(`SELECT to_regclass('evento') a`)).rows[0].a,
    "| posts ligados:", (await client.query(`SELECT count(*)::int c FROM participacao_post WHERE evento_id IS NOT NULL`)).rows[0].c,
    `(backfill: ${posts.length})`);
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
