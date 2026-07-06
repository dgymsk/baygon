import { sql } from "@/lib/db";
import { botFetch, botConfigurado } from "@/lib/discordApi";
import { getDiscordConfig } from "@/lib/discordConfig";
import { chaveNome } from "@/lib/nomes";
import { criarEnquete, getEnquete, montarComponents, tally, votos, type OpcaoInput, type ActionRow } from "@/lib/enquete";

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

/** Lista TODOS os membros do servidor ativo (paginado). Exige o "Server Members Intent".
 * `apelidos` = variações de nome (apelido/global/username) p/ casar a lista por nome. */
type MembroGuild = { userId: string; nome: string; apelidos: string[]; roles: string[]; bot: boolean };
async function listarMembrosGuild(): Promise<MembroGuild[]> {
  const gid = (await getDiscordConfig()).guildId;
  if (!gid) throw new Error("sem guild configurada");
  const out: MembroGuild[] = [];
  let after = "0";
  for (let i = 0; i < 30; i++) {
    const res = await botFetch(`/guilds/${gid}/members?limit=1000&after=${after}`);
    if (!res.ok) throw new Error(`membros ${res.status}`);
    const arr = (await res.json()) as { user?: { id: string; username?: string; global_name?: string | null; bot?: boolean }; nick?: string | null; roles?: string[] }[];
    if (!Array.isArray(arr) || arr.length === 0) break;
    for (const m of arr) {
      const u = m.user;
      if (!u?.id) continue;
      const apelidos = [m.nick, u.global_name, u.username].filter((x): x is string => !!x);
      out.push({ userId: u.id, nome: m.nick || u.global_name || u.username || u.id, apelidos, roles: m.roles ?? [], bot: !!u.bot });
    }
    if (arr.length < 1000) break;
    after = arr[arr.length - 1].user!.id;
  }
  return out;
}

/** Resolve a audiência em uma lista de alvos {userId, nome}. */
async function resolverAudiencia(a: Audiencia): Promise<{ ok: true; alvos: Alvo[]; naoEncontrados?: string[] } | { ok: false; erro: string }> {
  if (a?.tipo === "lista") {
    // cada linha: um ID/menção → dispara direto; um nome → casa com o nome no servidor (apelido/global/username)
    const linhas = String(a.userIds ?? "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!linhas.length) return { ok: false, erro: "lista vazia" };
    const seen = new Set<string>();
    const alvos: Alvo[] = [];
    const nomes: string[] = [];
    for (const l of linhas) {
      const idm = l.match(/^<@!?(\d{17,20})>$/) ?? l.match(/^(\d{17,20})$/);
      if (idm) { if (!seen.has(idm[1])) { seen.add(idm[1]); alvos.push({ userId: idm[1], nome: null }); } }
      else nomes.push(l);
    }
    const naoEncontrados: string[] = [];
    if (nomes.length) {
      let membros: MembroGuild[] | null = null;
      try { membros = await listarMembrosGuild(); } catch { membros = null; }
      if (!membros) return { ok: false, erro: "há nomes na lista, mas não consegui listar os membros pra casar. Use só IDs, ou ative o 'Server Members Intent' no bot." };
      const idxNome = new Map<string, { userId: string; nome: string }>();
      for (const m of membros) if (!m.bot) for (const ap of m.apelidos) { const k = chaveNome(ap); if (k && !idxNome.has(k)) idxNome.set(k, { userId: m.userId, nome: m.nome }); }
      for (const nm of nomes) {
        const hit = idxNome.get(chaveNome(nm));
        if (hit) { if (!seen.has(hit.userId)) { seen.add(hit.userId); alvos.push({ userId: hit.userId, nome: hit.nome }); } }
        else naoEncontrados.push(nm);
      }
    }
    if (!alvos.length) return { ok: false, erro: `nenhum destinatário resolvido${naoEncontrados.length ? ` — não encontrei: ${naoEncontrados.slice(0, 10).join(", ")}` : ""}` };
    return { ok: true, alvos, naoEncontrados: naoEncontrados.length ? naoEncontrados : undefined };
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

/** Abre a DM e envia a mensagem (com botões de enquete, se houver). Falha (DM fechada/bloqueio) → {ok:false}. */
async function enviarDM(userId: string, mensagem: string, imagemUrl: string | null, components?: ActionRow[]): Promise<{ ok: boolean; erro?: string }> {
  const dm = await botFetch(`/users/@me/channels`, { method: "POST", body: JSON.stringify({ recipient_id: userId }) });
  if (!dm.ok) return { ok: false, erro: `dm ${dm.status}` };
  const ch = (await dm.json()) as { id: string };
  const body: Record<string, unknown> = { content: mensagem, allowed_mentions: { parse: [] } };
  if (imagemUrl) body.embeds = [{ image: { url: imagemUrl }, color: COR }];
  if (components && components.length) body.components = components;
  const msg = await botFetch(`/channels/${ch.id}/messages`, { method: "POST", body: JSON.stringify(body) });
  if (!msg.ok) return { ok: false, erro: `msg ${msg.status}` };
  return { ok: true };
}

/** Cria um envio: resolve a audiência, cria a enquete (se houver opções) e grava envio + alvos. */
export async function criarEnvio(input: { mensagem: unknown; imagemUrl?: unknown; canalReportId: unknown; audiencia: Audiencia; criadoPor?: unknown; opcoes?: OpcaoInput[]; contexto?: string; refId?: string | null }): Promise<{ ok: boolean; envioId?: number; total?: number; naoEncontrados?: string[]; erro?: string }> {
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

  // enquete opcional (botões). Só cria após a audiência ser válida, pra não deixar enquete órfã.
  let enqueteId: number | null = null;
  const opcoes = Array.isArray(input.opcoes) ? input.opcoes.filter((o) => String(o?.label ?? "").trim()) : [];
  if (opcoes.length) {
    const enq = await criarEnquete({ titulo: mensagem.slice(0, 100), contexto: input.contexto || "buzinador", ref_id: input.refId ?? null, criadoPor, opcoes });
    if (!enq.ok) return { ok: false, erro: enq.erro };
    enqueteId = enq.enqueteId ?? null;
  }

  try {
    const rows = (await sql`
      INSERT INTO buzinador_envio (mensagem, imagem_url, canal_report_id, criado_por, status, total, enquete_id)
      VALUES (${mensagem}, ${imagemUrl}, ${canal}, ${criadoPor}, 'pendente', ${alvos.length}, ${enqueteId})
      RETURNING id::int AS id`) as { id: number }[];
    const envioId = rows[0].id;
    if (alvos.length) {
      await sql.transaction(alvos.map((a) => sql`INSERT INTO buzinador_alvo (envio_id, user_id, nome) VALUES (${envioId}, ${a.userId}, ${a.nome}) ON CONFLICT (envio_id, user_id) DO NOTHING`));
    }
    return { ok: true, envioId, total: alvos.length, naoEncontrados: res.naoEncontrados };
  } catch (err) {
    if (enqueteId != null) { try { await sql`DELETE FROM enquete WHERE id = ${enqueteId}`; } catch { /* limpeza best-effort */ } }
    throw err;
  }
}

async function contar(envioId: number) {
  const c = (await sql`
    SELECT count(*) FILTER (WHERE status='ok') AS ok, count(*) FILTER (WHERE status='falha') AS falha,
           count(*) FILTER (WHERE status NOT IN ('ok','falha')) AS pend, count(*) AS total
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
  const env = (await sql`SELECT id::int AS id, mensagem, imagem_url, canal_report_id, criado_por, status, enquete_id::int AS enquete_id FROM buzinador_envio WHERE id = ${envioId}`) as { id: number; mensagem: string; imagem_url: string | null; canal_report_id: string; criado_por: string | null; status: string; enquete_id: number | null }[];
  const e = env[0];
  if (!e) return { erro: "envio não encontrado" };
  if (e.status === "concluido") { const c = await contar(envioId); return { enviados: c.ok, falhas: c.falha, pendentes: c.pend, total: c.total, concluido: true }; }
  await sql`UPDATE buzinador_envio SET status = 'enviando' WHERE id = ${envioId} AND status = 'pendente'`;

  // carrega os botões da enquete UMA vez pro lote inteiro (se o envio tiver enquete)
  let components: ActionRow[] | undefined;
  if (e.enquete_id != null) { const enq = await getEnquete(e.enquete_id); if (enq) components = montarComponents(enq); }

  // Recupera alvos presos em 'enviando' de um lote que morreu no meio (>2min é órfão; um lote dura <=60s).
  await sql`UPDATE buzinador_alvo SET status = 'pendente' WHERE envio_id = ${envioId} AND status = 'enviando' AND (tentado IS NULL OR tentado < now() - interval '2 minutes')`;
  // CLAIM atômico: marca 'enviando' e retorna SÓ os que este lote pegou. FOR UPDATE SKIP LOCKED impede
  // que dois lotes concorrentes (2 abas / retry) peguem o mesmo alvo → sem DM duplicada.
  const pend = (await sql`
    UPDATE buzinador_alvo SET status = 'enviando', tentado = now()
    WHERE id IN (SELECT id FROM buzinador_alvo WHERE envio_id = ${envioId} AND status = 'pendente' ORDER BY id LIMIT ${tamanho} FOR UPDATE SKIP LOCKED)
    RETURNING id::int AS id, user_id`) as { id: number; user_id: string }[];
  for (const a of pend) {
    const r = await enviarDM(a.user_id, e.mensagem, e.imagem_url, components);
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

async function postarRelatorio(e: { id: number; mensagem: string; canal_report_id: string; criado_por: string | null; enquete_id: number | null }, c: { ok: number; falha: number; total: number }): Promise<boolean> {
  const falhas = (await sql`SELECT user_id, nome FROM buzinador_alvo WHERE envio_id = ${e.id} AND status = 'falha' ORDER BY id`) as { user_id: string; nome: string | null }[];
  const listaFalhas = falhas.map((f) => (f.nome ? `${f.nome} (<@${f.user_id}>)` : `<@${f.user_id}>`)).join(", ");
  // Monta os fields respeitando os limites do embed: <=25 fields E soma total <=6000 chars.
  // push() só adiciona se couber (reserva 1 slot + margem pro aviso de corte); essenciais entram primeiro.
  const titulo = "📢 Buzinador — relatório de entrega";
  const descricao = `> ${e.mensagem.slice(0, 300)}${e.mensagem.length > 300 ? "…" : ""}`;
  const footerText = e.criado_por ? `disparado por ${e.criado_por}` : "";
  let orcamento = 6000 - titulo.length - descricao.length - footerText.length - 120; // margem pro aviso
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  const push = (f: { name: string; value: string; inline?: boolean }) => {
    const custo = f.name.length + f.value.length;
    if (fields.length < 24 && custo <= orcamento) { fields.push(f); orcamento -= custo; return true; }
    return false;
  };

  push({ name: "✅ Receberam", value: String(c.ok), inline: true });
  push({ name: "❌ Falharam (DM fechada)", value: String(c.falha), inline: true });
  push({ name: "👥 Total", value: String(c.total), inline: true });
  if (falhas.length) push({ name: "❌ Não receberam", value: (listaFalhas || "—").slice(0, 1024), inline: false });

  let omitidas = 0;
  if (e.enquete_id != null) {
    const [t, vs] = await Promise.all([tally(e.enquete_id), votos(e.enquete_id)]);
    const totalVotos = t.reduce((s, o) => s + o.votos, 0);
    const idsPorIdx = new Map<number, string[]>();
    for (const v of vs) { const a = idsPorIdx.get(v.idx) ?? []; a.push(`<@${v.user_id}>`); idsPorIdx.set(v.idx, a); }
    push({ name: "🗳️ Votos", value: `${totalVotos}/${c.ok} responderam`, inline: false });
    // "Sem voto" priorizado (entra antes das opções pra não ser cortado)
    const votantes = new Set(vs.map((v) => v.user_id));
    const semVoto = ((await sql`SELECT user_id FROM buzinador_alvo WHERE envio_id = ${e.id} AND status = 'ok'`) as { user_id: string }[]).filter((a) => !votantes.has(a.user_id));
    if (semVoto.length) push({ name: `⬜ Sem voto — ${semVoto.length}`, value: semVoto.map((a) => `<@${a.user_id}>`).join(" ").slice(0, 1024), inline: false });
    for (const o of t) {
      const nome = `${o.emoji ? o.emoji + " " : ""}${o.label} — ${o.votos}`.slice(0, 256);
      if (!push({ name: nome, value: (idsPorIdx.get(o.idx)?.join(" ") || "_(ninguém)_").slice(0, 1024), inline: true })) omitidas++;
    }
  }
  if (omitidas > 0) fields.push({ name: "…", value: `+${omitidas} opção(ões) não exibida(s) (limite do Discord).`, inline: false });

  const embed = {
    title: titulo,
    description: descricao,
    color: COR,
    fields,
    footer: footerText ? { text: footerText } : undefined,
    timestamp: new Date().toISOString(),
  };
  const res = await botFetch(`/channels/${e.canal_report_id}/messages`, { method: "POST", body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }) });
  const reportId = res.ok ? ((await res.json()) as { id: string }).id : null;
  await sql`UPDATE buzinador_envio SET report_message_id = ${reportId} WHERE id = ${e.id}`;
  return res.ok;
}
