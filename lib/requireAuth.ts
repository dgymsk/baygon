import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Checagem explícita de sessão nas rotas que mexem em dados (defesa em
 * profundidade — o middleware não deve ser a única camada de autorização).
 * Retorna 401 se não houver sessão; senão null (segue).
 */
export async function requireSession(): Promise<NextResponse | null> {
  const session = await auth();
  return session?.user ? null : NextResponse.json({ error: "não autenticado" }, { status: 401 });
}
