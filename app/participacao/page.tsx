import { getParticipacaoConfig, postsAtivos, getRespostas } from "@/lib/participacao";
import { listGrupos, listMembros } from "@/lib/participacaoGrupos";
import { TIPOS, type Tipo } from "@/lib/participacaoConfig";
import { listPlayers } from "@/lib/players";
import { chaveNome } from "@/lib/nomes";
import { casarNome } from "@/lib/casarNome";
import { canEditNow } from "@/lib/requireAuth";
import ParticipacaoBoard from "./ParticipacaoBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Participação · BAYGON" };

export type RespVM = { user_id: string; familia: string; resposta: "can" | "cant" };
export type GrupoVM = { id: number; nome: string; emoji: string; limite_max: number | null };
export type AtribVM = { familia: string; grupo_id: number };
export type DadosTipo = { post: { message_id: string; criado: string } | null; grupos: GrupoVM[]; atrib: AtribVM[]; respostas: RespVM[] };

export default async function ParticipacaoPage() {
  const [cfg, posts, players, gruposAll, membrosAll, canEdit] = await Promise.all([
    getParticipacaoConfig(), postsAtivos(), listPlayers(), listGrupos(), listMembros(), canEditNow(),
  ]);
  const playersCands = players.map((p) => ({ chave: chaveNome(p.nome_familia), nome: p.nome_familia }));
  const playersAtivos = players.filter((p) => p.ativo).map((p) => p.nome_familia).sort((a, b) => a.localeCompare(b));

  const dados = {} as Record<Tipo, DadosTipo>;
  for (const tipo of TIPOS) {
    const post = posts.find((p) => p.tipo === tipo) ?? null;
    const respostasRaw = post ? await getRespostas(post.message_id) : [];
    dados[tipo] = {
      post: post ? { message_id: post.message_id, criado: post.criado } : null,
      grupos: gruposAll.filter((g) => g.tipo === tipo).map((g) => ({ id: g.id, nome: g.nome, emoji: g.emoji, limite_max: g.limite_max })),
      atrib: membrosAll.filter((m) => m.tipo === tipo).map((m) => ({ familia: m.familia, grupo_id: m.grupo_id })),
      respostas: respostasRaw.map((r) => ({ user_id: r.user_id, familia: casarNome(r.familia || r.username, [], playersCands), resposta: r.resposta })),
    };
  }

  return <ParticipacaoBoard cfgInit={cfg} dados={dados} playersAtivos={playersAtivos} canEdit={canEdit} />;
}
