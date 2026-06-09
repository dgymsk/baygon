import { sql } from "@/lib/db";
import { chaveNome, acharSimilar } from "@/lib/nomes";
import { fetchConfirmados } from "@/lib/confirmados";
import { getVagas, nomesDoTexto } from "@/lib/vagas";

export type StatusRow = { familia: string; participar: boolean };
export type Correcao = { de: string; para: string };

/** Reúne os nomes REAIS (roster do bot + espera + reservas + players) p/ corrigir a IA. */
async function candidatosReais(conf: Awaited<ReturnType<typeof fetchConfirmados>>): Promise<{ chave: string; nome: string }[]> {
  const [vagas, players] = await Promise.all([getVagas(), sql`SELECT nome_familia FROM players`]);
  const map = new Map<string, string>();
  const add = (nome: string) => { const k = chaveNome(nome); if (k && !map.has(k)) map.set(k, nome); };
  for (const g of conf.grupos) for (const p of g.players) add(p.nome);
  for (const p of conf.listaEspera) add(p.nome);
  for (const n of nomesDoTexto(vagas.MANI.texto)) add(n);
  for (const n of nomesDoTexto(vagas.RESO.texto)) add(n);
  for (const r of players as { nome_familia: string }[]) add(r.nome_familia);
  return [...map].map(([chave, nome]) => ({ chave, nome }));
}

async function readScan(): Promise<StatusRow[]> {
  return (await sql`SELECT familia, participar FROM participar_scan ORDER BY familia`) as StatusRow[];
}

/**
 * LEITURA PURA (sem escrita — seguro no render do server component). Se o scan
 * persistido é de outra mensagem do bot (war antiga), retorna vazio; a limpeza
 * real do banco acontece no próximo saveStatus (ação de staff), nunca no GET.
 */
export async function getStatus(currentWarKey: string | null): Promise<StatusRow[]> {
  if (!currentWarKey) return readScan();
  const meta = (await sql`SELECT war_key FROM participar_meta WHERE id = 1`) as { war_key: string | null }[];
  const stored = meta[0]?.war_key ?? null;
  if (stored !== currentWarKey) return []; // war nova → scan antigo não conta
  return readScan();
}

/**
 * Acumula os membros lidos (upsert por chave canônica; o mais recente vence).
 * Relê a war ATUAL do bot no servidor (não confia no client, evita corrida com
 * página stale) e, se mudou, limpa o scan antigo antes de gravar — tudo atômico.
 */
export async function saveStatus(membros: unknown): Promise<{ status: StatusRow[]; correcoes: Correcao[] }> {
  const conf = await fetchConfirmados();
  const warKey = conf.ok ? (conf.messageId ?? null) : null;
  const candidatos = await candidatosReais(conf);
  const candChaves = new Set(candidatos.map((c) => c.chave));

  const lista = Array.isArray(membros) ? membros : [];
  const map = new Map<string, { familia: string; participar: boolean }>();
  const correcoes: Correcao[] = [];
  for (const m of lista) {
    const fam = (m as { familia?: unknown })?.familia;
    let familia = typeof fam === "string" ? fam.replace(/\s+/g, " ").trim() : "";
    let k = chaveNome(familia);
    if (!k) continue;
    // se a IA não bate exatamente um nome real, tenta encaixar no mais próximo (1-2 letras)
    if (!candChaves.has(k)) {
      const sim = acharSimilar(k, candidatos);
      if (sim) { correcoes.push({ de: familia, para: sim.nome }); familia = sim.nome; k = chaveNome(sim.nome); }
    }
    map.set(k, { familia, participar: !!(m as { participar?: unknown })?.participar });
  }

  const stmts = [];
  // limpa só na troca de war — guardado pela meta DENTRO da transação (atômico):
  // dois uploads concorrentes na war nova não apagam um ao outro.
  if (warKey) stmts.push(sql`DELETE FROM participar_scan WHERE (SELECT war_key FROM participar_meta WHERE id = 1) IS DISTINCT FROM ${warKey}`);
  // ao trocar de war, pos_liberacao volta a FALSE; na mesma war, preserva o valor
  if (warKey) stmts.push(sql`INSERT INTO participar_meta (id, war_key, pos_liberacao) VALUES (1, ${warKey}, FALSE)
    ON CONFLICT (id) DO UPDATE SET war_key = EXCLUDED.war_key,
      pos_liberacao = CASE WHEN participar_meta.war_key IS DISTINCT FROM EXCLUDED.war_key THEN FALSE ELSE participar_meta.pos_liberacao END`);
  for (const [k, v] of map) {
    stmts.push(sql`INSERT INTO participar_scan (chave, familia, participar, atualizado) VALUES (${k}, ${v.familia}, ${v.participar}, now())
      ON CONFLICT (chave) DO UPDATE SET familia = EXCLUDED.familia, participar = EXCLUDED.participar, atualizado = now()`);
  }
  if (stmts.length) await sql.transaction(stmts);
  return { status: await readScan(), correcoes };
}

export async function resetStatus(): Promise<void> {
  await sql`DELETE FROM participar_scan`;
}

/** LEITURA PURA do toggle "pós-liberação" (20:30). War nova → false. */
export async function getPosLiberacao(currentWarKey: string | null): Promise<boolean> {
  const meta = (await sql`SELECT war_key, pos_liberacao FROM participar_meta WHERE id = 1`) as { war_key: string | null; pos_liberacao: boolean }[];
  const row = meta[0];
  if (!row) return false;
  if (currentWarKey && row.war_key !== currentWarKey) return false; // war nova → reset
  return !!row.pos_liberacao;
}

/** Liga/desliga o "pós-liberação" da war atual (relê a war no servidor; rejeita cliente stale). */
export async function setPosLiberacao(valor: boolean, warKeyCliente?: string | null): Promise<boolean> {
  const conf = await fetchConfirmados();
  const warKey = conf.ok ? (conf.messageId ?? null) : null;
  if (!warKey) return getPosLiberacao(null); // war desconhecida (bot fora) → não escreve
  if (warKeyCliente && warKeyCliente !== warKey) return getPosLiberacao(warKey); // cliente stale

  const stmts = [sql`DELETE FROM participar_scan WHERE (SELECT war_key FROM participar_meta WHERE id = 1) IS DISTINCT FROM ${warKey}`];
  stmts.push(sql`INSERT INTO participar_meta (id, war_key, pos_liberacao) VALUES (1, ${warKey}, ${valor})
    ON CONFLICT (id) DO UPDATE SET war_key = EXCLUDED.war_key, pos_liberacao = EXCLUDED.pos_liberacao`);
  await sql.transaction(stmts);
  return valor;
}
