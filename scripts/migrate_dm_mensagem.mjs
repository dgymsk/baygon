import { neon } from "@neondatabase/serverless";

/**
 * `dm_lote_alvo` passa a guardar QUAL mensagem foi enviada — canal e id — e se ela já foi retratada.
 *
 * Sem isso, uma DM disparada é irreversível: o app sabe que ela saiu ("status = ok") mas não tem
 * como voltar nela. O caso que obriga a mudança: a staff avisa "você NÃO está mais escalado, tire o
 * participar", muda de ideia dez minutos depois e reescala a pessoa — e o aviso continua no privado
 * dela, dizendo o contrário do que vale agora. Quem lê a mensagem velha sai da guerra.
 *
 * `retratado_em` existe pra edição não virar loop: cada arraste na escalação passaria de novo pelo
 * mesmo conserto e ficaria repetindo PATCH no Discord (que limita o bot por isso). Como ele só é
 * carimbado DEPOIS do PATCH dar certo, uma falha de rede deixa a linha pendente e a próxima tentativa
 * refaz — conserto que se cura sozinho em vez de errar em silêncio.
 */
const sql = neon(process.env.DATABASE_URL);

const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'dm_lote_alvo'`;
const tem = new Set(cols.map((c) => c.column_name));

for (const [nome, tipo] of [["dm_channel_id", "TEXT"], ["dm_message_id", "TEXT"], ["retratado_em", "TIMESTAMPTZ"]]) {
  if (tem.has(nome)) { console.log(`${nome} já existe`); continue; }
  await sql.query(`ALTER TABLE dm_lote_alvo ADD COLUMN ${nome} ${tipo}`);
  console.log(`coluna ${nome} criada`);
}

// as DMs já enviadas não têm como ser recuperadas (o id da mensagem se perdeu no envio); elas ficam
// sem retratação possível, e é só o que fica pra trás — daqui pra frente todas são editáveis
const n = await sql`SELECT count(*)::int AS n FROM dm_lote_alvo WHERE status = 'ok'`;
console.log(`envios 'ok' no histórico, sem id de mensagem (não retratáveis): ${n[0].n}`);
