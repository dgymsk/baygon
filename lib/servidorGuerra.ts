import { sql } from "@/lib/db";
import { ehTipoGuerra, slotsDoTipo } from "@/lib/tiposGuerra";
import { tierOk } from "@/lib/tier";

/**
 * Em QUAIS SERVIDORES a guerra acontece — a informação que falta pra alguém abrir o jogo e ir pro
 * lugar certo. Node war ocupa dois; siege e rosas, um (ver SLOTS_SERVIDOR).
 *
 * TRÊS tabelas, três papéis distintos:
 *   `servidor_bdo`     — o CATÁLOGO. A lista do jogo, editável: a Pearl Abyss abre e fecha servidor,
 *                        e no dia em que mudar quem conserta é a staff, não um deploy.
 *   `servidor_guerra`  — o PADRÃO por (tipo, tier). Configuração da aliança, quase nunca muda.
 *   `evento.servidores`— o OVERRIDE daquela guerra. Vazio = usa o padrão.
 *
 * A resolução tem TRÊS degraus: override → padrão de (tipo, tier exato) → padrão de (tipo, sem
 * tier). O terceiro existe pra siege e rosas, que não têm tier: gravam com tier '' e valem pra
 * qualquer guerra daquele tipo.
 *
 * Resolvido na LEITURA, e não copiado pro evento na criação: corrigir o padrão conserta de uma vez
 * todo evento que não tinha opinião própria — mesma herança de `players.grupo_siege`.
 */
export type ServidorPadrao = { tipo: string; tier: string; servidores: string[] };

/** `NULLIF(...,'{}')` e não COALESCE seco: array vazio é "não opinou", e sem isso ele venceria o
 *  degrau seguinte e apagaria a herança — o mesmo motivo de string vazia apagar o padrão. */
const RESOLVE = (alias: string) => `
  COALESCE(NULLIF(${alias}.servidores, '{}'),
    (SELECT s.servidores FROM servidor_guerra s WHERE s.tipo = ${alias}.tipo AND s.tier = COALESCE(${alias}.tier,'')),
    (SELECT s.servidores FROM servidor_guerra s WHERE s.tipo = ${alias}.tipo AND s.tier = ''),
    '{}')`;

export async function servidoresDoEvento(eventoId: number): Promise<string[]> {
  const rows = (await sql`
    SELECT COALESCE(NULLIF(e.servidores,'{}'),
             (SELECT s.servidores FROM servidor_guerra s WHERE s.tipo = e.tipo AND s.tier = COALESCE(e.tier,'')),
             (SELECT s.servidores FROM servidor_guerra s WHERE s.tipo = e.tipo AND s.tier = ''),
             '{}') AS servidores
      FROM evento e WHERE e.id = ${eventoId}`) as { servidores: string[] }[];
  return rows[0]?.servidores ?? [];
}

/** O padrão que valeria pro evento, ignorando o override — é o que a tela mostra como "seguindo". */
export async function padraoDoEvento(eventoId: number): Promise<string[]> {
  const rows = (await sql`
    SELECT COALESCE(
             (SELECT s.servidores FROM servidor_guerra s WHERE s.tipo = e.tipo AND s.tier = COALESCE(e.tier,'')),
             (SELECT s.servidores FROM servidor_guerra s WHERE s.tipo = e.tipo AND s.tier = ''),
             '{}') AS servidores
      FROM evento e WHERE e.id = ${eventoId}`) as { servidores: string[] }[];
  return rows[0]?.servidores ?? [];
}

/** Como o servidor aparece pra gente: "Ulukita1 / Calpheon1". Vazio some, em vez de virar "—". */
export const textoServidores = (s: string[] | null | undefined): string | null =>
  s && s.length ? s.join(" / ") : null;

// --- CATÁLOGO -------------------------------------------------------------------------------

export async function listServidoresBdo(): Promise<string[]> {
  return ((await sql`SELECT nome FROM servidor_bdo ORDER BY ordem, nome`) as { nome: string }[]).map((r) => r.nome);
}

/**
 * Regrava o catálogo inteiro a partir de uma lista (a ordem é a que veio — é a da tela do jogo).
 *
 * Substituição total em vez de add/remove um a um: a lista é curta, muda de uma vez quando muda, e
 * um textarea é a edição mais honesta pra isso. O DELETE só apaga o que saiu, então servidor que
 * continua na lista não perde a linha — e nada em `servidor_guerra` referencia esta tabela por FK,
 * então tirar um servidor daqui NÃO apaga escolha nenhuma: ele apenas some do seletor, e a escolha
 * antiga continua aparecendo (é histórico, e mentir sobre onde a guerra foi seria pior).
 */
export async function setCatalogoServidores(lista: unknown): Promise<{ ok: boolean; n: number }> {
  const nomes = (Array.isArray(lista) ? lista : [])
    .map((x) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, 60) : ""))
    .filter(Boolean);
  const unicos = [...new Map(nomes.map((n) => [n.toLowerCase(), n])).values()].slice(0, 100);
  await sql.transaction([
    sql`DELETE FROM servidor_bdo WHERE NOT (nome = ANY(${unicos}::text[]))`,
    sql`INSERT INTO servidor_bdo (nome, ordem)
        SELECT n, (ordinality - 1)::int FROM unnest(${unicos}::text[]) WITH ORDINALITY AS t(n, ordinality)
        ON CONFLICT (nome) DO UPDATE SET ordem = EXCLUDED.ordem`,
  ]);
  return { ok: true, n: unicos.length };
}

// --- PADRÃO ---------------------------------------------------------------------------------

export async function listServidores(): Promise<ServidorPadrao[]> {
  return (await sql`SELECT tipo, tier, servidores FROM servidor_guerra ORDER BY tipo, tier`) as ServidorPadrao[];
}

/**
 * Limpa a escolha: tira vazios e repetidos, corta no número de slots do tipo e valida contra o
 * catálogo. O filtro pelo catálogo é o que impede o seletor de virar campo livre por outra porta
 * (aba velha, curl, bug de cliente) e gravar um servidor que não existe.
 */
async function limpar(tipo: string, valores: unknown): Promise<string[]> {
  const brutos = (Array.isArray(valores) ? valores : [])
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
  if (!brutos.length) return [];
  const catalogo = new Set(await listServidoresBdo());
  return [...new Set(brutos.filter((n) => catalogo.has(n)))].slice(0, slotsDoTipo(tipo));
}

/** Padrão de (tipo, tier). Lista vazia APAGA a linha — "não configurado" ≠ "configurado como nada". */
export async function setServidorPadrao(tipo: unknown, tier: unknown, servidores: unknown): Promise<{ ok: boolean; erro?: string }> {
  if (!ehTipoGuerra(tipo)) return { ok: false, erro: "tipo de guerra inválido" };
  const t = tierOk(tier) ?? "";                      // fora de T1/T2/T3 vira "sem tier"
  const s = await limpar(tipo, servidores);
  if (!s.length) {
    await sql`DELETE FROM servidor_guerra WHERE tipo = ${tipo} AND tier = ${t}`;
    return { ok: true };
  }
  await sql`
    INSERT INTO servidor_guerra (tipo, tier, servidores) VALUES (${tipo}, ${t}, ${s}::text[])
    ON CONFLICT (tipo, tier) DO UPDATE SET servidores = EXCLUDED.servidores, atualizado = now()`;
  return { ok: true };
}

/** Override do evento. Lista vazia = volta a seguir o padrão. */
export async function setServidoresDoEvento(eventoId: number, servidores: unknown): Promise<{ ok: boolean; servidores: string[] }> {
  const ev = (await sql`SELECT tipo FROM evento WHERE id = ${eventoId}`) as { tipo: string }[];
  if (!ev[0]) return { ok: false, servidores: [] };
  const s = await limpar(ev[0].tipo, servidores);
  await sql`UPDATE evento SET servidores = ${s}::text[] WHERE id = ${eventoId}`;
  return { ok: true, servidores: s };
}

export { RESOLVE as SQL_RESOLVE_SERVIDORES };
