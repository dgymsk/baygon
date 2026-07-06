import type { TipoCfg } from "@/lib/participacaoConfig";

/**
 * Monta o payload da mensagem do bot (embed agrupado + botões Can/Cant). PURO — usado
 * na criação (postarMensagem) e no rebuild ao vivo (handler de interação). Staff pré-atribui
 * os membros; cada grupo mostra os atribuídos com status (✅ confirmou / ❌ não / ⬜ sem resposta).
 * Confirmados viram menção <@id> (clicável → perfil), sem pingar (allowed_mentions.parse=[]).
 */
type GrupoE = { id: number; nome: string; emoji: string; limite_max: number | null };
type MembroE = { chave: string; familia: string; grupo_id: number };
type RespE = { user_id: string; chave: string | null; resposta: "can" | "cant" };

const COR = 0x34e06a;

export function montarEmbedGrupos(cfg: TipoCfg, tipo: string, grupos: GrupoE[], membros: MembroE[], respostas: RespE[]) {
  const respPorChave = new Map<string, RespE>();
  for (const r of respostas) if (r.chave) respPorChave.set(r.chave, r);

  const membrosPorGrupo = new Map<number, MembroE[]>();
  for (const m of membros) {
    const arr = membrosPorGrupo.get(m.grupo_id) ?? [];
    arr.push(m);
    membrosPorGrupo.set(m.grupo_id, arr);
  }

  const nomeExib = (m: MembroE): string => {
    const r = respPorChave.get(m.chave);
    return r?.resposta === "can" && r.user_id ? `<@${r.user_id}>` : m.familia; // menção só quem confirmou (temos o id)
  };
  const statusDe = (m: MembroE): string => {
    const r = respPorChave.get(m.chave);
    return r?.resposta === "can" ? "✅" : r?.resposta === "cant" ? "❌" : "⬜";
  };

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  for (const g of grupos) {
    const mem = membrosPorGrupo.get(g.id) ?? [];
    const confirmados = mem.filter((m) => respPorChave.get(m.chave)?.resposta === "can").length;
    const cap = g.limite_max != null ? `/${g.limite_max}` : "";
    const linhas = mem.map((m) => `${statusDe(m)} ${nomeExib(m)}`);
    const pref = g.emoji ? `${g.emoji} ` : "";
    fields.push({ name: `${pref}${g.nome} — ${confirmados}${cap}`.slice(0, 256), value: (linhas.length ? linhas.join("\n") : "_(ninguém atribuído)_").slice(0, 1024) });
  }

  // quem confirmou/recusou sem estar em nenhum grupo
  const chavesAtribuidas = new Set(membros.map((m) => m.chave));
  const semGrupo = (rp: RespE) => !rp.chave || !chavesAtribuidas.has(rp.chave); // atribuídos já aparecem no grupo
  const semGrupoCan = respostas.filter((r) => r.resposta === "can" && semGrupo(r));
  if (semGrupoCan.length) fields.push({ name: `🆕 Sem grupo — ${semGrupoCan.length}`, value: semGrupoCan.map((r) => `<@${r.user_id}>`).join(" ").slice(0, 1024) });
  const cant = respostas.filter((r) => r.resposta === "cant" && semGrupo(r));
  if (cant.length) fields.push({ name: `❌ Não vão (sem grupo) — ${cant.length}`, value: cant.map((r) => `<@${r.user_id}>`).join(" ").slice(0, 1024) });

  const embed = { title: cfg.titulo.slice(0, 256), description: (cfg.mensagem || undefined)?.slice(0, 4000), color: COR, fields: fields.slice(0, 25) };
  const components = [{
    type: 1,
    components: [
      { type: 2, style: 3, label: "Can", custom_id: `part:can:${tipo}` },
      { type: 2, style: 4, label: "Cant", custom_id: `part:cant:${tipo}` },
    ],
  }];
  return { embeds: [embed], components };
}
