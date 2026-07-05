/** Chamadas REST autenticadas com o BOT TOKEN (mesmo bot da leitura de confirmados). */
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API = "https://discord.com/api/v10";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const botConfigurado = () => !!BOT_TOKEN;

/** Fetch autenticado honrando Retry-After (429), como em lib/confirmados.ts. */
export async function botFetch(path: string, init: RequestInit = {}, tentativas = 3): Promise<Response> {
  const headers = { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) };
  let res = await fetch(`${API}${path}`, { ...init, headers, cache: "no-store" });
  for (let t = 1; t < tentativas && res.status === 429; t++) {
    const ra = Number(res.headers.get("retry-after")) || 1;
    if (ra > 5) break;
    await sleep(Math.min(ra, 5) * 1000 + 100);
    res = await fetch(`${API}${path}`, { ...init, headers, cache: "no-store" });
  }
  return res;
}
