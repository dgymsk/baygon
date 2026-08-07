import { botFetch } from "@/lib/discordApi";
import { getDiscordConfig } from "@/lib/discordConfig";
import { LIM_TOTAL } from "@/lib/embedLimite";

/**
 * Entrega de DM e o relatório de quem NÃO recebeu.
 *
 * O problema que isto resolve: DM do Discord falha calado. Quem bloqueou o bot, quem desligou
 * "receber mensagens de membros do servidor" ou quem nunca vinculou a conta simplesmente não recebe
 * a convocação — e a staff só descobre na hora da guerra, quando a pessoa não aparece. O número de
 * enviados não conta essa história: o que importa é a LISTA de quem ficou de fora e por quê.
 *
 * Por isso todo envio em lote passa por aqui e vira duas coisas: o retorno pra tela (que mostra os
 * nomes) e um registro no canal de log do Discord, que é permanente e visível pra staff inteira,
 * não só pra quem apertou o botão.
 */
export type FalhaDM = { familia: string; userId: string | null; motivo: string };

/**
 * Traduz o erro do Discord pra algo acionável. `50007` é literalmente "Cannot send messages to this
 * user" — é o bloqueio, e é o caso que a staff precisa distinguir de um erro passageiro.
 */
export async function motivoDaFalha(res: Response, etapa: "abrir" | "enviar"): Promise<string> {
  const corpo = (await res.json().catch(() => null)) as { code?: number; message?: string } | null;
  if (corpo?.code === 50007) return "bloqueou o bot ou não aceita DM de membros do servidor";
  if (res.status === 403) return "DM fechada (privacidade do Discord)";
  if (res.status === 429) return "limite de envio do Discord — tente de novo em alguns minutos";
  if (res.status >= 500) return "Discord fora do ar no momento do envio";
  return `${etapa === "abrir" ? "não deu pra abrir a DM" : "não deu pra enviar"} (Discord ${res.status})`;
}

/** Motivo padrão de quem nem chega a ser tentado. */
export const SEM_DISCORD = "sem Discord vinculado — precisa rodar /register";

/**
 * Traduz motivo GRAVADO por versões antigas ("dm 403", "msg 500"). O texto virou chave de
 * agrupamento nos relatórios, então sem isso um envio antigo aparece com jargão de status HTTP no
 * cabeçalho do grupo, lado a lado com os motivos novos escritos em português.
 */
export function rotuloMotivo(erro: string | null | undefined): string {
  const s = (erro ?? "").trim();
  if (!s) return "motivo não registrado";
  const m = s.match(/^(dm|msg) (\d{3})$/);
  if (!m) return s;
  const st = Number(m[2]);
  if (st === 403) return "DM fechada (privacidade do Discord)";
  if (st === 429) return "limite de envio do Discord";
  if (st >= 500) return "Discord fora do ar no momento do envio";
  return `${m[1] === "dm" ? "não deu pra abrir a DM" : "não deu pra enviar"} (Discord ${st})`;
}

const COR_OK = 0x2f9e44;   // verde: saiu tudo
const COR_AVISO = 0xd6b22a; // amarelo: alguém ficou de fora
const LIM_FIELD = 1024;    // valor de um field do embed

/**
 * Os nomes de um motivo, dentro do teto de um field.
 *
 * Corta por ITEM, nunca por caractere: um `.slice(1024)` cru parte a menção `<@1160…` no meio (o
 * Discord desiste dela e imprime o id) e, pior, some com gente em silêncio enquanto o cabeçalho
 * continua dizendo "— 50". Quem não coube volta como `omitidos` pra virar o aviso do fim.
 *
 * O nome de família vem JUNTO da menção porque é o identificador que a staff usa no roster e na
 * escalação — a menção sozinha renderiza o apelido do Discord, e `@unknown-user` se a pessoa saiu.
 */
function listaDeNomes(quem: FalhaDM[]): { valor: string; omitidos: number } {
  const teto = LIM_FIELD - 40; // folga pro sufixo "… +N"
  const partes: string[] = [];
  let custo = 0;
  for (const q of quem) {
    const s = q.userId ? `${q.familia} (<@${q.userId}>)` : q.familia;
    if (custo + s.length + 2 > teto) break;
    partes.push(s);
    custo += s.length + 2;
  }
  // um único nome absurdo não pode zerar o field: melhor um cortado que nenhum
  if (!partes.length && quem.length) partes.push((quem[0].familia || "?").slice(0, teto));
  const faltam = quem.length - partes.length;
  return { valor: partes.join(", ") + (faltam > 0 ? ` … +${faltam}` : ""), omitidos: Math.max(0, faltam) };
}

/**
 * Posta o relatório do envio no canal de log (discord_config.logChannel, o mesmo das respostas de
 * texto). Devolve se conseguiu postar — a tela avisa quando não, senão o "registrado no log" seria
 * mentira silenciosa.
 *
 * Nunca lança: falhar em REGISTRAR o envio não pode fazer parecer que o ENVIO falhou.
 */
export async function registrarEnvio(o: {
  acao: string;      // "Convocação" / "Pedido de participar in-game"
  evento: string;
  porQuem?: string | null;  // quem apertou o botão
  enviados: number;
  falhas: FalhaDM[];
}): Promise<{ postou: boolean; erro?: string }> {
  try {
    const canal = (await getDiscordConfig()).logChannel;
    if (!canal) return { postou: false, erro: "canal de log não configurado (defina em /discord)" };

    const total = o.enviados + o.falhas.length;
    // agrupa por motivo: "5 pessoas com DM fechada" é mais acionável que cinco linhas iguais
    const porMotivo = new Map<string, FalhaDM[]>();
    for (const f of o.falhas) porMotivo.set(f.motivo, [...(porMotivo.get(f.motivo) ?? []), f]);

    const titulo = `📨 ${o.acao} — ${o.evento}`.slice(0, 256);
    const descricao = o.falhas.length
      ? `**${o.enviados}** de ${total} receberam. **${o.falhas.length} não recebeu(ram)** — abaixo.`
      : `**${o.enviados}** de ${total} receberam. Ninguém ficou de fora.`;
    const rodape = o.porQuem ? `disparado por ${o.porQuem}`.slice(0, 2048) : "";

    // o Discord recusa a mensagem se a SOMA de tudo passar de 6000 (e são no máximo 25 fields).
    // Uma guerra grande com muitos motivos distintos chegaria lá: 20 fields de 1024 são 20k.
    let orcamento = LIM_TOTAL - titulo.length - descricao.length - rodape.length - 120;
    const fields: { name: string; value: string }[] = [];
    let omitidos = 0;
    for (const [motivo, quem] of porMotivo) {
      const name = `⚠ ${motivo} — ${quem.length}`.slice(0, 256);
      const lista = listaDeNomes(quem);
      if (fields.length < 24 && name.length + lista.valor.length <= orcamento) {
        fields.push({ name, value: lista.valor });
        orcamento -= name.length + lista.valor.length;
        omitidos += lista.omitidos;
      } else omitidos += quem.length;
    }
    // silêncio aqui seria pior que o corte: o log passaria a mentir sobre quantos ficaram de fora
    if (omitidos) fields.push({ name: "…", value: `+${omitidos} não exibido(s) (limite do Discord).` });

    const embed = {
      title: titulo,
      description: descricao,
      color: o.falhas.length ? COR_AVISO : COR_OK,
      ...(fields.length ? { fields } : {}),
      ...(rodape ? { footer: { text: rodape } } : {}),
      timestamp: new Date().toISOString(),
    };
    // allowed_mentions vazio: o log É pra citar nomes, mas citar não pode virar ping em massa
    const res = await botFetch(`/channels/${canal}/messages`, {
      method: "POST",
      body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
    });
    return res.ok ? { postou: true } : { postou: false, erro: `Discord ${res.status}` };
  } catch (e) {
    console.error("registrarEnvio falhou", e);
    return { postou: false, erro: (e as Error).message };
  }
}
