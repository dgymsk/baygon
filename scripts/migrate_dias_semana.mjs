import { neon } from "@neondatabase/serverless";

/**
 * `players.dias_semana` — os dias em que a pessoa COSTUMA poder jogar.
 *
 * Não é regra, é informação: o card dela ganha uma listra na escalação quando a guerra cai num
 * desses dias. Quem monta escalação hoje guarda isso de cabeça ("o Dixit só joga começo de semana")
 * e erra a cada troca de staff — a informação existe, só não estava em lugar nenhum.
 *
 * INT[] com a convenção de `Date.getUTCDay()`: 0 = domingo … 6 = sábado. A MESMA de
 * `intencao_agenda.dias` (lib/agenda.ts), e de propósito: duas convenções de dia da semana no mesmo
 * banco é o tipo de coisa que só aparece no dia em que alguém compara as duas e a segunda-feira de
 * uma é o domingo da outra.
 *
 * NULL e vazio significam a MESMA coisa aqui — "não informado" —, e é por isso que a coluna não tem
 * DEFAULT '{}': quem nunca respondeu não deve ficar indistinguível de quem disse "não jogo nenhum
 * dia". Nenhum dos dois recebe destaque; a diferença é só de leitura humana.
 */
const sql = neon(process.env.DATABASE_URL);

const col = await sql`SELECT column_name FROM information_schema.columns
                      WHERE table_name = 'players' AND column_name = 'dias_semana'`;
if (col.length) {
  console.log("dias_semana já existe — nada a fazer");
} else {
  await sql`ALTER TABLE players ADD COLUMN dias_semana INT[]`;
  console.log("coluna dias_semana criada");
}

const n = await sql`SELECT count(*)::int AS total,
                           count(dias_semana)::int AS com_dias FROM players WHERE ativo`;
console.log("players ativos:", n[0].total, "| com dias informados:", n[0].com_dias);
