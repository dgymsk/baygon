import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireEditor } from "@/lib/requireAuth";
import { criarFuncao, atualizarFuncao, excluirFuncao, ordenarFuncoes, listFuncoes } from "@/lib/funcao";
import { criarParty, atualizarParty, excluirParty, ordenarParties, listParties, setLendario } from "@/lib/party";
import { listPresets, getPreset, criarPreset, atualizarPreset, excluirPreset, addPlayerFuncao, delPlayerFuncao } from "@/lib/intencaoPreset";
import { criarEventoManual } from "@/lib/eventos";
import { tierOk } from "@/lib/tier";
import { postarIntencao, sincronizarMensagem } from "@/lib/intencao";
import { aplicarEscalacao, limparEscalacao, getEscalacao } from "@/lib/escalacao";
import { marcarPresenca, salvarPresenca } from "@/lib/presencaEvento";
import { convocar } from "@/lib/convocacao";
import { publicarLista } from "@/lib/publicarLista";
import { getIntencaoConfig, setIntencaoConfig } from "@/lib/intencaoConfig";
import { listAgendas, criarAgenda, atualizarAgenda, excluirAgenda } from "@/lib/agenda";

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

  switch (String(b.acao ?? "")) {
    // --- funções (o que vira botão no bot) ---
    case "funcao-criar":   return NextResponse.json((await criarFuncao(b.nome, b.emoji)) ?? { error: "nome obrigatório" });
    case "funcao-editar":  await atualizarFuncao(b.id, { nome: b.nome, emoji: b.emoji }); return NextResponse.json({ funcoes: await listFuncoes() });
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
    case "preset-editar":   await atualizarPreset(b.id, { nome: b.nome, tipo: b.tipo, parties: b.parties, tamanhoMax: b.tamanhoMax, canalId: b.canalId, tier: b.tier }); return NextResponse.json({ presets: await listPresets() });
    case "preset-excluir":  await excluirPreset(b.id); return NextResponse.json({ presets: await listPresets() });
    case "membro-add":      await addPlayerFuncao(b.familia, b.funcaoId); return NextResponse.json({ ok: true });
    case "membro-del":      await delPlayerFuncao(b.familia, b.funcaoId); return NextResponse.json({ ok: true });
    case "postar": {
      const id = Math.trunc(Number(b.id));
      if (!Number.isFinite(id)) return NextResponse.json({ error: "preset inválido" }, { status: 400 });
      const r = await postarIntencao(id);
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

    // --- tier da guerra (T1/T2/T3): o nó que caiu nem sempre é o que estava marcado ---
    case "evento-tier": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      await sql`UPDATE evento SET tier = ${tierOk(b.tier)} WHERE id = ${eid()}`;
      return NextResponse.json({ ok: true });
    }

    // --- agenda de disparo (quem bate no cron é o worker, não o Vercel) ---
    case "agenda-criar":  return NextResponse.json((await criarAgenda(b.presetId, b.dias, b.hora)) ?? { error: "preset, dias e hora são obrigatórios" });
    case "agenda-editar": await atualizarAgenda(b.id, { dias: b.dias, hora: b.hora, ativo: b.ativo }); return NextResponse.json({ agendas: await listAgendas() });
    case "agenda-excluir": await excluirAgenda(b.id); return NextResponse.json({ agendas: await listAgendas() });

    // --- canais do bot de intenção (chamada e lista) ---
    case "canais": return NextResponse.json(await setIntencaoConfig(b.canais));

    // --- publica/atualiza a lista da escalação no canal dela ---
    case "publicar-lista": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      const r = await publicarLista(eid());
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.erro }, { status: 400 });
    }

    // --- dispara a DM de confirmação da escalação ---
    case "convocar": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      const c = await convocar(eid(), typeof b.titulo === "string" ? b.titulo : "Node War", b.soNovos !== false);
      return c.ok ? NextResponse.json(c) : NextResponse.json({ error: c.erro }, { status: 400 });
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
      return NextResponse.json({ escalacao: await aplicarEscalacao(eid(), b.ops) });
    }
    case "escalacao-limpar": {
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      await limparEscalacao(eid());
      return NextResponse.json({ escalacao: await getEscalacao(eid()) });
    }
    case "presenca-manual":
      if (!Number.isFinite(eid()) || typeof b.familia !== "string") return NextResponse.json({ error: "dados inválidos" }, { status: 400 });
      await marcarPresenca(eid(), b.familia, !!b.participar);
      return NextResponse.json({ ok: true });
    case "presenca-print":
      if (!Number.isFinite(eid())) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
      return NextResponse.json({ presenca: await salvarPresenca(eid(), b.membros, "print") });

    default:
      return NextResponse.json({ error: "ação desconhecida" }, { status: 400 });
  }
}
