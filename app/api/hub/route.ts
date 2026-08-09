import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireEditor } from "@/lib/requireAuth";
import { auth } from "@/auth";
import { criarFuncao, atualizarFuncao, excluirFuncao, ordenarFuncoes, listFuncoes } from "@/lib/funcao";
import { criarParty, atualizarParty, excluirParty, ordenarParties, listParties, setLendario, setPartiesDoEvento } from "@/lib/party";
import { listPresets, getPreset, criarPreset, atualizarPreset, excluirPreset, addPlayerFuncao, delPlayerFuncao } from "@/lib/intencaoPreset";
import { criarEventoManual, deletarEvento, resumoExclusao, renomearEvento, editarEvento } from "@/lib/eventos";
import { setServidorPadrao, listServidores } from "@/lib/servidorGuerra";
import { silenciarOrfas } from "@/lib/silenciarEvento";
import { tierOk } from "@/lib/tier";
import { postarIntencao, sincronizarMensagem, fecharIntencao } from "@/lib/intencao";
import { aplicarEscalacao, limparEscalacao, getEscalacao, reordenarParty } from "@/lib/escalacao";
import { marcarPresenca, salvarPresenca } from "@/lib/presencaEvento";
import { criarLoteDM, processarLoteDM } from "@/lib/loteDM";
import { marcarForaDaRegua } from "@/lib/foraDaRegua";
import { publicarLista } from "@/lib/publicarLista";
import { getIntencaoConfig, setIntencaoConfig } from "@/lib/intencaoConfig";
import { listAgendas, criarAgenda, atualizarAgenda, excluirAgenda } from "@/lib/agenda";

// Convocar manda DM uma a uma (2 chamadas ao Discord por pessoa): uma escalação de 50 leva
// dezenas de segundos, e no default da Vercel a rota morreria no meio — com parte das DMs enviadas
// e nenhum relatório. 60s é o teto do plano Hobby.
export const maxDuration = 60;

// Central do hub: funções, parties, lendários, preset do bot, escalação e presença. Staff.
// Uma rota só porque são todas ações curtas da mesma tela — o `acao` diz qual.

export async function GET() {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const [funcoes, parties, presets, canais] = await Promise.all([listFuncoes(), listParties(), listPresets(), getIntencaoConfig()]);
  return NextResponse.json({ funcoes, parties, presets, canais });
}

export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const eid = () => Math.trunc(Number(b.eventoId));
  // quem apertou o botão, pro registro do envio no canal de log — a permissão já foi checada acima
  const quemDisparou = async () => {
    const s = await auth();
    return s?.user?.name ?? s?.user?.email ?? null;
  };
  /** Reflete no Discord o que acabou de mudar. Só EDITA lista já publicada, e nunca derruba a ação:
   *  a gravação no banco é o que importa; a mensagem é espelho. */
  const espelharLista = async () => {
    try { await publicarLista(eid(), { soSePublicada: true }); } catch (e) { console.error("espelho da lista falhou", e); }
  };

  /**
   * Evento ENCERRADO recusa operação — no servidor, não só na tela.
   *
   * A tela some com os botões quando o status não é 'aberto', mas isso é aparência: a rota continua
   * aceitando o POST de uma aba velha, de um retry ou de qualquer cliente. "Trava tudo" só é
   * verdade se a trava estiver aqui.
   *
   * Fora da lista de propósito: renomear, mudar tier, apagar e o próprio reabrir — são as ações de
   * ARRUMAR o registro, e travá-las deixaria um evento encerrado impossível de corrigir.
   */
  const OPERACAO = new Set([
    "escalar", "escalacao-reordenar", "escalacao-limpar", "evento-parties", "evento-tamanho",
    "presenca-manual", "presenca-print", "dm-criar", "dm-processar", "publicar-lista",
    "convocar", "pedir-ingame", "evento-registro", "preset-do-evento", "evento-fechar",
  ]);
  if (OPERACAO.has(String(b.acao ?? "")) && Number.isFinite(eid())) {
    const st = (await sql`SELECT status FROM evento WHERE id = ${eid()}`) as { status: string }[];
    if (st[0] && st[0].status === "finalizado") {
      return NextResponse.json({ error: "evento encerrado — reabra o evento pra voltar a mexer nele" }, { status: 409 });
    }
  }

  switch (String(b.acao ?? "")) {
    // --- funções (o que vira botão no bot) ---
    case "funcao-criar":   return NextResponse.json((await criarFuncao(b.nome, b.emoji)) ?? { error: "nome obrigatório" });
    case "funcao-editar":  await atualizarFuncao(b.id, { nome: b.nome, emoji: b.emoji, roleId: b.roleId }); return NextResponse.json({ funcoes: await listFuncoes() });
    case "funcao-excluir": await excluirFuncao(b.id); return NextResponse.json({ funcoes: await listFuncoes() });
    case "funcao-ordenar": await ordenarFuncoes(b.ids); return NextResponse.json({ funcoes: await listFuncoes() });

    // --- parties in-game (alvo da escalação) ---
    case "party-criar":   return NextResponse.json((await criarParty(b.nome, b.icone)) ?? { error: "nome obrigatório" });
    case "party-editar":  await atualizarParty(b.id, { nome: b.nome, icone: b.icone }); return NextResponse.json({ parties: await listParties() });
    case "party-excluir": await excluirParty(b.id); return NextResponse.json({ parties: await listParties() });
    case "party-ordenar": await ordenarParties(b.ids); return NextResponse.json({ parties: await listParties() });

    // --- lendário: propriedade da pessoa, NUNCA vai pro bot ---
    case "lendario": await setLendario(b.familia, !!b.valor); return NextResponse.json({ ok: true });

    // --- preset do bot ---
    case "preset-criar":    return NextResponse.json((await criarPreset(b.nome, b.tipo, b.parties, b.tamanhoMax, b.tier)) ?? { error: "nome e tipo obrigatórios" });
    case "preset-editar":   await atualizarPreset(b.id, { nome: b.nome, tipo: b.tipo, parties: b.parties, tamanhoMax: b.tamanhoMax, canalId: b.canalId, tier: b.tier, exigeRegistro: b.exigeRegistro, funcoes: b.funcoes }); return NextResponse.json({ presets: await listPresets() });
    case "preset-excluir":  await excluirPreset(b.id); return NextResponse.json({ presets: await listPresets() });
    case "membro-add":      await addPlayerFuncao(b.familia, b.funcaoId); return NextResponse.json({ ok: true });
    case "membro-del":      await delPlayerFuncao(b.familia, b.funcaoId); return NextResponse.json({ ok: true });
    case "postar": {
      const id = Math.trunc(Number(b.id));
      if (!Number.isFinite(id)) return NextResponse.json({ error: "preset inválido" }, { status: 400 });
      const r = await postarIntencao(id, { titulo: typeof b.titulo === "string" ? b.titulo : null, data: typeof b.data === "string" ? b.data : null });
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.erro }, { status: 400 });
    }

    // --- evento criado à mão, sem passar pelo Discord (war marcada por fora, treino, siege) ---
    case "evento-criar": {
      const pid = Math.trunc(Number(b.presetId));
      if (!Number.isFinite(pid)) return NextResponse.json({ error: "escolha a chamada que rege as PTs" }, { status: 400 });
      const preset = await getPreset(pid);
      if (!preset) return NextResponse.json({ error: "chamada não encontrada" }, { status: 400 });
      // sem PT as colunas da escalação não existem: o evento nasceria inescalável e a tela culparia
      // o catálogo de parties, que não tem nada a ver
      if (!preset.parties.length) return NextResponse.json({ error: `"${preset.nome}" não tem PT nenhuma — configure as PTs dela em Definições` }, { status: 400 });
      // tipo vem do preset, não do formulário: pedir os dois deixaria criar siege com preset de nodewar
      const ev = await criarEventoManual({
        tipo: preset.tipo,
        data: typeof b.data === "string" ? b.data : undefined,
        titulo: typeof b.titulo === "string" && b.titulo.trim() ? b.titulo.trim() : preset.nome,
        status: "aberto",   // nasce operável — no hub o evento serve pra escalar, não pra arquivar
        presetId: pid,
        tier: typeof b.tier === "string" && b.tier ? b.tier : preset.tier, // o do formulário manda; senão herda a chamada
      });
      return NextResponse.json({ ok: true, uuid: ev.uuid });
    }

    // --- o que se perde ao apagar: alimenta a confirmação, não apaga nada ---
    case "evento-resumo-exclusao": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      return NextResponse.json(await resumoExclusao(eid()));
    }

    // --- apaga o evento. Irreversível: escalação, convocação e presença vão junto ---
    case "evento-excluir": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      const del = await deletarEvento(eid());
      if (!del.ok) return NextResponse.json({ error: "evento não encontrado" }, { status: 404 });
      // as mensagens do Discord não somem com o evento — calar é parte de apagar
      const restos = await silenciarOrfas(del.orfas);
      return NextResponse.json({ ok: true, restos, warsApagadas: del.warsApagadas, danoApagado: del.danoApagado });
    }

    // --- troca a chamada (preset) que rege o evento: muda como o pool é agrupado ---
    // chaveia por EVENTO, não por mensagem: evento manual não tem mensagem, e o UPDATE por
    // message_id vazio acertava 0 linhas devolvendo 200 — a troca fracassava em silêncio
    case "preset-do-evento": {
      const pid = Math.trunc(Number(b.presetId));
      if (!Number.isFinite(eid()) || !Number.isFinite(pid)) return NextResponse.json({ error: "dados inválidos" }, { status: 400 });
      await sql`UPDATE evento SET preset_id = ${pid} WHERE id = ${eid()}`;
      // espelha no post pra mensagem do Discord continuar sendo remontável (sincronizarMensagem lê de lá)
      await sql`UPDATE intencao_post SET preset_id = ${pid} WHERE evento_id = ${eid()}`;
      return NextResponse.json({ ok: true });
    }

    // --- nome do evento: livre e editável a qualquer momento ---
    case "evento-renomear": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      const r = await renomearEvento(eid(), b.titulo);
      if (!r.ok) return NextResponse.json({ error: "evento não encontrado" }, { status: 404 });
      // a lista publicada leva o nome do evento no título — se já está no canal, acompanha
      await espelharLista();
      return NextResponse.json(r);
    }

    // padrão de servidor por (tipo, tier) — configuração da aliança, vale pros próximos eventos
    case "servidor-padrao": {
      const r = await setServidorPadrao(b.tipo, b.tier, b.servidor);
      if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
      return NextResponse.json({ servidores: await listServidores() });
    }

    /**
     * TIPO, DIA e SERVIDOR do evento. Fora do gate de OPERACAO junto com renomear e a régua: consertar o
     * cabeçalho de uma guerra que já passou é o caso mais comum de edição, e travar isso seria
     * travar o conserto.
     */
    case "evento-editar": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      const r = await editarEvento(eid(), { tipo: b.tipo, data: b.data, servidor: b.servidor });
      if (!r.ok) return NextResponse.json({ error: "evento não encontrado ou nada pra mudar" }, { status: 404 });
      // a lista publicada leva a data no cabeçalho, e o cartão de encerramento leva o tipo
      await espelharLista();
      return NextResponse.json(r);
    }

    // --- PTs DESTE evento. Lista vazia volta a seguir a chamada; mexer aqui não toca no preset,
    // que rege os PRÓXIMOS eventos (era o mesmo objeto, então tirar uma PT reescrevia o passado) ---
    case "evento-parties": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      const ids = await setPartiesDoEvento(eid(), b.ids);
      await espelharLista(); // a lista publicada é desenhada por PT — some/entra coluna, ela acompanha
      return NextResponse.json({ ok: true, ids });
    }

    // --- teto de vagas DESTE evento. Vazio volta a seguir o da chamada ---
    case "evento-tamanho": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      const n = Math.trunc(Number(b.tamanhoMax));
      const val = Number.isFinite(n) && n > 0 ? Math.min(n, 500) : null;
      await sql`UPDATE evento SET tamanho_max = ${val} WHERE id = ${eid()}`;
      await espelharLista(); // o rodapé da lista publicada mostra a meta
      return NextResponse.json({ ok: true, tamanhoMax: val });
    }

    // --- fecha (ou reabre) a intenção: para de aceitar marcação e encurta a mensagem no canal ---
    case "evento-fechar": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      const r = await fecharIntencao(eid(), b.fechar !== false);
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.erro }, { status: 400 });
    }

    /**
     * ENCERRA o evento: trava tudo (escalação, convocação, presença, estatística) mas mantém a
     * página visível pra consulta. É diferente de fechar a INTENÇÃO, que só desliga a marcação no
     * bot e deixa a staff trabalhar — este aqui é o "acabou".
     *
     * `finalizado` é o estado que o resto do app já entende como fim de linha (a tela libera edição
     * só com 'aberto'), então não precisa de vocabulário novo.
     */
    case "evento-encerrar": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      const encerrar = b.encerrar !== false;
      // `finalizado_em` NUNCA é zerado: ele é o carimbo de quando a guerra fechou, e reabrir pra
      // corrigir alguma coisa não desfaz esse fato. Apagá-lo também mentiria pro que lê o histórico.
      const rows = (await sql`
        UPDATE evento
        SET status = ${encerrar ? "finalizado" : "aberto"},
            finalizado_em = CASE WHEN ${encerrar} THEN COALESCE(finalizado_em, now()) ELSE finalizado_em END
        WHERE id = ${eid()} RETURNING status`) as { status: string }[];
      if (!rows[0]) return NextResponse.json({ error: "evento não encontrado" }, { status: 404 });
      // encerrar também fecha a marcação no bot (eventoAberto olha o status), então a mensagem no
      // canal precisa parar de mostrar lista e botões — senão fica prometendo um clique que morreu
      let mensagemAtualizada: boolean | null = null;
      const post = (await sql`SELECT message_id FROM intencao_post WHERE evento_id = ${eid()} ORDER BY criado DESC LIMIT 1`) as { message_id: string }[];
      if (post[0]) {
        try { mensagemAtualizada = (await sincronizarMensagem(post[0].message_id)).ok; }
        catch (e) { console.error("redesenho da chamada falhou", e); mensagemAtualizada = false; }
      }
      // e a LISTA da escalação vira o cartão de resultado (ou volta a ser lista, ao reabrir):
      // `publicarLista` decide pelo status, então os dois sentidos saem do mesmo lugar
      await espelharLista();
      return NextResponse.json({ ok: true, status: rows[0].status, mensagemAtualizada });
    }

    /**
     * FORA DA RÉGUA: o jogador sai das MÉDIAS daquela war sem sair dos números.
     *
     * Não entra na lista de OPERACAO acima de propósito: corrigir a régua de uma guerra passada é
     * exatamente o que se faz depois que ela acabou, e o evento encerrado não pode impedir isso.
     */
    case "war-fora-da-regua": {
      const wid = Math.trunc(Number(b.warId));
      const nome = typeof b.nomeFamilia === "string" ? b.nomeFamilia : "";
      if (!Number.isFinite(wid) || !nome) return NextResponse.json({ error: "war ou jogador inválido" }, { status: 400 });
      const r = await marcarForaDaRegua(wid, nome, b.fora !== false, b.motivo);
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: "jogador não está nesta war" }, { status: 404 });
    }

    // --- trava de registro do evento: só quem fez a jornada do bot pode marcar ---
    case "evento-registro": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      await sql`UPDATE evento SET exige_registro = ${!!b.exige} WHERE id = ${eid()}`;
      return NextResponse.json({ ok: true });
    }

    // --- tier da guerra (T1/T2/T3): o nó que caiu nem sempre é o que estava marcado ---
    case "evento-tier": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      await sql`UPDATE evento SET tier = ${tierOk(b.tier)} WHERE id = ${eid()}`;
      return NextResponse.json({ ok: true });
    }

    // --- agenda de disparo (quem bate no cron é o worker, não o Vercel) ---
    case "agenda-criar":  return NextResponse.json((await criarAgenda(b.presetId, b.dias, b.hora, b.nomePadrao)) ?? { error: "preset, dias e hora são obrigatórios" });
    case "agenda-editar": await atualizarAgenda(b.id, { dias: b.dias, hora: b.hora, ativo: b.ativo, nomePadrao: b.nomePadrao }); return NextResponse.json({ agendas: await listAgendas() });
    case "agenda-excluir": await excluirAgenda(b.id); return NextResponse.json({ agendas: await listAgendas() });

    // --- canais do bot de intenção (chamada e lista) ---
    case "canais": return NextResponse.json(await setIntencaoConfig(b.canais));

    // --- publica/atualiza a lista da escalação no canal dela ---
    case "publicar-lista": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      const r = await publicarLista(eid());
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.erro }, { status: 400 });
    }

    // --- envio de DM em lote (convocação da escalação e cobrança do participar in-game) ---
    // São DUAS ações porque o envio é fatiado: `dm-criar` resolve quem recebe e grava o lote,
    // `dm-processar` manda um punhado por vez. A tela chama a segunda em laço, mostrando o placar —
    // numa requisição só, uma escalação grande estouraria o tempo da função no meio.
    case "dm-criar": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      const tipo = b.tipo === "ingame" ? "ingame" : b.tipo === "intencao" ? "intencao" : "convocacao";
      const c = await criarLoteDM({ tipo, eventoId: eid(), publico: b.publico, porQuem: await quemDisparou() });
      return c.ok ? NextResponse.json(c) : NextResponse.json({ error: c.erro }, { status: 400 });
    }
    case "dm-processar": {
      const lid = Math.trunc(Number(b.loteId));
      if (!Number.isFinite(lid)) return NextResponse.json({ error: "lote inválido" }, { status: 400 });
      const p = await processarLoteDM(lid);
      return p.ok ? NextResponse.json(p) : NextResponse.json({ error: p.erro }, { status: 400 });
    }

    // --- redesenha a mensagem no Discord com o estado atual do banco ---
    case "sync": {
      const mid = typeof b.messageId === "string" ? b.messageId : "";
      if (!mid) return NextResponse.json({ error: "mensagem inválida" }, { status: 400 });
      const s = await sincronizarMensagem(mid);
      return s.ok ? NextResponse.json(s) : NextResponse.json({ error: s.erro }, { status: 400 });
    }

    // --- evento: escalação e presença ---
    case "escalar": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      { const escalacao = await aplicarEscalacao(eid(), b.ops); await espelharLista(); return NextResponse.json({ escalacao }); }
    }
    case "escalacao-reordenar": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      { const escalacao = await reordenarParty(eid(), b.partyId, b.chaves); await espelharLista(); return NextResponse.json({ escalacao }); } // a coroa mudou de pessoa
    }
    case "escalacao-limpar": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      await limparEscalacao(eid());
      await espelharLista();
      return NextResponse.json({ escalacao: await getEscalacao(eid()) });
    }
    case "presenca-manual":
      if (!Number.isFinite(eid()) || typeof b.familia !== "string") return NextResponse.json({ error: "dados inválidos" }, { status: 400 });
      await marcarPresenca(eid(), b.familia, !!b.participar);
      await espelharLista();   // o 🎮 da lista tem que mudar junto
      return NextResponse.json({ ok: true });
    case "presenca-print":
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      { const presenca = await salvarPresenca(eid(), b.membros, "print"); await espelharLista(); return NextResponse.json({ presenca }); }

    default:
      return NextResponse.json({ error: "ação desconhecida" }, { status: 400 });
  }
}
