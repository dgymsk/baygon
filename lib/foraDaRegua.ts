import { sql } from "@/lib/db";

/**
 * Quem, NAQUELA war, sai das médias sem sair dos números.
 *
 * O caso que criou isto: a staff manda alguém morrer de propósito — segurar, puxar, resetar. Os
 * números da pessoa viram lixo estatístico (tempo morto altíssimo, dano baixo) e a média do core
 * arrasta junto, punindo o grupo inteiro por uma decisão que foi da CHAMADA, não do jogador.
 *
 * O que a marca faz: tira a linha do cálculo da média (core, grupo e guilda — o motivo distorce as
 * três, não só a do core). O que ela NÃO faz: apagar dado. A pessoa continua na tabela, no ranking e
 * no histórico, com uma marca dizendo que está fora da régua e por quê.
 */
export type ForaDaRegua = { nomeFamilia: string; motivo: string | null };

export async function listarForaDaRegua(warId: number): Promise<ForaDaRegua[]> {
  const rows = (await sql`
    SELECT nome_familia, fora_motivo FROM war_player
    WHERE war_id = ${warId} AND fora_da_regua ORDER BY nome_familia`) as { nome_familia: string; fora_motivo: string | null }[];
  return rows.map((r) => ({ nomeFamilia: r.nome_familia, motivo: r.fora_motivo }));
}

/**
 * Liga/desliga a marca. Devolve o estado que ficou gravado — a tela usa isso pra não depender do
 * que ela achava que ia acontecer.
 *
 * `war_player` só tem linha pra quem estava na war quando a estatística foi gravada; marcar alguém
 * que não está lá não cria linha nenhuma (e devolve `ok: false`), porque uma linha de snapshot sem
 * gear nem grupo mentiria pro resto do sistema.
 */
export async function marcarForaDaRegua(warId: number, nomeFamilia: string, fora: boolean, motivo?: unknown):
  Promise<{ ok: boolean; fora: boolean; motivo: string | null }> {
  const m = typeof motivo === "string" ? motivo.trim().slice(0, 120) : "";
  const rows = (await sql`
    UPDATE war_player SET fora_da_regua = ${fora}, fora_motivo = ${fora ? (m || null) : null}
    WHERE war_id = ${warId} AND nome_familia = ${nomeFamilia}
    RETURNING fora_da_regua, fora_motivo`) as { fora_da_regua: boolean; fora_motivo: string | null }[];
  if (!rows[0]) return { ok: false, fora: false, motivo: null };
  return { ok: true, fora: rows[0].fora_da_regua, motivo: rows[0].fora_motivo };
}
