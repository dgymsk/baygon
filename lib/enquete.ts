import { sql } from "@/lib/db";
import { resolverEmoji, listarEmojisGuild } from "@/lib/discordApi";

/**
 * Enquete — primitiva GENÉRICA de votação (botões que gravam a escolha), 100% desacoplada
 * de Buzinador e Participação. Uma enquete tem N opções (label + estilo/cor + emoji); um voto
 * liga (enquete, usuário) → opção, com escolha única TROCÁVEL e idempotente (anti-corrida via
 * PK + ON CONFLICT). O clique cai no webhook (custom_id `enq:<enqueteId>:<idx>`); o consumidor
 * (buzinador / confirm-por-DM) reage via lib/enqueteHooks pelo campo `contexto`.
 */
export type EstiloBotao = 1 | 2 | 3 | 4; // 1 azul(primary) | 2 cinza(secondary) | 3 verde(success) | 4 vermelho(danger)
export type OpcaoInput = { label: string; estilo?: EstiloBotao; emoji?: string };
export type EnqueteOpcao = { id: number; idx: number; label: string; estilo: EstiloBotao; emoji: string | null };
export type Enquete = { id: number; titulo: string; contexto: string; ref_id: string | null; status: string; opcoes: EnqueteOpcao[] };
export type OpcaoTally = { opcao_id: number; idx: number; label: string; estilo: EstiloBotao; emoji: string | null; votos: number };
export type VotoDetalhe = { user_id: string; username: string | null; idx: number; label: string; votado: string };

// tipos de component do Discord
type EmojiComp = { name?: string; id?: string; animated?: boolean };
type BotaoComp = { type: 2; style: number; label: string; emoji?: EmojiComp; custom_id: string };
export type ActionRow = { type: 1; components: BotaoComp[] };

const ESTILOS: EstiloBotao[] = [1, 2, 3, 4];
const estiloOk = (n: unknown): EstiloBotao => { const v = Number(n) as EstiloBotao; return ESTILOS.includes(v) ? v : 2; };

/** '<:nome:id>' | '<a:nome:id>' | unicode → objeto emoji do component. undefined se vazio.
 * CORREÇÃO de API: o campo `emoji` de um button NÃO aceita a string '<:nome:id>' (dá 400). */
export function emojiParaComponent(raw: string | null | undefined): EmojiComp | undefined {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  const m = s.match(/^<(a?):(\w+):(\d+)>$/); // emoji custom do servidor
  if (m) return { name: m[2], id: m[3], animated: m[1] === "a" };
  return { name: s }; // unicode (ex.: "✅")
}

/** Cria a enquete: valida 1..25 opções (label<=80, estilo∈{1,2,3,4}), resolve emoji e grava. */
export async function criarEnquete(input: {
  titulo?: string; contexto?: string; ref_id?: string | null; criadoPor?: string | null; opcoes: OpcaoInput[];
}): Promise<{ ok: boolean; enqueteId?: number; erro?: string }> {
  const emojis = await listarEmojisGuild();
  const opcoes: { label: string; estilo: EstiloBotao; emoji: string | null }[] = [];
  for (const o of Array.isArray(input.opcoes) ? input.opcoes : []) {
    const label = String(o?.label ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!label) continue;
    const emoji = o?.emoji ? (resolverEmoji(String(o.emoji), emojis) || null) : null;
    opcoes.push({ label, estilo: estiloOk(o?.estilo), emoji });
    if (opcoes.length >= 25) break;
  }
  if (!opcoes.length) return { ok: false, erro: "precisa de ao menos 1 opção com texto" };

  const titulo = String(input.titulo ?? "").slice(0, 200);
  const contexto = (String(input.contexto ?? "").slice(0, 40)) || "buzinador";
  const refId = input.ref_id != null ? String(input.ref_id).slice(0, 100) : null;
  const criadoPor = input.criadoPor != null ? String(input.criadoPor).slice(0, 80) : null;

  const rows = (await sql`INSERT INTO enquete (titulo, contexto, ref_id, criado_por) VALUES (${titulo}, ${contexto}, ${refId}, ${criadoPor}) RETURNING id::int AS id`) as { id: number }[];
  const enqueteId = rows[0].id;
  try {
    await sql.transaction(opcoes.map((o, i) => sql`INSERT INTO enquete_opcao (enquete_id, idx, label, estilo, emoji) VALUES (${enqueteId}, ${i}, ${o.label}, ${o.estilo}, ${o.emoji})`));
  } catch {
    await sql`DELETE FROM enquete WHERE id = ${enqueteId}`; // não deixa enquete órfã sem opções
    return { ok: false, erro: "falha ao gravar as opções" };
  }
  return { ok: true, enqueteId };
}

export async function getEnquete(id: number): Promise<Enquete | null> {
  const e = (await sql`SELECT id::int AS id, titulo, contexto, ref_id, status FROM enquete WHERE id = ${id}`) as { id: number; titulo: string; contexto: string; ref_id: string | null; status: string }[];
  if (!e[0]) return null;
  const ops = (await sql`SELECT id::int AS id, idx, label, estilo, emoji FROM enquete_opcao WHERE enquete_id = ${id} ORDER BY idx`) as { id: number; idx: number; label: string; estilo: number; emoji: string | null }[];
  return { ...e[0], opcoes: ops.map((o) => ({ id: o.id, idx: Number(o.idx), label: o.label, estilo: estiloOk(o.estilo), emoji: o.emoji })) };
}

/** Registra/troca o voto. Resolve opcao_id por (enquete_id, idx); rejeita se opção sumiu ou enquete fechada. */
export async function registrarVoto(o: { enqueteId: number; userId: string; idx: number; username?: string | null }): Promise<{ ok: boolean; opcaoId?: number; label?: string; erro?: string }> {
  const rows = (await sql`
    SELECT op.id::int AS id, op.label FROM enquete_opcao op JOIN enquete e ON e.id = op.enquete_id
    WHERE op.enquete_id = ${o.enqueteId} AND op.idx = ${o.idx} AND e.status = 'aberta'`) as { id: number; label: string }[];
  const op = rows[0];
  if (!op) return { ok: false, erro: "opção inválida ou votação encerrada" };
  await sql`
    INSERT INTO enquete_voto (enquete_id, user_id, opcao_id, username, votado)
    VALUES (${o.enqueteId}, ${o.userId}, ${op.id}, ${o.username ?? null}, now())
    ON CONFLICT (enquete_id, user_id) DO UPDATE SET opcao_id = EXCLUDED.opcao_id, username = EXCLUDED.username, votado = now()`;
  return { ok: true, opcaoId: op.id, label: op.label };
}

export async function tally(enqueteId: number): Promise<OpcaoTally[]> {
  const r = (await sql`SELECT opcao_id::int AS opcao_id, idx, label, estilo, emoji, votos FROM enquete_tally WHERE enquete_id = ${enqueteId} ORDER BY idx`) as { opcao_id: number; idx: number; label: string; estilo: number; emoji: string | null; votos: number }[];
  return r.map((o) => ({ opcao_id: o.opcao_id, idx: Number(o.idx), label: o.label, estilo: estiloOk(o.estilo), emoji: o.emoji, votos: Number(o.votos) }));
}

export async function votos(enqueteId: number): Promise<VotoDetalhe[]> {
  const r = (await sql`
    SELECT v.user_id, v.username, op.idx, op.label, v.votado::text AS votado
    FROM enquete_voto v JOIN enquete_opcao op ON op.id = v.opcao_id
    WHERE v.enquete_id = ${enqueteId} ORDER BY op.idx, v.votado`) as { user_id: string; username: string | null; idx: number; label: string; votado: string }[];
  return r.map((v) => ({ user_id: v.user_id, username: v.username, idx: Number(v.idx), label: v.label, votado: v.votado }));
}

/** PURO: fatia as opções em action rows de 5 (máx 5 linhas). custom_id `enq:<enqueteId>:<idx>`.
 * marcadoIdx destaca a opção votada (prefixo "▶ ") pro feedback no UPDATE_MESSAGE. */
export function montarComponents(e: Enquete, marcadoIdx?: number | null): ActionRow[] {
  const rows: ActionRow[] = [];
  for (let i = 0; i < e.opcoes.length && rows.length < 5; i += 5) {
    const grupo = e.opcoes.slice(i, i + 5);
    rows.push({
      type: 1,
      components: grupo.map((op) => {
        const btn: BotaoComp = { type: 2, style: op.estilo, label: `${marcadoIdx === op.idx ? "▶ " : ""}${op.label}`.slice(0, 80), custom_id: `enq:${e.id}:${op.idx}` };
        const emoji = emojiParaComponent(op.emoji);
        if (emoji) btn.emoji = emoji;
        return btn;
      }),
    });
  }
  return rows;
}
