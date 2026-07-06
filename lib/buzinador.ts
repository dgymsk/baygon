import { sql } from "@/lib/db";
import { botFetch, botConfigurado } from "@/lib/discordApi";
import { getDiscordConfig } from "@/lib/discordConfig";

/**
 * Buzinador — dispara uma DM (PM) privada pra cada jogador de uma AUDIÊNCIA e registra
 * quem RECEBEU vs quem FALHOU (DM fechada), postando um relatório num canal escolhido.
 * Sem botões/coleta de resposta — só entrega. A audiência é reaproveitável (cargo / todos /
 * lista de IDs); a mesma engine serve depois pra "não decididos" da confirmação.
 *
 * Fluxo: criarEnvio() resolve a audiência e grava envio + alvos (pendente). O painel chama
 * processarLote() repetidamente (cada lote abre DM + envia p/ N alvos) até pendentes=0, quando
 * o relatório é postado. Fatiar em lotes evita o timeout do serverless em audiências grandes.
 */
export type Audiencia = { tipo: "role" | "todos" | "lista"; roleId?: string; userIds?: string };
export type Alvo = { userId: string; nome: string | null };
export type Progresso = { enviados: number; falhas: number; pendentes: number; total: number; concluido: boolean; reportOk?: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dig = (s: unknown) => (typeof s === "string" ? s.replace(/[^0-9]/g, "").slice(0, 25) : "");
const urlOk = (s: unknown) => (typeof s === "string" && /^https?:\/\/\S{1,500}$/.test(s.trim()) ? s.trim() : "");
const COR = 0x34e06a;

/** IDs (snowflakes) de um texto livre com menções/ids soltos. Dedup preservando ordem. */
function parseIds(raw: unknown): string[] {
  const ids = (typeof raw === "string" ? raw : "").match(/\d{17,20}/g) ?? [];
  return [...new Set(ids)];
}

/** Lista TODOS os membros do servidor ativo (paginado). Exige o "Server Members Intent". */
async function listarMembrosGuild(): Promise<{ userId: string; nome: string; roles: string[]; bot: boolean }[]> {
  const gid = (await getDiscordConfig()).guildId;
  if (!gid) throw new Error("sem guild configurada");
  const out: { userId: string; nome: string; roles: string[]; bot: boolean }[] = [];
  let after = "0";
  for (let i = 0; i < 30; i++) {
    const res = await botFetch(`/guilds/${gid}/members?limit=1000&after=${after}`);
    if (!res.ok) throw new Error(`membros ${res.status}`);
    const arr = (await res.json()) as { user?: { id: string; username?: string; global_name?: string | null; bot?: boolean }; nick?: string | null; roles?: string[] }[];
    if (!Array.isArray(arr) || arr.length === 0) break;
    for (const m of arr) {
      const u = m.user;
      if (!u?.id) continue;
      out.push({ userId: u.id, nome: m.nick || u.global_name || u.username || u.id, roles: m.roles ?? [], bot: !!u.bot });
    }
    if (arr.length < 1000) break;
    after = arr[arr.length - 1].user!.id;
  }
  return out;
}

/** Resolve a audiência em uma lista de alvos {userId, nome}. */
async function resolverAudiencia(a: Audiencia): Promise<{ ok: true; alvos: Alvo[] } | { ok: false; erro: string }> {
  if (a?.tipo === "lista") {
    const ids = parseIds(a.userIds);
    if (!ids.length) return { ok: false, erro: "nenhum ID válido na lista" };
    return { ok: true, alvos: ids.map((id) => ({ userId: id, nome: null })) };
  }
  let membros: Awaited<ReturnType<typeof listarMembrosGuild>>;
  try {
    membros = await listarMembrosGuild();
  } catch {
    return { ok: false, erro: "não consegui listar os membros. Ative o 'Server Members Intent' no bot (Discord Developer Portal → Bot → Privileged Gateway Intents) e tente de novo." };
  }
  let sel = membros.filter((m) => !m.bot);
  if (a?.tipo === "role") {
    const rid = dig(a.roleId);
    if (!rid) return { ok: false, erro: "cargo inválido" };
    sel = sel.filter((m) => m.roles.includes(rid));
  }
  if (!sel.length) return { ok: false, erro: "nenhum destinatário encontrado nessa audiência" };
  return { ok: true, alvos: sel.map((m) => ({ userId: m.userId, nome: m.nome })) };
}

/** Abre a DM e envia a mensagem. Falha (DM fechada/bloqueio) → {ok:false}. */
async function enviarDM(userId: string, mensagem: string, imagemUrl: string | null): Promise<{ ok: boolean; erro?: string }> {
  const dm = await botFetch(`/users/@me/channels`, { method: "POST", body: JSON.stringify({ recipient_id: userId }) });
  if (!dm.ok) return { ok: false, erro: `dm ${dm.status}` };
  const ch = (await dm.json()) as { id: string };
  const body: Record<string, unknown> = { content: mensagem, allowed_mentions: { parse: [] } };
  if (imagemUrl) body.embeds = [{ image: { url: imagemUrl }, color: COR }];
  const msg = await botFetch(`/channels/${ch.id}/messages`, { method: "POST", body: JSON.stringify(body) });
  if (!msg.ok) return { ok: false, erro: `msg ${msg.status}` };
  return { ok: true };
}

/** Cria um envio: resolve a audiência, grava envio + alvos (status pendente). */
export async function criarEnvio(input: { mensagem: unknown; imagemUrl?: unknown; canalReportId: unknown; audiencia: Audiencia; criadoPor?: unknown }): Promise<{ ok: boolean; envioId?: number; total?: number; erro?: string }> {
  if (!botConfigurado()) return { ok: false, erro: "bot não configurado" };
  const mensagem = String(input.mensagem ?? "").trim().slice(0, 1900);
  if (!mensagem) return { ok: false, erro: "mensagem vazia" };
  const canal = dig(input.canalReportId);
  if (!canal) return { ok: false, erro: "canal de relatório inválido" };
  const imagemUrl = urlOk(input.imagemUrl) || null;
  const criadoPor = (String(input.criadoPor ?? "").trim().slice(0, 80)) || null;

  const res = await resolverAudiencia(input.audiencia ?? ({} as Audiencia));
  if (!res.ok) return { ok: false, erro: res.erro };
  // dedup por userId
  const seen = new Set<string>();
  const alvos = res.alvos.filter((a) => (seen.has(a.userId) ? false : (seen.add(a.userId), true)));

  const rows = (await sql`
    INSERT INTO buzinador_envio (mensagem, imagem_url, canal_report_id, criado_por, status, total)
    VALUES (${mensagem}, ${imagemUrl}, ${canal}, ${criadoPor}, 'pendente', ${alvos.length})
    RETURNING id::int AS id`) as { id: number }[];
  const envioId = rows[0].id;
  if (alvos.length) {
    await sql.transaction(alvos.map((a) => sql`INSERT INTO buzinador_alvo (envio_id, user_id, nome) VALUES (${envioId}, ${a.userId}, ${a.nome}) ON CONFLICT (envio_id, user_id) DO NOTHING`));
  }
  return { ok: true, envioId, total: alvos.length };
}

async function contar(envioId: number) {
  const c = (await sql`
    SELECT count(*) FILTER (WHERE status='ok') AS ok, count(*) FILTER (WHERE status='falha') AS falha,
           count(*) FILTER (WHERE status='pendente') AS pend, count(*) AS total
    FROM buzinador_alvo WHERE envio_id = ${envioId}`) as { ok: string; falha: string; pend: string; total: string }[];
  const r = c[0];
  return { ok: Number(r.ok), falha: Number(r.falha), pend: Number(r.pend), total: Number(r.total) };
}

/** Progresso atual (sem processar). */
export async function getProgresso(envioId: number): Promise<Progresso | null> {
  const env = (await sql`SELECT status FROM buzinador_envio WHERE id = ${envioId}`) as { status: string }[];
  if (!env[0]) return null;
  const c = await contar(envioId);
  return { enviados: c.ok, falhas: c.falha, pendentes: c.pend, total: c.total, concluido: env[0].status === "concluido" };
}

/** Processa UM lote de pendentes (abre DM + envia). Ao zerar pendentes, posta o relatório. */
export async function processarLote(envioId: number, tamanho = 20): Promise<Progresso | { erro: string }> {
  const env = (await sql`SELECT id::int AS id, mensagem, imagem_url, canal_report_id, criado_por, status FROM buzinador_envio WHERE id = ${envioId}`) as { id: number; mensagem: string; imagem_url: string | null; canal_report_id: string; criado_por: string | null; status: string }[];
  const e = env[0];
  if (!e) return { erro: "envio não encontrado" };
  if (e.status === "concluido") { const c = await contar(envioId); return { enviados: c.ok, falhas: c.falha, pendentes: c.pend, total: c.total, concluido: true }; }
  await sql`UPDATE buzinador_envio SET status = 'enviando' WHERE id = ${envioId} AND status = 'pendente'`;

  const pend = (await sql`SELECT id::int AS id, user_id FROM buzinador_alvo WHERE envio_id = ${envioId} AND status = 'pendente' ORDER BY id LIMIT ${tamanho}`) as { id: number; user_id: string }[];
  for (const a of pend) {
    const r = await enviarDM(a.user_id, e.mensagem, e.imagem_url);
    await sql`UPDATE buzinador_alvo SET status = ${r.ok ? "ok" : "falha"}, erro = ${r.erro ?? null}, tentado = now() WHERE id = ${a.id}`;
    await sleep(150);
  }

  const c = await contar(envioId);
  let concluido = false;
  let reportOk: boolean | undefined;
  if (c.pend === 0) {
    // claim atômico: só uma chamada finaliza e posta o relatório
    const claim = (await sql`UPDATE buzinador_envio SET status='concluido', concluido=now() WHERE id = ${envioId} AND status <> 'concluido' RETURNING id::int AS id`) as { id: number }[];
    concluido = true;
    if (claim.length) reportOk = await postarRelatorio(e, c);
  }
  return { enviados: c.ok, falhas: c.falha, pendentes: c.pend, total: c.total, concluido, reportOk };
}

async function postarRelatorio(e: { id: number; mensagem: string; canal_report_id: string; criado_por: string | null }, c: { ok: number; falha: number; total: number }): Promise<boolean> {
  const falhas = (await sql`SELECT user_id, nome FROM buzinador_alvo WHERE envio_id = ${e.id} AND status = 'falha' ORDER BY id`) as { user_id: string; nome: string | null }[];
  const listaFalhas = falhas.map((f) => (f.nome ? `${f.nome} (<@${f.user_id}>)` : `<@${f.user_id}>`)).join(", ");
  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "✅ Receberam", value: String(c.ok), inline: true },
    { name: "❌ Falharam (DM fechada)", value: String(c.falha), inline: true },
    { name: "👥 Total", value: String(c.total), inline: true },
  ];
  if (falhas.length) fields.push({ name: "❌ Não receberam", value: (listaFalhas || "—").slice(0, 1024), inline: false });
  const embed = {
    title: "📢 Buzinador — relatório de entrega",
    description: `> ${e.mensagem.slice(0, 300)}${e.mensagem.length > 300 ? "…" : ""}`,
    color: COR,
    fields,
    footer: e.criado_por ? { text: `disparado por ${e.criado_por}` } : undefined,
    timestamp: new Date().toISOString(),
  };
  const res = await botFetch(`/channels/${e.canal_report_id}/messages`, { method: "POST", body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }) });
  const reportId = res.ok ? ((await res.json()) as { id: string }).id : null;
  await sql`UPDATE buzinador_envio SET report_message_id = ${reportId} WHERE id = ${e.id}`;
  return res.ok;
}
