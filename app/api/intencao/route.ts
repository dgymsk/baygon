import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/requireAuth";
import { listPresets, criarPreset, atualizarPreset, excluirPreset, adicionarMembroPt, removerMembroPt } from "@/lib/intencaoPreset";
import { postarIntencao } from "@/lib/intencao";

// Presets do bot de INTENÇÃO + atribuição múltipla de PT + disparo. Staff.
// (O bot antigo continua em /api/participacao/*; nada aqui encosta nele.)

export async function GET() {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  return NextResponse.json({ presets: await listPresets() });
}

export async function POST(req: Request) {
  const unauth = await requireEditor();
  if (unauth) return unauth;
  let body: { acao?: unknown; nome?: unknown; tipo?: unknown; pts?: unknown; id?: unknown; familia?: unknown; ptId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  switch (String(body.acao ?? "")) {
    case "criar": {
      const p = await criarPreset(body.nome, body.tipo, body.pts);
      return p ? NextResponse.json(p) : NextResponse.json({ error: "nome e tipo são obrigatórios" }, { status: 400 });
    }
    case "atualizar":
      await atualizarPreset(body.id, { nome: body.nome, tipo: body.tipo, pts: body.pts });
      return NextResponse.json({ presets: await listPresets() });
    case "excluir":
      await excluirPreset(body.id);
      return NextResponse.json({ presets: await listPresets() });
    case "membro-add":
      await adicionarMembroPt(body.tipo, body.familia, body.ptId);
      return NextResponse.json({ ok: true });
    case "membro-del":
      await removerMembroPt(body.tipo, body.familia, body.ptId);
      return NextResponse.json({ ok: true });
    case "postar": {
      const id = Math.trunc(Number(body.id));
      if (!Number.isFinite(id)) return NextResponse.json({ error: "preset inválido" }, { status: 400 });
      const r = await postarIntencao(id);
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.erro }, { status: 400 });
    }
    default:
      return NextResponse.json({ error: "ação desconhecida" }, { status: 400 });
  }
}
