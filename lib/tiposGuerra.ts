/**
 * Os tipos de guerra do EVENTO (hub, bot de intenção, escalação, estatística).
 *
 * Separado do `TIPOS` de lib/participacaoConfig de propósito: aquele é a config do bot ANTIGO
 * (`participacao_*`), cujo formato no banco é um objeto com exatamente as chaves `nodewar` e
 * `siege`. Acrescentar um tipo lá quebraria a tela /participacao, que itera a lista esperando
 * encontrar config pra cada uma. Aqui a lista é aberta — é onde tipo novo entra.
 *
 * Puro (sem imports de servidor) — usável no client.
 */
export const TIPOS_GUERRA = ["nodewar", "siege", "rosas"] as const;
export type TipoGuerra = (typeof TIPOS_GUERRA)[number];

export const ehTipoGuerra = (t: unknown): t is TipoGuerra =>
  typeof t === "string" && (TIPOS_GUERRA as readonly string[]).includes(t);

/** Coerção dura pra escrever no banco: `wars.tipo` tem CHECK, e lixo derrubaria a gravação. */
export const tipoGuerraOu = (t: unknown, padrao: TipoGuerra = "nodewar"): TipoGuerra =>
  (ehTipoGuerra(t) ? t : padrao);

/**
 * Quantos SERVIDORES aquele formato ocupa. Node war acontece em dois; siege e rosas, em um.
 *
 * Fica no código e não em config porque é regra do jogo, não preferência da aliança — o que muda
 * (e por isso é editável) é a LISTA de servidores, em `servidor_bdo`. Tipo novo declara aqui quantos
 * seletores a tela desenha; sem entrada, cai em 1.
 */
export const SLOTS_SERVIDOR: Record<TipoGuerra, number> = { nodewar: 2, siege: 1, rosas: 1 };
export const slotsDoTipo = (t: string | null | undefined): number =>
  (t && SLOTS_SERVIDOR[t as TipoGuerra]) || 1;

const ROTULO: Record<TipoGuerra, string> = { nodewar: "Node War", siege: "Siege", rosas: "Rosas" };
/** Rótulo pra tela. Tipo desconhecido volta cru em vez de sumir — é como o resto do app já faz. */
export const rotuloGuerra = (t: string | null | undefined): string =>
  (t ? ROTULO[t as TipoGuerra] ?? t : "—");
