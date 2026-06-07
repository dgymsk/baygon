import { neon } from "@neondatabase/serverless";

/**
 * Módulo de conexão com o Postgres (Neon) — driver HTTP serverless.
 *
 * Usa a `DATABASE_URL` (pooled), injetada pelo Vercel (Storage → Neon) em
 * produção/preview e lida do `.env.local` em desenvolvimento. Ideal para os
 * endpoints de API (serverless) e Server Components: cada query é um fetch,
 * sem pool de conexões pra gerenciar.
 *
 * Uso (tagged template, já parametrizado/seguro contra SQL injection):
 *   import { sql } from "@/lib/db";
 *   const rows = await sql`SELECT * FROM wars WHERE war_id = ${id}`;
 *
 * Para scripts locais de migração/seed usamos o driver `pg` (ver scripts/),
 * não este módulo.
 */

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DATABASE_URL ausente. Configure o Neon no Vercel (aba Storage) e rode " +
      "`vercel env pull .env.local`, ou defina DATABASE_URL no .env.local.",
  );
}

export const sql = neon(url);
