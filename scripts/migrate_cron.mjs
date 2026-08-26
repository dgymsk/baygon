import { neon } from "@neondatabase/serverless";

/**
 * REGISTRO E CONTROLE DAS EXECUÇÕES AUTOMÁTICAS.
 *
 * Até aqui o disparo agendado era uma caixa-preta: o worker (ou o cron da Vercel) batia no endpoint,
 * o endpoint respondia um JSON que ninguém lia, e a única evidência de que algo aconteceu era a
 * chamada aparecer — ou não — no Discord. Quando não aparecia, não havia como saber se ninguém
 * chamou, se chamou e não havia agenda vencida, ou se deu erro.
 *
 * `cron_exec` é o extrato: uma linha por batida, com quem chamou, o que estava vencido, o que foi
 * feito e quanto demorou. É o que faz a tela do /hub responder "rodou?" sem depender de log da
 * Vercel — que expira, e que ninguém abre.
 *
 * `cron_config` é o controle que NÃO exige deploy. O horário das entradas mora no vercel.json e só
 * muda com deploy, mas duas coisas dá pra decidir em tempo de execução: se a rede de segurança está
 * ligada e quanto atraso ela aceita. Linha única (id=1), como o resto da config do projeto.
 */
const sql = neon(process.env.DATABASE_URL);

await sql`CREATE TABLE IF NOT EXISTS cron_exec (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  endpoint  TEXT NOT NULL,                    -- '/api/intencao/cron', '/api/garmoth/refresh', …
  origem    TEXT NOT NULL,                    -- 'vercel' | 'worker' | 'manual'
  agendamento TEXT,                           -- a expressão que disparou (só a Vercel manda)
  quem      TEXT,                             -- staff que apertou "rodar agora"
  inicio    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ms        INT,
  ok        BOOLEAN NOT NULL DEFAULT TRUE,
  devidas   INT NOT NULL DEFAULT 0,           -- quantas agendas estavam vencidas
  resultado JSONB,                            -- o que foi feito, como o endpoint respondeu
  erro      TEXT
)`;
await sql`CREATE INDEX IF NOT EXISTS ix_cron_exec ON cron_exec (endpoint, inicio DESC)`;

await sql`CREATE TABLE IF NOT EXISTS cron_config (
  id            INT PRIMARY KEY DEFAULT 1,
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,   -- a rede de segurança da Vercel responde ou não
  tolerancia_min INT NOT NULL DEFAULT 120,       -- atraso máximo que ela ainda dispara
  atualizado    TIMESTAMPTZ NOT NULL DEFAULT now()
)`;
await sql`INSERT INTO cron_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;

const t = await sql`SELECT to_regclass('cron_exec') AS exec, to_regclass('cron_config') AS cfg`;
const c = await sql`SELECT ativo, tolerancia_min FROM cron_config WHERE id = 1`;
console.log("tabelas:", t[0], "| config:", c[0]);
console.log("execuções registradas:", (await sql`SELECT count(*)::int AS n FROM cron_exec`)[0].n);
