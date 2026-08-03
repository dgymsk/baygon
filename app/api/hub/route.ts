import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireEditor } from "@/lib/requireAuth";
import { criarFuncao, atualizarFuncao, excluirFuncao, ordenarFuncoes, listFuncoes } from "@/lib/funcao";
import { criarParty, atualizarParty, excluirParty, ordenarParties, listParties, setLendario } from "@/lib/party";
import { listPresets, criarPreset, atualizarPreset, excluirPreset, addPlayerFuncao, delPlayerFuncao } from "@/lib/intencaoPreset";
import { postarIntencao, sincronizarMensagem } from "@/lib/intencao";
import { aplicarEscalacao, limparEscalacao, getEscalacao } from "@/lib/escalacao";
import { marcarPresenca, salvarPresenca } from "@/lib/presencaEvento";

// Central do hub: funções, parties, lendários, preset do bot, escalação e presença. Staff.
// Uma rota só porque são todas ações curtas da mesma tela — o `acao` diz qual.

export async function GET() {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  const [funcoes, parties, presets] = await Promise.all([listFuncoes(), listParties(), listPresets()]);
  return NextResponse.json({ funcoes, parties, presets });
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
    case "preset-criar":    return NextResponse.json((await criarPreset(b.nome, b.tipo, b.parties, b.tamanhoMax)) ?? { error: "nome e tipo obrigatórios" });
    case "preset-editar":   await atualizarPreset(b.id, { nome: b.nome, tipo: b.tipo, parties: b.parties, tamanhoMax: b.tamanhoMax }); return NextResponse.json({ presets: await listPresets() });
    case "preset-excluir":  await excluirPreset(b.id); return NextResponse.json({ presets: await listPresets() });
    case "membro-add":      await addPlayerFuncao(b.familia, b.funcaoId); return NextResponse.json({ ok: true });
    case "membro-del":      await delPlayerFuncao(b.familia, b.funcaoId); return NextResponse.json({ ok: true });
    case "postar": {
      const id = Math.trunc(Number(b.id));
      if (!Number.isFinite(id)) return NextResponse.json({ error: "preset inválido" }, { status: 400 });
      const r = await postarIntencao(id);
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.erro }, { status: 400 });
    }

    // --- troca a chamada (preset) que rege o evento: muda como o pool é agrupado ---
    case "preset-do-evento": {
      const mid = typeof b.messageId === "string" ? b.messageId : "";
      const pid = Math.trunc(Number(b.presetId));
      if (!mid || !Number.isFinite(pid)) return NextResponse.json({ error: "dados inválidos" }, { status: 400 });
      await sql`UPDATE intencao_post SET preset_id = ${pid} WHERE message_id = ${mid}`;
      return NextResponse.json({ ok: true });
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
