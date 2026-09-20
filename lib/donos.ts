/**
 * DONOS DO APP — quem entra e edita SEMPRE, independente de cargo, de servidor ativo ou do estado
 * da config no banco.
 *
 * É o "quebra-vidro": a permissão normal vem de cargos lidos do Discord no login, contra a config em
 * `discord_config`. Basta a config quebrar (servidor trocado, cargo apagado, banco fora do ar por
 * cota) pra staff inteira — inclusive quem administra o app — ficar trancada do lado de fora, sem
 * ter como consertar a própria config pela tela. O dono passa por cima disso.
 *
 * O id fica NO CÓDIGO de propósito: guardar no banco recriaria a dependência que o bypass existe pra
 * quebrar. O env `DONOS_DISCORD_IDS` (ids separados por vírgula) soma outros sem deploy.
 *
 * Só dígitos entram: snowflake do Discord é numérico, e uma linha vazia ou um espaço no env não
 * podem virar um dono "".
 */
const FIXOS = ["213349841596710913"];

const doEnv = (process.env.DONOS_DISCORD_IDS ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d{5,}$/.test(s));

export const DONOS: ReadonlySet<string> = new Set([...FIXOS, ...doEnv]);

export const ehDono = (discordId: string | null | undefined): boolean => !!discordId && DONOS.has(discordId);
