// Separa os dois conceitos que estavam colados na stack de intenção:
//   FUNÇÃO — o que a pessoa marca no bot (Shai, Flanco, Ataque, Rangeds);
//   PARTY  — onde ela fica de fato in-game (alvo da escalação).
// Mais a marcação de RELÍQUIA (coluna em players), que NUNCA aparece no bot.
//
// A `funcao` nasce copiando participacao_pt COM OS MESMOS IDs — assim qualquer pt_id já gravado
// segue válido como funcao_id e não há remapeamento. A stack participacao_* não é tocada.
// Idempotente. Uso: node --env-file=.env.local scripts/migrate_funcao_party.mjs
import pg from "pg";

const conn = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL ausente."); process.exit(1); }

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const col = async (t, c) => (await client.query(
  `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).rowCount > 0;

try {
  await client.connect();

  // guarda-chuva: a escalação vai trocar de alvo (função → party). Com dado gravado isso perderia
  // sentido silenciosamente, então avisa em vez de destruir.
  const { rows: [uso] } = await client.query(`SELECT
    (SELECT count(*) FROM evento_escalacao)::int esc,
    (SELECT count(*) FROM intencao_marca)::int marca`);
  if (uso.esc > 0) {
    if (!process.argv.includes("--limpar-escalacao")) {
      console.error(`ABORTADO: evento_escalacao tem ${uso.esc} linha(s) apontando pra função.`);
      console.error("A escalação passa a apontar pra PARTY, e ainda não existe party nenhuma —");
      console.error("essas linhas não têm pra onde ir. Rode com --limpar-escalacao pra descartá-las.");
      process.exit(1);
    }
    const { rows } = await client.query(`SELECT evento_id, familia FROM evento_escalacao`);
    console.warn("descartando escalação antiga (apontava pra função):", rows.map((r) => `${r.familia}@ev${r.evento_id}`).join(", "));
    await client.query(`DELETE FROM evento_escalacao`);
  }
  if (uso.marca > 0) console.warn(`aviso: ${uso.marca} marca(s) de intenção já gravadas — os ids são preservados, seguem valendo.`);

  // ---- FUNÇÃO (o que vira botão no bot) ----
  await client.query(`CREATE TABLE IF NOT EXISTS funcao (
    id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome   TEXT NOT NULL,
    emoji  TEXT,
    ordem  INT NOT NULL DEFAULT 0,
    criado TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  // copia do catálogo antigo PRESERVANDO id (OVERRIDING SYSTEM VALUE) e realinha a sequence
  await client.query(`INSERT INTO funcao (id, nome, emoji, ordem)
    OVERRIDING SYSTEM VALUE
    SELECT p.id, p.nome, p.emoji, (row_number() OVER (ORDER BY p.id))::int - 1
    FROM participacao_pt p
    WHERE NOT EXISTS (SELECT 1 FROM funcao f WHERE f.id = p.id)`);
  await client.query(`SELECT setval(pg_get_serial_sequence('funcao','id'), GREATEST((SELECT COALESCE(max(id),0) FROM funcao), 1))`);

  // ---- PARTY (in-game; alvo da escalação) — lista livre ----
  await client.query(`CREATE TABLE IF NOT EXISTS party (
    id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome   TEXT NOT NULL,
    icone  TEXT,
    ordem  INT NOT NULL DEFAULT 0,
    criado TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  // ---- RELÍQUIA: propriedade da pessoa, nunca do bot ----
  if (!(await col("players", "reliquia"))) {
    await client.query(`ALTER TABLE players ADD COLUMN reliquia BOOLEAN NOT NULL DEFAULT FALSE`);
  }

  // ---- repontar a stack de intenção: pt_id → funcao_id ----
  for (const t of ["intencao_preset_pt", "intencao_membro", "intencao_marca"]) {
    if (await col(t, "pt_id")) {
      await client.query(`ALTER TABLE ${t} RENAME COLUMN pt_id TO funcao_id`);
      await client.query(`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS ${t}_pt_id_fkey`);
      await client.query(`ALTER TABLE ${t} ADD CONSTRAINT ${t}_funcao_id_fkey
        FOREIGN KEY (funcao_id) REFERENCES funcao(id) ON DELETE CASCADE`);
    }
  }

  // ---- escalação passa a apontar pra PARTY ----
  if (await col("evento_escalacao", "pt_id")) {
    await client.query(`ALTER TABLE evento_escalacao RENAME COLUMN pt_id TO party_id`);
    await client.query(`ALTER TABLE evento_escalacao DROP CONSTRAINT IF EXISTS evento_escalacao_pt_id_fkey`);
    await client.query(`ALTER TABLE evento_escalacao ADD CONSTRAINT evento_escalacao_party_id_fkey
      FOREIGN KEY (party_id) REFERENCES party(id) ON DELETE SET NULL`);
    await client.query(`DROP INDEX IF EXISTS ix_evento_escalacao_pt`);
    await client.query(`CREATE INDEX IF NOT EXISTS ix_evento_escalacao_party ON evento_escalacao (evento_id, party_id)`);
  }

  const { rows: [r] } = await client.query(`SELECT
    (SELECT count(*) FROM funcao)::int funcoes,
    (SELECT count(*) FROM party)::int parties,
    (SELECT count(*) FROM players WHERE reliquia)::int reliquias`);
  console.log("OK —", JSON.stringify(r));
  console.log("funções:", (await client.query(`SELECT id, nome, COALESCE(emoji,'—') emoji FROM funcao ORDER BY ordem, id`)).rows.map((f) => `${f.id}:${f.nome}`).join("  "));

  const { rows: [v] } = await client.query(`SELECT
    (SELECT count(*) FROM participacao_pt)::int pts,
    (SELECT count(*) FROM participacao_membro)::int membros,
    (SELECT count(*) FROM participacao_resp)::int resp`);
  console.log("stack antiga (tem que estar igual):", JSON.stringify(v));
} catch (e) {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
