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

const fmtRotulo: Record<string, string> = { inteiro: "número inteiro", abreviado: "número, podendo vir abreviado (ex.: 484.2k, 6.3M)", tempo: "tempo mm:ss" };

const PROMPT = `Esta é uma captura de tela do RESULTADO de uma Guerra de Nó (Node War) do jogo Black Desert Online. Há uma tabela com uma linha por membro da guilda.

O CABEÇALHO É SÓ DE ÍCONES — não há texto nos títulos das colunas. Portanto NÃO tente identificar as colunas por nome: identifique-as por POSIÇÃO. A ordem é sempre a mesma.

Cada linha tem, da esquerda para a direita:
- coluna 1: Nome de Família (texto)
- coluna 2: Classe (ícone, ignore)
- colunas 3 a 17: as 15 métricas abaixo, NESTA ORDEM EXATA:

${METRICAS_RESULTADO.map((m, i) => `${i + 1}. ${m.metrica} — ${m.dica} (${fmtRotulo[m.formato]})`).join("\n")}

COMO CONFERIR O ALINHAMENTO antes de responder:
- As DUAS ÚLTIMAS colunas são as únicas no formato mm:ss (tempo_morto e depois tempo_sobrevivencia). Se as duas últimas que você leu não forem mm:ss, você se deslocou — reconte da direita para a esquerda.
- As TRÊS PRIMEIRAS (kills, mortes, sequencia) são inteiros pequenos, normalmente abaixo de 100.
- As colunas 10 a 13 (canhão e trap) são 0 na maioria das linhas. Isso é NORMAL e não significa que a coluna não existe — conte-as mesmo assim, senão tudo à direita desloca.
- Conte 15 valores por linha, sempre. Se uma linha parecer ter menos, você juntou duas colunas.

REGRAS:
- "familia": o nome de FAMÍLIA = o texto ANTES do parêntese, se houver. Ex.: "Fafnir (Fafnyra)" -> "Fafnir".
- Transcreva o valor EXATAMENTE como aparece na tela, com o sufixo e o formato originais: "484.2k", "6.3M", "13878", "08:00". NÃO converta, não arredonde, não tire o ponto.
- Célula com "0" é um ZERO DE VERDADE: transcreva "0". Só omita a chave se a célula estiver de fato vazia ou com traço ("-").
- Ignore o cabeçalho e qualquer linha de total/rodapé. Não invente membros que não estejam na imagem.

Chame a ferramenta registrar_resultado com todas as linhas.`;

/**
 * Ferramenta forçada: garante JSON limpo (sem cercas markdown).
 *
 * As 15 métricas são exigidas TODAS (`required`), e a descrição de cada uma diz a POSIÇÃO da coluna.
 * Antes só `familia` era obrigatória, então o modelo podia omitir uma coluna que não entendeu — e o
 * resultado era aquela estatística sumir da war inteira sem nenhum aviso. Com todas obrigatórias,
 * omissão vira erro de schema (e retry) em vez de perda silenciosa; célula vazia de verdade se
 * declara com "".
 */
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
            ...Object.fromEntries(METRICAS_RESULTADO.map((m, i) => [m.metrica, {
              type: "string",
              description: `coluna ${i + 1} de 15 (${m.dica}) — valor cru; "0" se for zero, "" se estiver vazia`,
            }])),
          },
          required: ["familia", ...METRICAS_RESULTADO.map((m) => m.metrica)],
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
