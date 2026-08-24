import { neon } from "@neondatabase/serverless";

/**
 * `evento_escalacao.saiu_em` — QUANDO a staff tirou esta pessoa da PT.
 *
 * A primeira versão da feature derivava isso de `atualizado` (o carimbo genérico de "esta linha
 * mudou"), e a derivação é ambígua por construção: `atualizado` é escrito por QUALQUER arraste —
 * escalar, mover de PT, tirar. Ler "atualizado > convidado_em" como "a staff cortou" acerta no caso
 * comum e erra em dois que acontecem de verdade:
 *
 *   - quem foi MOVIDO de PT depois da DM, recusou, e teve a recusa desfeita no ↺: `atualizado` é da
 *     mudança de PT, mas a leitura acusa um corte que ninguém fez;
 *   - e nenhuma comparação de carimbo separa "saiu porque a staff arrastou" de "saiu porque recusou"
 *     — a recusa nem toca em `atualizado` (lib/convocacao.ts), então o valor que sobra é de outro
 *     evento da vida da linha.
 *
 * Com a coluna, o fato é registrado por quem o pratica: só o ramo de REMOÇÃO de `aplicarEscalacao`
 * escreve `saiu_em`, e voltar pra uma PT o apaga. Sem inferência.
 *
 * BACKFILL: as linhas que HOJE estão nesse estado recebem `saiu_em = atualizado` — é a melhor
 * aproximação disponível pro passado, e sem ela as pessoas que já estão fora da escalação agora
 * sumiriam do estado no instante do deploy (a staff perderia o aviso pendente de quem já foi
 * cortado nesta guerra).
 */
const sql = neon(process.env.DATABASE_URL);

const col = await sql`SELECT column_name FROM information_schema.columns
                      WHERE table_name = 'evento_escalacao' AND column_name = 'saiu_em'`;
if (col.length) {
  console.log("saiu_em já existe — nada a fazer");
} else {
  await sql`ALTER TABLE evento_escalacao ADD COLUMN saiu_em TIMESTAMPTZ`;
  console.log("coluna saiu_em criada");

  const antes = await sql`
    SELECT evento_id::int AS evento_id, familia, atualizado::text AS atualizado, convidado_em::text AS convidado_em
    FROM evento_escalacao e
    WHERE e.party_id IS NULL AND e.convidado_em IS NOT NULL AND e.confirmou IS NOT FALSE
      AND e.atualizado > e.convidado_em
    ORDER BY e.evento_id, e.familia`;
  console.log(`backfill: ${antes.length} linha(s) que já estão fora depois de convocadas`);
  for (const r of antes) console.log(`  evento ${r.evento_id}  ${r.familia}  (cortado ~${r.atualizado})`);

  const feitas = await sql`
    UPDATE evento_escalacao e SET saiu_em = e.atualizado
    WHERE e.party_id IS NULL AND e.convidado_em IS NOT NULL AND e.confirmou IS NOT FALSE
      AND e.atualizado > e.convidado_em
    RETURNING 1`;
  console.log(`gravadas: ${feitas.length}`);
}

const n = await sql`SELECT count(*)::int AS n FROM evento_escalacao WHERE saiu_em IS NOT NULL`;
console.log("total com saiu_em:", n[0].n);
