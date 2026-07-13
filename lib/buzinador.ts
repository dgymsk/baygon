import { sql } from "@/lib/db";
import { botFetch, botConfigurado } from "@/lib/discordApi";
import { getDiscordConfig } from "@/lib/discordConfig";
import { chaveNome, distancia } from "@/lib/nomes";
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
export type Audiencia = { tipo: "role" | "todos" | "lista" | "nao_registrados"; roleId?: string; userIds?: string };
// botão "Registrar" na DM (abre a jornada de registro no Discord). custom_id tratado em /api/discord/interactions.
const ROW_REGISTRO: ActionRow = { type: 1, components: [{ type: 2, style: 1, label: "📝 Registrar", custom_id: "reg:start" }] } as unknown as ActionRow;
export type Alvo = { userId: string; nome: string | null };
export type Progresso = { enviados: number; falhas: number; pendentes: number; total: number; concluido: boolean; reportOk?: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dig = (s: unknown) => (typeof s === "string" ? s.replace(/[^0-9]/g, "").slice(0, 25) : "");
const urlOk = (s: unknown) => (typeof s === "string" && /^https?:\/\/\S{1,500}$/.test(s.trim()) ? s.trim() : "");
const COR = 0xcc0000; // carmesim (paleta couro/sangue/aço)

/** Melhor casamento por similaridade → userId. Conservador (limite cresce com o tamanho; nomes ≤3 nunca).
 * Empate SÓ conta entre usuários DIFERENTES: se todas as chaves na menor distância são do MESMO user
 * (nick/global/username parecidos), é vencedor claro — não falso-empate. Nunca casa a pessoa errada. */
function melhorUserSimilar(k: string, cand: { chave: string; userId: string }[]): string | null {
  const len = k.length;
  const maxDist = len <= 3 ? 0 : len <= 6 ? 1 : 2;
  if (maxDist === 0) return null;
  let minD = Infinity;
  const atMin = new Set<string>();
  for (const c of cand) {
    if (Math.abs(c.chave.length - len) > maxDist) continue; // poda por tamanho
    const d = distancia(k, c.chave);
    if (d < minD) { minD = d; atMin.clear(); atMin.add(c.userId); }
    else if (d === minD) atMin.add(c.userId);
  }
  if (minD > maxDist) return null;
  return atMin.size === 1 ? [...atMin][0] : null; // um único user na menor distância → casa; senão, ambíguo
}

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
async function resolverAudiencia(a: Audiencia): Promise<{ ok: true; alvos: Alvo[]; naoEncontrados?: string[]; casados?: { de: string; para: string }[] } | { ok: false; erro: string }> {
  if (a?.tipo === "lista") {
    // cada linha: um ID/menção → dispara direto; um nome → casa com o nome no servidor
    // (apelido/global/username), EXATO e por SIMILARIDADE (typos), reusando acharSimilar (conservador).
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
    const casados: { de: string; para: string }[] = [];
    if (nomes.length) {
      let membros: MembroGuild[] | null = null;
      try { membros = await listarMembrosGuild(); } catch { membros = null; }
      if (!membros) return { ok: false, erro: "há nomes na lista, mas não consegui listar os membros pra casar. Use só IDs, ou ative o 'Server Members Intent' no bot." };
      // candidatos por apelido (chave → userId). melhorUserSimilar trata várias chaves do MESMO user
      // como vencedor claro (não falso-empate), então não precisa dedup por userId aqui.
      const idxExato = new Map<string, string>(); // chaveNome(apelido) → userId (primeiro vence)
      const cand: { chave: string; userId: string }[] = [];
      const userToNome = new Map<string, string>();
      for (const m of membros) if (!m.bot) {
        userToNome.set(m.userId, m.nome);
        for (const ap of m.apelidos) { const k = chaveNome(ap); if (!k) continue; if (!idxExato.has(k)) idxExato.set(k, m.userId); cand.push({ chave: k, userId: m.userId }); }
      }
      for (const nm of nomes) {
        const k = chaveNome(nm);
        let userId = idxExato.get(k);
        let fuzzy = false;
        if (!userId) { const uid = melhorUserSimilar(k, cand); if (uid) { userId = uid; fuzzy = true; } }
        if (!userId) { naoEncontrados.push(nm); continue; }
        if (!seen.has(userId)) {
          seen.add(userId);
          const nome = userToNome.get(userId) ?? null;
          alvos.push({ userId, nome });
          if (fuzzy && nome) casados.push({ de: nm, para: nome }); // registra o casamento aproximado p/ conferência
        }
      }
    }
    if (!alvos.length) return { ok: false, erro: `nenhum destinatário resolvido${naoEncontrados.length ? ` — não encontrei: ${naoEncontrados.slice(0, 10).join(", ")}` : ""}` };
    return { ok: true, alvos, naoEncontrados: naoEncontrados.length ? naoEncontrados : undefined, casados: casados.length ? casados : undefined };
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
  if (a?.tipo === "nao_registrados") {
    const rid = dig(a.roleId);
    if (rid) sel = sel.filter((m) => m.roles.includes(rid)); // opcional: só quem tem a "tag de membro" (cargo X)
    const cfg = await getDiscordConfig();
    const reg = (await sql`SELECT discord_id FROM players WHERE registro = TRUE AND discord_id IS NOT NULL`) as { discord_id: string }[];
    const jaFezJornada = new Set(reg.map((r) => r.discord_id));
    // "não registrado" = NÃO tem o cargo de registrado (config /discord) E não concluiu a jornada (banco, por segurança)
    sel = sel.filter((m) => !(cfg.registroRoleId && m.roles.includes(cfg.registroRoleId)) && !jaFezJornada.has(m.userId));
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
export async function criarEnvio(input: { mensagem: unknown; imagemUrl?: unknown; canalReportId: unknown; audiencia: Audiencia; criadoPor?: unknown; opcoes?: OpcaoInput[]; textoLivre?: boolean; contexto?: string; refId?: string | null; botaoRegistro?: boolean }): Promise<{ ok: boolean; envioId?: number; total?: number; naoEncontrados?: string[]; casados?: { de: string; para: string }[]; erro?: string }> {
  if (!botConfigurado()) return { ok: false, erro: "bot não configurado" };
  const mensagem = String(input.mensagem ?? "").trim().slice(0, 1900);
  if (!mensagem) return { ok: false, erro: "mensagem vazia" };
  let canal = dig(input.canalReportId);
  if (!canal) canal = (await getDiscordConfig()).reportChannel; // fallback pro canal padrão da config /discord
  if (!canal) return { ok: false, erro: "canal de relatório não definido (informe no Buzinador ou em /discord)" };
  const imagemUrl = urlOk(input.imagemUrl) || null;
  const criadoPor = (String(input.criadoPor ?? "").trim().slice(0, 80)) || null;

  const res = await resolverAudiencia(input.audiencia ?? ({} as Audiencia));
  if (!res.ok) return { ok: false, erro: res.erro };
  // dedup por userId
  const seen = new Set<string>();
  const alvos = res.alvos.filter((a) => (seen.has(a.userId) ? false : (seen.add(a.userId), true)));

  // enquete opcional (botões de voto e/ou botão de resposta livre). Só cria após a audiência ser válida.
  let enqueteId: number | null = null;
  const opcoes = Array.isArray(input.opcoes) ? input.opcoes.filter((o) => String(o?.label ?? "").trim()) : [];
  const textoLivre = input.textoLivre === true;
  if (opcoes.length || textoLivre) {
    const enq = await criarEnquete({ titulo: mensagem.slice(0, 100), contexto: input.contexto || "buzinador", ref_id: input.refId ?? null, criadoPor, opcoes, textoLivre });
    if (!enq.ok) return { ok: false, erro: enq.erro };
    enqueteId = enq.enqueteId ?? null;
  }

  try {
    const rows = (await sql`
      INSERT INTO buzinador_envio (mensagem, imagem_url, canal_report_id, criado_por, status, total, enquete_id, botao_registro)
      VALUES (${mensagem}, ${imagemUrl}, ${canal}, ${criadoPor}, 'pendente', ${alvos.length}, ${enqueteId}, ${input.botaoRegistro === true})
      RETURNING id::int AS id`) as { id: number }[];
    const envioId = rows[0].id;
    if (alvos.length) {
      await sql.transaction(alvos.map((a) => sql`INSERT INTO buzinador_alvo (envio_id, user_id, nome) VALUES (${envioId}, ${a.userId}, ${a.nome}) ON CONFLICT (envio_id, user_id) DO NOTHING`));
    }
    return { ok: true, envioId, total: alvos.length, naoEncontrados: res.naoEncontrados, casados: res.casados };
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
  const env = (await sql`SELECT id::int AS id, mensagem, imagem_url, canal_report_id, criado_por, status, enquete_id::int AS enquete_id, botao_registro FROM buzinador_envio WHERE id = ${envioId}`) as { id: number; mensagem: string; imagem_url: string | null; canal_report_id: string; criado_por: string | null; status: string; enquete_id: number | null; botao_registro: boolean }[];
  const e = env[0];
  if (!e) return { erro: "envio não encontrado" };
  if (e.status === "concluido") { const c = await contar(envioId); return { enviados: c.ok, falhas: c.falha, pendentes: c.pend, total: c.total, concluido: true }; }
  await sql`UPDATE buzinador_envio SET status = 'enviando' WHERE id = ${envioId} AND status = 'pendente'`;

  // carrega os botões da enquete UMA vez pro lote inteiro (se o envio tiver enquete)
  let components: ActionRow[] | undefined;
  if (e.enquete_id != null) { const enq = await getEnquete(e.enquete_id); if (enq) components = montarComponents(enq); }
  else if (e.botao_registro) components = [ROW_REGISTRO]; // chamada de registro: botão "Registrar" na DM

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

type RelE = { id: number; mensagem: string; criado_por: string | null; enquete_id: number | null };

/** Monta o embed do relatório (entrega + votação), respeitando <=25 fields E soma total <=6000 chars.
 * push() só adiciona se couber (reserva 1 slot + margem pro aviso); essenciais entram primeiro. */
async function montarEmbedRelatorio(e: RelE, c: { ok: number; falha: number; total: number }) {
  const falhas = (await sql`SELECT user_id, nome FROM buzinador_alvo WHERE envio_id = ${e.id} AND status = 'falha' ORDER BY id`) as { user_id: string; nome: string | null }[];
  const listaFalhas = falhas.map((f) => (f.nome ? `${f.nome} (<@${f.user_id}>)` : `<@${f.user_id}>`)).join(", ");
  const titulo = "📢 Buzinador — relatório de entrega";
  const descricao = `> ${e.mensagem.slice(0, 300)}${e.mensagem.length > 300 ? "…" : ""}`;
  const footerText = e.criado_por ? `disparado por ${e.criado_por}` : "";
  let orcamento = 6000 - titulo.length - descricao.length - footerText.length - 120;
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

  return { title: titulo, description: descricao, color: COR, fields, footer: footerText ? { text: footerText } : undefined, timestamp: new Date().toISOString() };
}

async function postarRelatorio(e: RelE & { canal_report_id: string }, c: { ok: number; falha: number; total: number }): Promise<boolean> {
  const embed = await montarEmbedRelatorio(e, c);
  const res = await botFetch(`/channels/${e.canal_report_id}/messages`, { method: "POST", body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }) });
  const reportId = res.ok ? ((await res.json()) as { id: string }).id : null;
  await sql`UPDATE buzinador_envio SET report_message_id = ${reportId} WHERE id = ${e.id}`;
  return res.ok;
}

/** Edita a mensagem do relatório já postada com o tally atual — chamado a cada voto (via hook da enquete).
 * THROTTLE + serialização atômicos: o UPDATE só "ganha" se houver relatório postado E já faz >2s do
 * último update. Assim uma rajada de votos coalesce em ≤1 PATCH/2s por enquete e cliques concorrentes
 * não se atropelam (só um vence a janela) — evita flood de rate-limit e corrida de last-writer.
 * No-op se o relatório ainda não foi postado (os votos aparecem quando ele for postado no fim da entrega). */
export async function atualizarRelatorioPorEnquete(enqueteId: number): Promise<void> {
  const claim = (await sql`
    UPDATE buzinador_envio SET report_atualizado = now()
    WHERE enquete_id = ${enqueteId} AND report_message_id IS NOT NULL
      AND (report_atualizado IS NULL OR report_atualizado < now() - interval '2 seconds')
    RETURNING id::int AS id, mensagem, criado_por, canal_report_id, enquete_id::int AS enquete_id, report_message_id`) as { id: number; mensagem: string; criado_por: string | null; canal_report_id: string; enquete_id: number | null; report_message_id: string | null }[];
  const e = claim[0];
  if (!e || !e.report_message_id) return; // sem relatório postado, ou outro voto já atualizou nos últimos 2s
  const c = await contar(e.id);
  const embed = await montarEmbedRelatorio(e, { ok: c.ok, falha: c.falha, total: c.total });
  const res = await botFetch(`/channels/${e.canal_report_id}/messages/${e.report_message_id}`, { method: "PATCH", body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }) });
  if (!res.ok && (res.status === 404 || res.status === 403)) {
    // mensagem apagada / sem permissão → para de tentar editar a cada voto
    await sql`UPDATE buzinador_envio SET report_message_id = NULL WHERE id = ${e.id}`;
    console.error(`buzinador: relatório ${e.id} PATCH ${res.status} — report_message_id limpo`);
  }
}
