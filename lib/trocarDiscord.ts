import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import { botConfigurado, botFetch } from "@/lib/discordApi";
import { getDiscordConfig } from "@/lib/discordConfig";

/**
 * TROCAR o Discord de um jogador — a conta mudou, a pessoa não.
 *
 * O caso que cria isto: a conta antiga foi hackeada (ou perdida), a pessoa fez outra e continua
 * com o MESMO nome de família. `players.discord_id` é a identidade que o app usa pra achar a
 * pessoa (/eu, convocação por DM, chamada do bot), e a jornada de registro RECUSA de propósito
 * ligar uma família que já tem dono a outra conta — é a trava anti-sequestro de lib/registro.ts.
 * Sem esta operação a pessoa fica trancada do lado de fora até alguém editar o banco à mão.
 *
 * O que muda: `players.discord_id`; as escalações dela que apontavam pra conta velha (senão a DM
 * da convocação iria pro hacker); e o rascunho de registro das duas contas (o da nova pode ter
 * parado na trava). O que NÃO muda: as respostas antigas (intencao_resp, participacao_resp) — elas
 * registram qual conta clicou, e a estatística é por nome de família, não por conta. Cargos e
 * apelido no Discord também não: isso é do servidor, e a pessoa recebe tudo rodando /register na
 * conta nova, que passa a ser aceito justamente porque o vínculo agora é dela.
 */
export type ContaDiscord = {
  id: string;
  /** @username — o login, único no Discord */
  username: string;
  /** o nome que aparece: apelido no servidor, senão o nome global, senão o username */
  nome: string;
  avatar: string | null;
  /** está no servidor ativo? fora dele não recebe DM nem cargo — a troca vale, mas a tela avisa */
  noServidor: boolean;
  bot: boolean;
};

/** Aceita o ID puro ou a menção `<@123>` — os dois formatos que se copiam do Discord. */
export function parseDiscordId(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  const m = s.match(/^<@!?(\d{15,25})>$/) ?? s.match(/^(\d{15,25})$/);
  return m ? m[1] : null;
}

const avatarUrl = (userId: string, hash: string | null | undefined) =>
  hash ? `https://cdn.discordapp.com/avatars/${userId}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}?size=64` : null;

type MemberJson = { nick?: string | null; user?: { id: string; username?: string; global_name?: string | null; avatar?: string | null; bot?: boolean } };
function contaDeMember(m: MemberJson, noServidor: boolean): ContaDiscord | null {
  const u = m.user;
  if (!u?.id) return null;
  return { id: u.id, username: u.username ?? u.id, nome: m.nick || u.global_name || u.username || u.id, avatar: avatarUrl(u.id, u.avatar), noServidor, bot: !!u.bot };
}

/** Quem é essa conta: pelo servidor ativo (traz o apelido); fora dele, pelo usuário global.
 *  null = conta não existe, ou bot sem token — a troca continua valendo só pelo ID. */
export async function contaDiscord(id: string): Promise<ContaDiscord | null> {
  if (!botConfigurado()) return null;
  const gid = (await getDiscordConfig()).guildId;
  try {
    if (gid) {
      const r = await botFetch(`/guilds/${gid}/members/${id}`);
      if (r.ok) return contaDeMember((await r.json()) as MemberJson, true);
    }
    const r2 = await botFetch(`/users/${id}`);
    if (r2.ok) return contaDeMember({ user: (await r2.json()) as MemberJson["user"] }, false);
  } catch { /* Discord fora do ar: sem nome, mas sem travar a troca */ }
  return null;
}

/** Busca no servidor ativo por COMEÇO de username/apelido (é o que /members/search faz). Sem bots. */
export async function buscarContas(q: string): Promise<ContaDiscord[]> {
  const query = q.trim().replace(/^@/, "").slice(0, 40);
  if (!query || !botConfigurado()) return [];
  const gid = (await getDiscordConfig()).guildId;
  if (!gid) return [];
  try {
    const r = await botFetch(`/guilds/${gid}/members/search?query=${encodeURIComponent(query)}&limit=10`);
    if (!r.ok) return [];
    const arr = (await r.json()) as MemberJson[];
    return arr.map((m) => contaDeMember(m, true)).filter((c): c is ContaDiscord => !!c && !c.bot);
  } catch { return []; }
}

export type VinculoAtual = { id: string | null; conta: ContaDiscord | null; registro: boolean };

/** O vínculo de hoje, com a conta resolvida pelo bot quando dá. null = jogador não existe. */
export async function vinculoAtual(nome: string): Promise<VinculoAtual | null> {
  const r = (await sql`SELECT discord_id, registro FROM players WHERE nome_familia = ${nome}`) as { discord_id: string | null; registro: boolean }[];
  if (!r[0]) return null;
  const id = r[0].discord_id;
  return { id, conta: id ? await contaDiscord(id) : null, registro: r[0].registro };
}

export type ResultadoTroca =
  | { ok: true; nome: string; de: string | null; para: string | null; escalacoesMovidas: number }
  | { ok: false; codigo: "nao_existe" | "id_invalido" | "igual" | "ocupado"; erro: string; dono?: string };

/**
 * Liga `nome` à conta `idBruto` (ID ou menção), ou DESLIGA com `null`.
 *
 * Desligar é o caminho curto quando a pessoa vai se registrar de novo: com o vínculo vazio a
 * jornada aceita a conta nova e ainda aplica cargo + apelido. Ligar direto é pra quando a staff já
 * tem a conta em mãos e quer resolver sem depender da pessoa.
 */
export async function trocarDiscord(nomeBruto: unknown, idBruto: unknown): Promise<ResultadoTroca> {
  const nome = typeof nomeBruto === "string" ? nomeBruto.trim() : "";
  if (!nome) return { ok: false, codigo: "nao_existe", erro: "jogador não informado" };
  const para = idBruto === null ? null : parseDiscordId(idBruto);
  if (idBruto !== null && !para) return { ok: false, codigo: "id_invalido", erro: "ID do Discord inválido — é um número de 17 a 20 dígitos (ou a menção <@…>)" };

  const atual = (await sql`SELECT discord_id FROM players WHERE nome_familia = ${nome}`) as { discord_id: string | null }[];
  if (!atual[0]) return { ok: false, codigo: "nao_existe", erro: `"${nome}" não está no cadastro` };
  const de = atual[0].discord_id;
  if (de === para) return { ok: false, codigo: "igual", erro: para ? "esse já é o Discord vinculado" : "esse jogador já está sem Discord vinculado" };

  if (para) {
    // 1 conta = 1 player (índice ux_players_discord). Não rouba em silêncio: se a conta já é de
    // outro cadastro, a decisão é lá — desvincular o outro, ou fundir, se forem a mesma pessoa.
    const dono = (await sql`SELECT nome_familia FROM players WHERE discord_id = ${para} AND nome_familia <> ${nome}`) as { nome_familia: string }[];
    if (dono[0]) {
      return { ok: false, codigo: "ocupado", dono: dono[0].nome_familia,
        erro: `esse Discord já está vinculado a "${dono[0].nome_familia}". Desvincule lá primeiro — ou, se for a mesma pessoa, funda os dois cadastros.` };
    }
  }

  const chave = chaveNome(nome);
  /**
   * Uma transação. `RETURNING 1` em tudo porque o driver HTTP do Neon não devolve rowCount — sem
   * isso a troca num nome que sumiu entre a leitura e a escrita seria um 200 mudo.
   *
   * A escalação só é tocada quando HAVIA conta velha: as linhas desta pessoa que apontam pra ela
   * passam a apontar pra nova (ou pra NULL ao desvincular — a convocação então recompleta de
   * players.discord_id, como já faz pra quem nunca teve). Linhas sem user_id ficam como estão.
   */
  const stmts = [sql`UPDATE players SET discord_id = ${para} WHERE nome_familia = ${nome} RETURNING 1 AS n`];
  if (de) stmts.push(sql`UPDATE evento_escalacao SET user_id = ${para} WHERE chave = ${chave} AND user_id = ${de} RETURNING 1 AS n`);
  stmts.push(sql`DELETE FROM registro_jornada WHERE user_id = ${de ?? ""} OR user_id = ${para ?? ""} RETURNING 1 AS n`);
  const r = await sql.transaction(stmts);

  if (!(r[0] as unknown[]).length) return { ok: false, codigo: "nao_existe", erro: `"${nome}" sumiu do cadastro durante a troca` };
  return { ok: true, nome, de, para, escalacoesMovidas: de ? (r[1] as unknown[]).length : 0 };
}
