import { sql } from "@/lib/db";
import { listEventos } from "@/lib/eventos";
import { listPts } from "@/lib/participacaoPt";
import { getPreset } from "@/lib/intencaoPreset";
import { getMarcas, getRespostasInt } from "@/lib/intencao";
import { getEscalacao } from "@/lib/escalacao";
import { getPresenca } from "@/lib/presencaEvento";
import { faltasPorChave } from "@/lib/faltas";
import { perfilGear } from "@/lib/players";
import { getGuildMeta } from "@/lib/guildConfig";
import { canEditNow } from "@/lib/requireAuth";
import { chaveNome } from "@/lib/nomes";
import EscalacaoBoard, { type JogadorVM, type PtVM } from "./EscalacaoBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Escalação · BAYGON" };

export default async function EscalacaoPage({ searchParams }: { searchParams: Promise<{ ev?: string }> }) {
  const { ev: evParam } = await searchParams;
  const [eventos, canEdit, meta] = await Promise.all([listEventos({ limit: 30 }), canEditNow(), getGuildMeta()]);

  // só eventos que tiveram chamada de INTENÇÃO (os do bot antigo não entram nesta tela)
  const comPost = (await sql`
    SELECT p.evento_id::int AS evento_id, p.message_id, p.preset_id::int AS preset_id, e.uuid, e.titulo, e.tipo, e.data::text AS data, e.status
    FROM intencao_post p JOIN evento e ON e.id = p.evento_id ORDER BY e.data DESC, p.criado DESC
  `) as { evento_id: number; message_id: string; preset_id: number | null; uuid: string; titulo: string | null; tipo: string; data: string; status: string }[];

  const lista = comPost.map((c) => ({ uuid: c.uuid, titulo: c.titulo ?? c.tipo, tipo: c.tipo, data: c.data, status: c.status }));
  const alvo = (evParam && comPost.find((c) => c.uuid === evParam)) || comPost[0] || null;
  void eventos;

  if (!alvo) {
    return (
      <EscalacaoBoard eventos={lista} eventoUuid={null} eventoId={null} pts={[]} jogadores={[]}
        canEdit={canEdit} guildas={meta.guildas} vazio="Nenhuma chamada de intenção foi postada ainda — poste uma em /intencao." />
    );
  }

  const [preset, cat, marcas, respostas, escalacao, presenca, faltas, perfil] = await Promise.all([
    alvo.preset_id ? getPreset(alvo.preset_id) : Promise.resolve(null),
    listPts(),
    getMarcas(alvo.message_id),
    getRespostasInt(alvo.message_id),
    getEscalacao(alvo.evento_id),
    getPresenca(alvo.evento_id),
    faltasPorChave(),
    perfilGear(),
  ]);

  const ptById = new Map(cat.map((p) => [p.id, p]));
  const ordem = preset?.pts.map((v) => v.pt_id) ?? [...new Set(marcas.map((m) => m.pt_id))];
  const pts: PtVM[] = ordem.map((id) => ({ id, nome: ptById.get(id)?.nome ?? `PT ${id}`, emoji: ptById.get(id)?.emoji || null }));

  const presencaPorChave = new Map(presenca.map((p) => [p.chave, p.participar]));
  const escalaPorChave = new Map(escalacao.map((e) => [e.chave, e.pt_id]));
  const marcasPorUser = new Map<string, number[]>();
  for (const m of marcas) { const a = marcasPorUser.get(m.user_id) ?? []; a.push(m.pt_id); marcasPorUser.set(m.user_id, a); }

  // um card por pessoa que respondeu 'vai' (quem disse ❌ não entra na escalação)
  const jogadores: JogadorVM[] = respostas
    .filter((r) => r.resposta === "vai")
    .map((r) => {
      const chave = r.chave ?? chaveNome(r.familia ?? "");
      const p = perfil.get(chave);
      const f = faltas.get(chave);
      return {
        chave,
        familia: r.familia ?? r.user_id,
        userId: r.user_id,
        guilda: p?.guilda ?? null,
        classe: p?.classe ?? null,
        gs: p?.gs ?? null,
        marcou: marcasPorUser.get(r.user_id) ?? [],
        escaladoEm: escalaPorChave.get(chave) ?? null,
        confirmouIngame: presencaPorChave.get(chave) === true,
        faltas: f && f.avaliados > 0 ? f.sequencia : null, // null = sem histórico avaliável
      };
    })
    .sort((a, b) => a.familia.localeCompare(b.familia));

  return (
    <EscalacaoBoard
      eventos={lista} eventoUuid={alvo.uuid} eventoId={alvo.evento_id} pts={pts} jogadores={jogadores}
      canEdit={canEdit && alvo.status === "aberto"} guildas={meta.guildas}
      travado={alvo.status !== "aberto" ? alvo.status : null}
    />
  );
}
