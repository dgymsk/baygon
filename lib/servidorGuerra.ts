import { sql } from "@/lib/db";
import { ehTipoGuerra } from "@/lib/tiposGuerra";
import { tierOk } from "@/lib/tier";

/**
 * Em QUAL SERVIDOR a guerra acontece — a informação que falta pra alguém abrir o jogo e ir pro
 * lugar certo. Ex.: Nodewar T2 → Ulukita 1 / Calpheon 1.
 *
 * Duas camadas, porque são duas perguntas:
 *   PADRÃO   `servidor_guerra (tipo, tier)` — configuração da aliança, quase nunca muda;
 *   OVERRIDE `evento.servidor`              — o desta guerra. NULL = usa o padrão.
 *
 * A resolução tem TRÊS degraus: override → padrão de (tipo, tier exato) → padrão de (tipo, sem
 * tier). O terceiro existe pra siege e rosas, que não têm tier: gravam com tier '' e valem pra
 * qualquer guerra daquele tipo.
 *
 * Resolvido na LEITURA, e não copiado pro evento na criação: corrigir o padrão conserta de uma vez
 * todo evento que não tinha opinião própria, e é a mesma regra de herança de `players.grupo_siege`.
 */
export type ServidorPadrao = { tipo: string; tier: string; servidor: string };

/** O trecho de SQL da resolução, pra quem já tem `evento e` no FROM e não quer uma query a mais. */
export async function servidorDoEvento(eventoId: number): Promise<string | null> {
  const rows = (await sql`
    SELECT COALESCE(e.servidor,
             (SELECT s.servidor FROM servidor_guerra s WHERE s.tipo = e.tipo AND s.tier = COALESCE(e.tier,'')),
             (SELECT s.servidor FROM servidor_guerra s WHERE s.tipo = e.tipo AND s.tier = '')
           ) AS servidor
      FROM evento e WHERE e.id = ${eventoId}`) as { servidor: string | null }[];
  return rows[0]?.servidor ?? null;
}

/** O padrão que vale pra um evento, ignorando o override — é o placeholder do campo na tela. */
export async function padraoDoEvento(eventoId: number): Promise<string | null> {
  const rows = (await sql`
    SELECT COALESCE(
             (SELECT s.servidor FROM servidor_guerra s WHERE s.tipo = e.tipo AND s.tier = COALESCE(e.tier,'')),
             (SELECT s.servidor FROM servidor_guerra s WHERE s.tipo = e.tipo AND s.tier = '')
           ) AS servidor
      FROM evento e WHERE e.id = ${eventoId}`) as { servidor: string | null }[];
  return rows[0]?.servidor ?? null;
}

export async function listServidores(): Promise<ServidorPadrao[]> {
  return (await sql`SELECT tipo, tier, servidor FROM servidor_guerra ORDER BY tipo, tier`) as ServidorPadrao[];
}

/**
 * Grava (ou apaga) um padrão. Servidor vazio APAGA a linha em vez de gravar string vazia: "sem
 * padrão configurado" e "o padrão é a string vazia" davam a mesma tela e comportamentos diferentes
 * no COALESCE — vazio venceria o degrau seguinte e mataria a herança do tier.
 */
export async function setServidorPadrao(tipo: unknown, tier: unknown, servidor: unknown): Promise<{ ok: boolean; erro?: string }> {
  if (!ehTipoGuerra(tipo)) return { ok: false, erro: "tipo de guerra inválido" };
  const t = tierOk(tier) ?? "";                     // qualquer coisa fora de T1/T2/T3 vira "sem tier"
  const s = typeof servidor === "string" ? servidor.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  if (!s) {
    await sql`DELETE FROM servidor_guerra WHERE tipo = ${tipo} AND tier = ${t}`;
    return { ok: true };
  }
  await sql`
    INSERT INTO servidor_guerra (tipo, tier, servidor) VALUES (${tipo}, ${t}, ${s})
    ON CONFLICT (tipo, tier) DO UPDATE SET servidor = EXCLUDED.servidor, atualizado = now()`;
  return { ok: true };
}
