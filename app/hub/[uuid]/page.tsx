import { sql } from "@/lib/db";
import { listFuncoes } from "@/lib/funcao";
import { listParties } from "@/lib/party";
import { getPreset, listPresets, listPlayerFuncoes } from "@/lib/intencaoPreset";
import { desempenhoDaWar } from "@/lib/eventos";
import { getMarcas, getRespostasInt } from "@/lib/intencao";
import { getEscalacao } from "@/lib/escalacao";
import { getPresenca } from "@/lib/presencaEvento";
import { faltasPorChave } from "@/lib/faltas";
import { perfilGear, listPlayers } from "@/lib/players";
import { getGuildMeta } from "@/lib/guildConfig";
import { canEditNow } from "@/lib/requireAuth";
import { chaveNome } from "@/lib/nomes";
import EventoBoard, { type JogadorVM, type GrupoVM, type PartyVM } from "./EventoBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Evento · BAYGON" };

export default async function HubEventoPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;

  const rows = (await sql`
    SELECT p.evento_id::int AS evento_id, p.message_id, p.preset_id::int AS preset_id,
           e.uuid, COALESCE(e.titulo, e.tipo) AS titulo, e.tipo, e.data::text AS data, e.status,
           r.resultado, r.war_id::int AS war_id
    FROM intencao_post p JOIN evento e ON e.id = p.evento_id
    LEFT JOIN evento_resultado r ON r.evento_id = e.id
    WHERE e.uuid = ${uuid} ORDER BY p.criado DESC LIMIT 1
  `) as { evento_id: number; message_id: string; preset_id: number | null; uuid: string; titulo: string; tipo: string; data: string; status: string; resultado: string | null; war_id: number | null }[];

  const ev = rows[0];
  if (!ev) {
    return <EventoBoard evento={null} grupos={[]} parties={[]} escalados={[]} canEdit={false} guildas={[]} />;
  }

  const [preset, funcoes, parties, marcas, respostas, escalacao, presenca, faltas, perfil, players, meta, canEdit, presets, statsIniciais, vizinhos] = await Promise.all([
    ev.preset_id ? getPreset(ev.preset_id) : Promise.resolve(null),
    listFuncoes(), listParties(), getMarcas(ev.message_id), getRespostasInt(ev.message_id),
    getEscalacao(ev.evento_id), getPresenca(ev.evento_id), faltasPorChave(), perfilGear(), listPlayers(),
    getGuildMeta(), canEditNow(), listPresets(),
    ev.war_id != null ? desempenhoDaWar(ev.war_id) : Promise.resolve([]), // pré-carrega a tabela de stats
    // vizinhos p/ navegar sem voltar ao hub (mais recente → mais antigo)
    sql`SELECT e.uuid, COALESCE(e.titulo, e.tipo) AS titulo, e.data::text AS data, e.status
        FROM intencao_post p JOIN evento e ON e.id = p.evento_id
        ORDER BY e.data DESC, p.criado DESC LIMIT 40`,
  ]);
  const vizinhosVM = vizinhos as { uuid: string; titulo: string; data: string; status: string }[];

  const fById = new Map(funcoes.map((f) => [f.id, f]));
  const ordemFuncoes = funcoes.map((f) => f.id); // pool agrupa por TODAS as funções do catálogo
  const presencaPorChave = new Map(presenca.map((p) => [p.chave, p.participar]));
  const escalaPorChave = new Map(escalacao.map((e) => [e.chave, e.party_id]));
  // confirmou a ESCALAÇÃO (DM): null = não respondeu, true = aceitou, false = recusou
  const confEscPorChave = new Map(escalacao.map((e) => [e.chave, e.confirmou]));
  // convidado_em separa "ainda não foi chamado" de "chamado e sem responder"
  const convidadoPorChave = new Map(escalacao.map((e) => [e.chave, e.convidado_em]));
  const recusaram = escalacao.filter((e) => e.confirmou === false);
  const lendarioPorChave = new Map(players.map((p) => [chaveNome(p.nome_familia), !!p.lendario]));
  const jogaram = ev.war_id
    ? new Set(((await sql`SELECT DISTINCT nome_familia FROM desempenho WHERE war_id = ${ev.war_id}`) as { nome_familia: string }[]).map((d) => chaveNome(d.nome_familia)))
    : null;

  // gear e nº de wars pro mini-card do hover
  const rowPorChave = new Map(players.map((p) => [chaveNome(p.nome_familia), p]));
  const funcaoPorUser = new Map(marcas.map((m) => [m.user_id, fById.get(m.funcao_id)?.nome ?? null]));

  const vm = (userId: string, familia: string | null, chaveRaw: string | null): JogadorVM => {
    const chave = chaveRaw ?? chaveNome(familia ?? "");
    const p = perfil.get(chave);
    const f = faltas.get(chave);
    const row = rowPorChave.get(chave);
    return {
      chave, familia: familia ?? userId, userId,
      guilda: p?.guilda ?? null, classe: p?.classe ?? null, gs: p?.gs ?? null,
      ap: row?.garmoth?.ap ?? null, aap: row?.garmoth?.aap ?? null, dp: row?.garmoth?.dp ?? null,
      nWars: row?.n_wars ?? null,
      lendario: lendarioPorChave.get(chave) === true,
      confirmouIngame: presencaPorChave.get(chave) === true,
      jogou: jogaram ? jogaram.has(chave) : null,
      escaladoEm: escalaPorChave.get(chave) ?? null,
      confirmouEscalacao: confEscPorChave.get(chave) ?? null,
      convidado: !!convidadoPorChave.get(chave),
      faltas: f && f.avaliados > 0 ? f.sequencia : null,
      diasSemJogar: f && f.avaliados > 0 ? f.diasSemJogar : null,
      diasDesdeFalta: f && f.avaliados > 0 ? f.diasDesdeFalta : null,
      funcaoNome: funcaoPorUser.get(userId) ?? null,
    };
  };

  const respVai = respostas.filter((r) => r.resposta === "vai");
  const porUser = new Map(respVai.map((r) => [r.user_id, vm(r.user_id, r.familia, r.chave)]));

  // pool agrupado por FUNÇÃO — cada pessoa aparece em UMA (a marca é única por rodada)
  const grupos: GrupoVM[] = ordemFuncoes.map((id: number) => {
    const f = fById.get(id);
    const ids = marcas.filter((m) => m.funcao_id === id).map((m) => m.user_id);
    return {
      funcaoId: id, nome: f?.nome ?? `Função ${id}`, emoji: f?.emoji || null,
      jogadores: ids.map((u) => porUser.get(u)).filter((j): j is JogadorVM => !!j),
    };
  });
  // quem disse "vai" sem marcar função nenhuma não se perde
  const semFuncao = respVai.filter((r) => !marcas.some((m) => m.user_id === r.user_id));
  if (semFuncao.length) {
    grupos.push({ funcaoId: null, nome: "Sem função marcada", emoji: null, jogadores: semFuncao.map((r) => porUser.get(r.user_id)!).filter(Boolean) });
  }

  // colunas da escalação = as PTs DO PRESET, na ordem dele (não o catálogo inteiro)
  const pById = new Map(parties.map((x) => [x.id, x]));
  const partiesVM: PartyVM[] = (preset?.parties ?? []).map((v) => pById.get(v.party_id)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({ id: x.id, nome: x.nome, icone: x.icone || null }));
  const escalados = [...porUser.values()].filter((j) => j.escaladoEm != null);

  return (
    <EventoBoard
      evento={{ uuid: ev.uuid, titulo: ev.titulo, tipo: ev.tipo, data: ev.data, status: ev.status, resultado: ev.resultado, temWar: ev.war_id != null, eventoId: ev.evento_id, messageId: ev.message_id, warId: ev.war_id, presetId: ev.preset_id }}
      grupos={grupos} parties={partiesVM} escalados={escalados}
      canEdit={canEdit && ev.status === "aberto"} guildas={meta.guildas}
      recusaram={recusaram.map((e) => e.familia)}
      vizinhos={vizinhosVM} presets={presets.map((p) => ({ id: p.id, nome: p.nome, tipo: p.tipo }))}
      playersNomes={players.map((p) => p.nome_familia)} statsIniciais={statsIniciais}
    />
  );
}
