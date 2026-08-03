import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";

/**
 * "Faz quantas guerras que marca presença e não joga?"
 *
 * São TRÊS estágios distintos, e a diferença entre eles é o que dá sentido ao número:
 *   1. marcou intenção  — clicou numa PT no bot                (intencao_resp / intencao_marca)
 *   2. confirmou in-game — apareceu na tela de participação    (evento_presenca.participar)
 *   3. PRESENÇA OFICIAL  — tem estatística na war              (desempenho, via evento_resultado.war_id)
 *
 * A falta que interessa é 1 sem 3: prometeu e não jogou.
 *
 * ⚠ Só entram na conta eventos com `war_id` — sem as estatísticas gravadas não dá pra saber se a
 * pessoa jogou, e chutar aqui seria pior que não mostrar. Eventos sem war_id são ignorados (não
 * quebram nem inflam a sequência). Enquanto o fluxo de gravar resultado não for usado, todo mundo
 * aparece com `avaliados: 0`, que a tela mostra como "sem histórico".
 */
export type Falta = {
  sequencia: number;  // guerras SEGUIDAS (da mais recente pra trás) em que marcou e não jogou
  marcou: number;     // no período avaliado
  jogou: number;
  confirmou: number;  // confirmou in-game
  avaliados: number;  // eventos com estatística gravada (os únicos que contam)
};

type EventoAval = { evento_id: number; message_id: string; war_id: number | null; data: string };

/**
 * Mapa chaveNome → Falta, olhando os últimos `limite` eventos que tiveram chamada de intenção.
 * Uma consulta por dimensão (não por jogador) — sem N+1.
 */
export async function faltasPorChave(limite = 12): Promise<Map<string, Falta>> {
  const eventos = (await sql`
    SELECT p.evento_id::int AS evento_id, p.message_id, r.war_id::int AS war_id, e.data::text AS data
    FROM intencao_post p
    JOIN evento e ON e.id = p.evento_id
    LEFT JOIN evento_resultado r ON r.evento_id = p.evento_id
    ORDER BY e.data DESC, p.criado DESC
    LIMIT ${limite}`) as EventoAval[];
  if (!eventos.length) return new Map();

  const msgIds = eventos.map((e) => e.message_id);
  const evIds = eventos.map((e) => e.evento_id);
  const warIds = eventos.map((e) => e.war_id).filter((w): w is number => w != null);

  const [marcasRaw, presencasRaw, jogaramRaw] = await Promise.all([
    sql`SELECT message_id, chave FROM intencao_resp WHERE message_id = ANY(${msgIds}) AND resposta = 'vai' AND chave IS NOT NULL`,
    sql`SELECT evento_id::int AS evento_id, chave FROM evento_presenca WHERE evento_id = ANY(${evIds}) AND participar`,
    warIds.length
      ? sql`SELECT DISTINCT war_id::int AS war_id, nome_familia FROM desempenho WHERE war_id = ANY(${warIds})`
      : Promise.resolve([]),
  ]);
  const marcas = marcasRaw as { message_id: string; chave: string }[];
  const presencas = presencasRaw as { evento_id: number; chave: string }[];
  const jogaram = jogaramRaw as { war_id: number; nome_familia: string }[];

  const marcouEm = new Set(marcas.map((m) => `${m.message_id}|${m.chave}`));
  const confirmouEm = new Set(presencas.map((p) => `${p.evento_id}|${p.chave}`));
  const jogouEm = new Set(jogaram.map((d) => `${d.war_id}|${chaveNome(d.nome_familia)}`));

  // todo mundo que apareceu em qualquer estágio do período
  const chaves = new Set<string>([...marcas.map((m) => m.chave), ...presencas.map((p) => p.chave), ...jogaram.map((d) => chaveNome(d.nome_familia))]);

  const out = new Map<string, Falta>();
  for (const chave of chaves) {
    let sequencia = 0, marcou = 0, jogou = 0, confirmou = 0, avaliados = 0;
    let seqViva = true; // a sequência para no primeiro evento em que a pessoa jogou (ou não marcou)
    for (const ev of eventos) {
      const m = marcouEm.has(`${ev.message_id}|${chave}`);
      if (m) marcou++;
      if (confirmouEm.has(`${ev.evento_id}|${chave}`)) confirmou++;
      if (ev.war_id == null) continue; // sem estatística: não dá pra julgar, nem conta nem quebra
      avaliados++;
      const j = jogouEm.has(`${ev.war_id}|${chave}`);
      if (j) jogou++;
      if (seqViva) { if (m && !j) sequencia++; else seqViva = false; }
    }
    out.set(chave, { sequencia, marcou, jogou, confirmou, avaliados });
  }
  return out;
}
