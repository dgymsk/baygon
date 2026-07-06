import { sql } from "@/lib/db";
import { botFetch } from "@/lib/discordApi";
import { getDiscordConfig } from "@/lib/discordConfig";

/**
 * Log de INTERAÇÕES LIVRES (texto): quando um membro escreve algo (modal do Buzinador ou /responder),
 * gravamos a resposta com um CÓDIGO de identificação e SEMPRE postamos no canal de log configurado
 * (discord_config.logChannel). Desacoplado: só depende de db/discordApi/discordConfig — o webhook chama
 * registrarTexto (grava, devolve {id,codigo}) e depois postarNoLog (posta no canal, em after()).
 */
export type Registro = { id: number; codigo: string };

const COR = 0x9b6bff; // roxo pro log (distinto do verde/participação)

/** Código curto e estável derivado do id serial (base36). Ex.: id 45 → "0019" (exibido como #0019). */
export function gerarCodigo(id: number): string {
  return id.toString(36).toUpperCase().padStart(4, "0");
}

/** Grava uma resposta de texto livre. Devolve {id, codigo} ou null se vazio. */
export async function registrarTexto(o: { userId: string; username?: string | null; conteudo: unknown; contexto?: string | null; refId?: string | null }): Promise<Registro | null> {
  const conteudo = String(o.conteudo ?? "").trim().slice(0, 2000);
  const userId = String(o.userId ?? "");
  if (!conteudo || !userId) return null;
  const rows = (await sql`
    INSERT INTO interacao_log (codigo, tipo, user_id, username, conteudo, contexto, ref_id)
    VALUES ('', 'texto', ${userId}, ${o.username ?? null}, ${conteudo}, ${o.contexto ?? null}, ${o.refId ?? null})
    RETURNING id::int AS id`) as { id: number }[];
  const id = rows[0].id;
  const codigo = gerarCodigo(id);
  await sql`UPDATE interacao_log SET codigo = ${codigo} WHERE id = ${id}`;
  return { id, codigo };
}

/** Posta a interação no canal de log. Devolve true se postou. O código é RECOMPUTADO de gerarCodigo(id)
 * (não depende da coluna, que pode ter ficado vazia se o UPDATE do registro falhar). */
export async function postarNoLog(id: number): Promise<boolean> {
  const rows = (await sql`SELECT id::int AS id, user_id, username, conteudo, contexto FROM interacao_log WHERE id = ${id}`) as { id: number; user_id: string; username: string | null; conteudo: string; contexto: string | null }[];
  const r = rows[0];
  if (!r) return false;
  const canal = (await getDiscordConfig()).logChannel;
  const codigo = gerarCodigo(r.id);
  if (!canal) { console.warn(`interacaoLog: resposta #${codigo} salva mas NÃO postada — canal de log não configurado (defina em /discord)`); return false; }
  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Membro", value: `<@${r.user_id}>${r.username ? ` · ${r.username}` : ""}`.slice(0, 1024), inline: true },
  ];
  if (r.contexto) fields.push({ name: "Origem", value: r.contexto.slice(0, 1024), inline: true });
  const embed = {
    title: `📝 Resposta #${codigo}`,
    description: r.conteudo.slice(0, 4000),
    color: COR,
    fields,
    timestamp: new Date().toISOString(),
  };
  const res = await botFetch(`/channels/${canal}/messages`, { method: "POST", body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }) });
  if (res.ok) { const m = (await res.json()) as { id: string }; await sql`UPDATE interacao_log SET log_message_id = ${m.id} WHERE id = ${id}`; return true; }
  return false;
}
