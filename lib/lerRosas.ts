/**
 * Lê o print de PARTICIPAÇÃO da Guerra das Rosas via Gemini (visão).
 *
 * É um TERCEIRO formato de print, diferente dos dois que o app já lia:
 *   lib/participar.ts  — janela de guilda, coluna "Guerra" com Participar/Não (intenção);
 *   lib/lerResultado.ts— resultado da node war, 15 colunas casadas por POSIÇÃO (cabeçalho só de ícones);
 *   este aqui          — Nome · Cargo · Abates · Mortes.
 *
 * Existe porque na Rosas o jogo NÃO dá tela de estatística de combate: essa lista é tudo o que se
 * consegue. Por isso ela vale por duas coisas ao mesmo tempo — quem esteve lá (presença) e o pouco
 * de número que há (abates e mortes).
 *
 * Duas âncoras dizem à leitura que ela está na tabela certa, e as duas importam:
 *   a coluna de CARGO ("Membro da Guilda", "Oficial", "Capitão"), que só existe neste print;
 *   e o fato de os dois números serem inteiros pequenos — se vier valor abreviado (635.1k) ou tempo
 *   (09:56), é o print ERRADO, o da node war.
 */
export type RosaRow = { familia: string; abates: number; mortes: number };
export type ImagemEntrada = { mediaType: string; data: string };

const MODEL = process.env.PARTICIPAR_MODEL ?? "gemini-2.5-flash";
const API_KEY = process.env.GEMINI_API_KEY;

type MediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
function normMedia(m: string): MediaType {
  const v = (m || "").toLowerCase();
  if (v.includes("jpeg") || v.includes("jpg")) return "image/jpeg";
  if (v.includes("gif")) return "image/gif";
  if (v.includes("webp")) return "image/webp";
  return "image/png";
}

const PROMPT = `Esta é uma captura de tela da lista de PARTICIPAÇÃO da Guerra das Rosas, do jogo Black Desert Online (BDO). A interface pode estar em PORTUGUÊS ou ESPANHOL.

A tabela tem quatro colunas, nesta ordem da esquerda para a direita:
1. NOME DE FAMÍLIA do jogador (ex.: "GhostFarmer", "BloodAxe", "LinnWatts");
2. CARGO na guilda (ex.: "Membro da Guilda", "Oficial", "Capitão" / "Miembro del Gremio", "Oficial", "Capitán");
3. ABATES — número inteiro;
4. MORTES — número inteiro.

Extraia TODAS as linhas visíveis. Para cada uma:
- "familia": o nome de família exatamente como está escrito. Se houver texto entre parênteses (nome do personagem), use só o que está ANTES do parêntese.
- "abates": o número da TERCEIRA coluna, como inteiro.
- "mortes": o número da QUARTA coluna, como inteiro.

REGRAS IMPORTANTES:
- Zero é um valor válido e deve ser extraído como 0. Não pule linhas com 0.
- Não troque a ordem das colunas: abates vem ANTES de mortes.
- Ignore a linha de cabeçalho, se houver.
- Não invente linhas que não estejam na imagem, e não complete a lista.
- Se a imagem NÃO for essa tela (por exemplo, se as colunas tiverem valores como "635.1k" ou "09:56", ou se houver uma coluna "Guerra" com "Participar"), responda com a lista vazia.

Responda SOMENTE com um objeto JSON válido neste formato exato:
{"linhas":[{"familia":"NomeDeFamilia","abates":0,"mortes":0}]}`;

const SCHEMA = {
  type: "object",
  properties: {
    linhas: {
      type: "array",
      items: {
        type: "object",
        properties: { familia: { type: "string" }, abates: { type: "integer" }, mortes: { type: "integer" } },
        required: ["familia", "abates", "mortes"],
      },
    },
  },
  required: ["linhas"],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRANSIENTE = new Set([429, 500, 502, 503, 504]);

export async function lerRosas(img: ImagemEntrada): Promise<RosaRow[]> {
  if (!API_KEY) throw new Error("GEMINI_API_KEY não configurada");

  const reqBody = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: normMedia(img.mediaType), data: img.data } }, { text: PROMPT }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const MAX = 4;
  let res: Response | null = null;
  let ultErro = "";
  for (let attempt = 0; attempt < MAX; attempt++) {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY }, body: reqBody });
    if (res.ok) break;
    ultErro = `${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`;
    if (!TRANSIENTE.has(res.status) || attempt === MAX - 1) throw new Error(`Gemini ${ultErro}`);
    await sleep(600 * 2 ** attempt);
  }
  if (!res) throw new Error(`Gemini ${ultErro}`);

  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const txt = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let obj: { linhas?: unknown };
  try { obj = JSON.parse(txt); } catch { throw new Error("resposta da visão não veio em JSON"); }

  const out: RosaRow[] = [];
  for (const l of Array.isArray(obj.linhas) ? obj.linhas : []) {
    const r = (l ?? {}) as { familia?: unknown; abates?: unknown; mortes?: unknown };
    const familia = typeof r.familia === "string" ? r.familia.replace(/\s+/g, " ").trim() : "";
    if (!familia) continue;
    // negativo e fracionário não existem nessas colunas — sinal de leitura torta, e vira 0 em vez
    // de contaminar a tabela com um número impossível
    const num = (v: unknown) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 0 ? n : 0; };
    out.push({ familia, abates: num(r.abates), mortes: num(r.mortes) });
  }
  return out;
}
