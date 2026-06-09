/**
 * Lê print(s) da janela de Guilda do BDO via Gemini (Google, visão) e extrai,
 * por membro, a Família e se a coluna "Guerra" está em "Participar". Não há API
 * do BDO — a única forma de trazer esse status pro app é interpretando a imagem.
 */

export type ParticiparRow = { familia: string; participar: boolean };
export type ImagemEntrada = { mediaType: string; data: string };

// Modelo de visão (Google Gemini) — trocável por env. Ex.: gemini-2.5-flash
// (rápido/barato), gemini-2.5-pro (mais preciso em print denso).
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

const PROMPT = `Esta é uma captura de tela da janela de GUILDA do jogo Black Desert Online (BDO). A interface pode estar em PORTUGUÊS ou ESPANHOL. Há uma tabela com uma coluna de família/personagem e uma coluna de guerra:
- coluna de família = "Família (Personagem)" (PT) ou "Familia (Personaje)" (ES);
- coluna de guerra = "Guerra".

Extraia TODOS os membros visíveis na tabela. Para cada um:
- "familia": o nome de FAMÍLIA = o texto ANTES do parêntese na coluna de família. Ex.: "Fafnir (Fafnyra)" -> "Fafnir"; "GhostFarmer (Alquemix)" -> "GhostFarmer". Se não houver parêntese, use o texto todo. Linhas em cinza/apagadas também contam.
- "participar": true se a coluna "Guerra" dessa linha mostrar "Participar" (igual em PT e ES); false se mostrar "Não" (PT) ou "No" (ES) ou qualquer outro valor/vazio.

Ignore a linha de cabeçalho. Não invente membros que não estejam na imagem.

Responda SOMENTE com um objeto JSON válido neste formato exato:
{"membros":[{"familia":"NomeDeFamilia","participar":true}]}`;

// Schema p/ forçar a saída estruturada (responseSchema do Gemini).
const SCHEMA = {
  type: "object",
  properties: {
    membros: {
      type: "array",
      items: {
        type: "object",
        properties: { familia: { type: "string" }, participar: { type: "boolean" } },
        required: ["familia", "participar"],
      },
    },
  },
  required: ["membros"],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRANSIENTE = new Set([429, 500, 502, 503, 504]); // sobrecarga/instabilidade → vale retry

/** Extrai a lista de uma única imagem (1 print por chamada — mantém o body pequeno).
 *  Faz auto-retry em erros transientes do Gemini (503 "UNAVAILABLE", 429, 5xx). */
export async function lerParticipar(img: ImagemEntrada): Promise<ParticiparRow[]> {
  if (!API_KEY) throw new Error("GEMINI_API_KEY não configurada");

  const reqBody = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: normMedia(img.mediaType), data: img.data } }, { text: PROMPT }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const MAX = 4; // 1 tentativa + 3 retries
  let res: Response | null = null;
  let ultErro = "";
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY }, body: reqBody });
    } catch (e) {
      ultErro = `rede: ${(e as Error).message}`;
      res = null;
    }
    if (res?.ok) break;
    if (res) {
      const txt = await res.text().catch(() => "");
      ultErro = `Gemini ${res.status}: ${txt.slice(0, 160) || res.statusText || "sem corpo"}`;
    } // se res === null, ultErro já é "rede: <msg>" (não re-prefixar)
    const status = res?.status ?? 0;
    const retryavel = res === null || TRANSIENTE.has(status);
    if (!retryavel || attempt === MAX - 1) {
      throw new Error(ultErro + (retryavel ? ` (após ${MAX} tentativas)` : ""));
    }
    await sleep(700 * 2 ** attempt); // 0.7s, 1.4s, 2.8s
  }

  const data = (await res!.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  const texto = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  if (!texto) {
    // 200 OK porém sem texto: bloqueio de segurança, MAX_TOKENS ou prompt barrado → mensagem específica
    const motivo = data.candidates?.[0]?.finishReason ?? data.promptFeedback?.blockReason;
    if (motivo === "MAX_TOKENS") throw new Error("print grande/denso demais (resposta truncada) — recorte ou divida a imagem");
    throw new Error(motivo ? `a IA não retornou conteúdo (motivo: ${motivo}) — verifique a imagem` : "a IA não retornou conteúdo");
  }
  const limpo = texto.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  let parsed: { membros?: ParticiparRow[] };
  try {
    parsed = JSON.parse(limpo);
  } catch {
    throw new Error("a IA não retornou JSON válido");
  }
  const out: ParticiparRow[] = [];
  for (const r of parsed.membros ?? []) {
    const familia = typeof r?.familia === "string" ? r.familia.trim() : "";
    if (familia) out.push({ familia, participar: !!r.participar });
  }
  return out;
}
