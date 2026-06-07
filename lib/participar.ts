/**
 * Lê print(s) da janela de Guilda do BDO via Claude (visão) e extrai, por membro,
 * a Família e se a coluna "Guerra" está em "Participar". Não há API do BDO — a
 * única forma de trazer esse status pro app é interpretando a imagem.
 */
import Anthropic from "@anthropic-ai/sdk";

export type ParticiparRow = { familia: string; participar: boolean };

// Modelo de visão — trocável por env (claude-opus-4-8 / claude-sonnet-4-6 / claude-haiku-4-5)
// p/ comparar custo vs precisão sem redeploy de código.
const MODEL = process.env.PARTICIPAR_MODEL ?? "claude-sonnet-4-6";
// adaptive thinking só existe em opus 4.6+/4.7/4.8 e sonnet 4.6; haiku 4.5 / sonnet 4.5 dão 400.
const USA_ADAPTIVE = /claude-(opus-4-(6|7|8)|sonnet-4-6)/.test(MODEL);

type MediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
export type ImagemEntrada = { mediaType: string; data: string };

const PROMPT = `Esta é uma captura de tela da janela de GUILDA do jogo Black Desert Online (BDO), em português. Há uma tabela cujas colunas incluem "Família (Personagem)" e "Guerra".

Extraia TODOS os membros visíveis na tabela. Para cada um:
- "familia": o nome de FAMÍLIA = o texto ANTES do parêntese na coluna "Família (Personagem)". Ex.: "Fafnir (Fafnyra)" -> "Fafnir"; "GhostFarmer (Alquemix)" -> "GhostFarmer". Se não houver parêntese, use o texto todo. Linhas em cinza/apagadas também contam.
- "participar": true se a coluna "Guerra" dessa linha mostrar exatamente "Participar"; false se mostrar "Não" (ou qualquer outro valor/vazio).

Ignore a linha de cabeçalho. Não invente membros que não estejam na imagem.

Responda SOMENTE com um objeto JSON válido neste formato exato, sem markdown, sem comentários e sem nenhum texto fora do JSON:
{"membros":[{"familia":"NomeDeFamilia","participar":true}]}`;

function normMedia(m: string): MediaType {
  const v = (m || "").toLowerCase();
  if (v.includes("jpeg") || v.includes("jpg")) return "image/jpeg";
  if (v.includes("gif")) return "image/gif";
  if (v.includes("webp")) return "image/webp";
  return "image/png";
}

/** Extrai a lista de uma única imagem (1 print por chamada — mantém o body pequeno). */
export async function lerParticipar(img: ImagemEntrada): Promise<ParticiparRow[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada");
  const client = new Anthropic({ apiKey });

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // adaptive (quando suportado) mantém o bloco de texto final limpo (só o JSON)
    ...(USA_ADAPTIVE ? { thinking: { type: "adaptive" as const } } : {}),
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: normMedia(img.mediaType), data: img.data } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });

  const bloco = res.content.find((b) => b.type === "text");
  const texto = bloco && bloco.type === "text" ? bloco.text : "";
  const limpo = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
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
