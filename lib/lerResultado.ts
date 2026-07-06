/**
 * Lê o print do RESULTADO da Node War do BDO via Claude Opus (visão) e extrai, por
 * membro, o nome de família + o valor CRU de cada métrica (do jeito que aparece na tela:
 * "635.1k", "6.7M", "09:56"). A normalização pra número é feita depois (normalizarValor),
 * de forma determinística e revisável pela staff — a IA só transcreve as células.
 */
import Anthropic from "@anthropic-ai/sdk";
import { METRICAS_RESULTADO } from "./metricasResultado";

export type ImagemEntrada = { mediaType: string; data: string };
export type LinhaResultado = { familia: string; valores: Record<string, string> };
export { METRICAS_RESULTADO };

const MODEL = process.env.RESULTADO_MODEL ?? "claude-opus-4-8";

type MediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
function normMedia(m: string): MediaType {
  const v = (m || "").toLowerCase();
  if (v.includes("jpeg") || v.includes("jpg")) return "image/jpeg";
  if (v.includes("gif")) return "image/gif";
  if (v.includes("webp")) return "image/webp";
  return "image/png";
}

const PROMPT = `Esta é uma captura de tela do RESULTADO de uma Guerra de Nó (Node War) do jogo Black Desert Online. A interface pode estar em PORTUGUÊS ou ESPANHOL. Há uma tabela com uma linha por membro da guilda e várias colunas de estatística.

Para CADA linha (membro), extraia:
- "familia": o nome de FAMÍLIA = o texto ANTES do parêntese na coluna de nome. Ex.: "Fafnir (Fafnyra)" -> "Fafnir". Se não houver parêntese, use o texto todo.
- o VALOR de cada uma das métricas abaixo, casando pela coluna correspondente.

Métricas (use exatamente estas chaves):
${METRICAS_RESULTADO.map((m) => `- ${m.metrica}: ${m.dica}`).join("\n")}

REGRAS IMPORTANTES:
- Transcreva o valor EXATAMENTE como aparece na tela, incluindo sufixos e formato: "635.1k", "6.7M", "1.234", "09:56". NÃO converta nem arredonde.
- Se uma célula estiver vazia, com traço ("-") ou zero em branco, OMITA aquela chave (não invente 0).
- Se você não conseguir identificar uma coluna com segurança, OMITA a chave para todas as linhas (melhor faltar do que errar a coluna).
- Ignore a linha de cabeçalho e linhas de total/rodapé. Não invente membros que não estejam na imagem.

Chame a ferramenta registrar_resultado com todas as linhas.`;

// Ferramenta forçada: garante JSON limpo (sem cercas markdown). Cada métrica = string opcional.
const TOOL: Anthropic.Tool = {
  name: "registrar_resultado",
  description: "Registra as linhas do print de resultado da war.",
  input_schema: {
    type: "object",
    properties: {
      linhas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            familia: { type: "string", description: "nome de família (texto antes do parêntese)" },
            ...Object.fromEntries(METRICAS_RESULTADO.map((m) => [m.metrica, { type: "string", description: m.dica }])),
          },
          required: ["familia"],
        },
      },
    },
    required: ["linhas"],
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRANSIENTE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

/** Extrai as linhas de UM print. Auto-retry em erros transientes da API (429/5xx/overloaded). */
export async function lerResultado(img: ImagemEntrada): Promise<LinhaResultado[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada");
  const client = new Anthropic({ apiKey });

  const MAX = 4;
  let ultErro = "";
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "registrar_resultado" },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: normMedia(img.mediaType), data: img.data } },
            { type: "text", text: PROMPT },
          ],
        }],
      });
      const bloco = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!bloco) throw new Error("a IA não retornou a ferramenta (resultado vazio)");
      const input = bloco.input as { linhas?: unknown };
      const linhas = Array.isArray(input?.linhas) ? (input.linhas as { familia?: unknown; [k: string]: unknown }[]) : [];
      const out: LinhaResultado[] = [];
      for (const l of linhas) {
        const familia = typeof l?.familia === "string" ? l.familia.replace(/\s+/g, " ").trim() : "";
        if (!familia) continue;
        const valores: Record<string, string> = {};
        for (const { metrica } of METRICAS_RESULTADO) {
          const v = l[metrica];
          if (typeof v === "string" && v.trim()) valores[metrica] = v.trim();
          else if (typeof v === "number" && Number.isFinite(v)) valores[metrica] = String(v);
        }
        out.push({ familia, valores });
      }
      return out;
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      ultErro = (e as Error).message || `erro ${status}`;
      const retryavel = TRANSIENTE.has(status) || /overloaded|timeout|ECONNRESET|network/i.test(ultErro);
      if (!retryavel || attempt === MAX - 1) throw new Error(ultErro + (retryavel ? ` (após ${MAX} tentativas)` : ""));
      await sleep(800 * 2 ** attempt);
    }
  }
  throw new Error(ultErro || "falha ao ler o resultado");
}
