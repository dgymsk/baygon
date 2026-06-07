import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Checagens explícitas de sessão/permissão nas rotas que mexem em dados
 * (defesa em profundidade — o middleware não deve ser a única camada).
 */

/** 401 se não houver sessão; senão null. */
export async function requireSession(): Promise<NextResponse | null> {
  const session = await auth();
  return session?.user ? null : NextResponse.json({ error: "não autenticado" }, { status: 401 });
}

/** 401 sem sessão, 403 sem permissão de edição (cargo de staff); senão null. */
export async function requireEditor(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  if ((session as { canEdit?: boolean }).canEdit !== true) {
    return NextResponse.json({ error: "sem permissão de edição (apenas staff)" }, { status: 403 });
  }
  return null;
}

/** Lê do servidor se a sessão atual pode editar (para os Server Components). */
export async function canEditNow(): Promise<boolean> {
  const session = await auth();
  return (session as { canEdit?: boolean })?.canEdit === true;
}
