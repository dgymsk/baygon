import { getParticipacaoConfig, postsAtivos, getRespostas } from "@/lib/participacao";
import { TIPOS, type Tipo } from "@/lib/participacaoConfig";
import { listPlayers } from "@/lib/players";
import { chaveNome } from "@/lib/nomes";
import { casarNome } from "@/lib/casarNome";
import { canEditNow } from "@/lib/requireAuth";
import ParticipacaoBoard from "./ParticipacaoBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Participação · BAYGON" };

export type RespVM = { user_id: string; username: string; familia: string | null; resposta: "can" | "cant"; guilda: string | null; atualizado: string };
export type DadosTipo = { post: { message_id: string; channel_id: string; criado: string } | null; respostas: RespVM[] };

export default async function ParticipacaoPage() {
  const [cfg, posts, players, canEdit] = await Promise.all([getParticipacaoConfig(), postsAtivos(), listPlayers(), canEditNow()]);
  const guildaPorChave = new Map(players.map((p) => [chaveNome(p.nome_familia), p.guilda]));
  const playersCands = players.map((p) => ({ chave: chaveNome(p.nome_familia), nome: p.nome_familia }));

  const dados = {} as Record<Tipo, DadosTipo>;
  for (const tipo of TIPOS) {
    const post = posts.find((p) => p.tipo === tipo) ?? null;
    const respostas = post ? await getRespostas(post.message_id) : [];
    dados[tipo] = {
      post: post ? { message_id: post.message_id, channel_id: post.channel_id, criado: post.criado } : null,
      respostas: respostas.map((r) => {
        // resolve nome canônico + guilda aqui (fuzzy), não no caminho quente do clique
        const canon = casarNome(r.familia || r.username, [], playersCands);
        return {
          user_id: r.user_id, username: r.username, familia: canon, resposta: r.resposta,
          guilda: guildaPorChave.get(chaveNome(canon)) ?? null, atualizado: r.atualizado,
        };
      }),
    };
  }

  return <ParticipacaoBoard cfgInit={cfg} dados={dados} canEdit={canEdit} />;
}
