import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import { classeGarmoth, tipoGarmoth } from "@/lib/garmothClasses";
import { gsDe } from "@/lib/garmothStats";
import { fetchBuilds, resumoBuild } from "@/lib/garmoth";
import { parseGarmothId } from "@/lib/garmothId";
import { CLASSE_NOMES, ALIASES, canonicalClasse, tiposDe } from "@/lib/bdoClasses";
import { botFetch } from "@/lib/discordApi";
import { getDiscordConfig } from "@/lib/discordConfig";

/**
 * Jornada de registro (Discord). Estado temporário entre os passos em registro_jornada; ao finalizar,
 * grava tudo ATOMICAMENTE (player + gear + histórico + registro=true + discord_id + data) e só então
 * aplica os efeitos no Discord (cargo + nick), reportando falhas sem desfazer o dado. Se a gravação
 * do dado falhar, NADA é salvo.
 */

const CTRL = new RegExp("[\\u0000-\\u001f\\u007f]", "g");
const limparNome = (s: string) => s.replace(CTRL, "").replace(/\s+/g, " ").trim().slice(0, 60);

export async function salvarEtapa1(userId: string, familia: string, apelido: string): Promise<void> {
  await sql`INSERT INTO registro_jornada (user_id, familia, apelido, atualizado) VALUES (${userId}, ${limparNome(familia)}, ${limparNome(apelido).slice(0, 32)}, now())
    ON CONFLICT (user_id) DO UPDATE SET familia = EXCLUDED.familia, apelido = EXCLUDED.apelido, atualizado = now()`;
}
async function getEtapa1(userId: string): Promise<{ familia: string; apelido: string } | null> {
  const r = (await sql`SELECT familia, apelido FROM registro_jornada WHERE user_id = ${userId}`) as { familia: string | null; apelido: string | null }[];
  if (!r[0]?.familia || !r[0]?.apelido) return null;
  return { familia: r[0].familia, apelido: r[0].apelido };
}
async function limparEtapa1(userId: string): Promise<void> {
  await sql`DELETE FROM registro_jornada WHERE user_id = ${userId}`;
}

/** Player vinculado a um Discord user (setado no registro). Identidade robusta, independe do nick. */
export async function playerPorDiscord(userId: string): Promise<string | null> {
  const r = (await sql`SELECT nome_familia FROM players WHERE discord_id = ${userId} LIMIT 1`) as { nome_familia: string }[];
  return r[0]?.nome_familia ?? null;
}

/** Nome canônico do player: casa por chaveNome com quem já existe; senão usa o digitado (limpo). */
async function resolvePlayer(familiaTyped: string): Promise<string> {
  const k = chaveNome(familiaTyped);
  const players = (await sql`SELECT nome_familia FROM players`) as { nome_familia: string }[];
  return players.find((p) => chaveNome(p.nome_familia) === k)?.nome_familia ?? limparNome(familiaTyped);
}

/** Classe digitada → nome canônico do app (aceita apelido/caixa diferente). null se não reconhecer. */
function resolverClasse(typed: string): string | null {
  const t = (typed || "").trim();
  if (!t) return null;
  const canon = canonicalClasse(t);
  if (CLASSE_NOMES.includes(canon)) return canon;
  const ci = CLASSE_NOMES.find((c) => c.toLowerCase() === t.toLowerCase());
  if (ci) return ci;
  const ali = Object.entries(ALIASES).find(([k]) => k.toLowerCase() === t.toLowerCase());
  return ali ? ali[1] : null;
}

type GearInput = {
  ap: number; aap: number; dp: number; acc: number | null;
  classeBdo: string; classeTipo: string | null; spec: string | null; // classeTipo = app (Sucessão…); spec = cru do Garmoth (succ/awk)
  garmothId: string | null; charName: string | null; charClass: number | null; level: number | null; dados: unknown | null;
};

/** Grava tudo (atômico) e aplica os efeitos no Discord. Retorna a mensagem pro usuário. */
async function aplicar(userId: string, guildId: string, familiaTyped: string, apelido: string, g: GearInput): Promise<{ ok: boolean; msg: string }> {
  const familia = await resolvePlayer(familiaTyped);

  // GUARD anti-sequestro: se essa família já está vinculada a OUTRA conta Discord, não mexe em nada.
  const dono = (await sql`SELECT discord_id FROM players WHERE nome_familia = ${familia}`) as { discord_id: string | null }[];
  if (dono[0]?.discord_id && dono[0].discord_id !== userId) {
    return { ok: false, msg: "Essa família já está registrada por outra conta. Se for você mesmo, fale com a staff." };
  }

  const gs = gsDe(g.ap, g.aap, g.dp);
  const dadosJson = g.dados ? JSON.stringify(g.dados) : null;

  // 1) DADO — atômico. Se isto falhar, nada foi salvo. Manual (garmothId null) NÃO apaga um link Garmoth existente.
  await sql.transaction([
    sql`UPDATE players SET discord_id = NULL WHERE discord_id = ${userId} AND nome_familia <> ${familia}`, // 1 conta = 1 player
    sql`INSERT INTO players (nome_familia, grupo, guilda, classe_bdo, classe_tipo, registro, discord_id, garmoth_id)
        VALUES (${familia}, 'Indefinido', 'MANI', ${g.classeBdo}, ${g.classeTipo}, TRUE, ${userId}, ${g.garmothId})
        ON CONFLICT (nome_familia) DO UPDATE SET classe_bdo = EXCLUDED.classe_bdo, classe_tipo = EXCLUDED.classe_tipo,
          registro = TRUE, discord_id = EXCLUDED.discord_id, garmoth_id = COALESCE(EXCLUDED.garmoth_id, players.garmoth_id)`,
    sql`INSERT INTO garmoth_build (nome_familia, garmoth_id, fonte, char_name, char_class, spec, level, ap, aap, dp, acc, dados, atualizado)
        VALUES (${familia}, ${g.garmothId}, ${g.garmothId ? "garmoth" : "manual"}, ${g.charName}, ${g.charClass}, ${g.spec}, ${g.level}, ${g.ap}, ${g.aap}, ${g.dp}, ${g.acc}, ${dadosJson}::jsonb, now())
        ON CONFLICT (nome_familia) DO UPDATE SET garmoth_id = COALESCE(EXCLUDED.garmoth_id, garmoth_build.garmoth_id),
          fonte = CASE WHEN COALESCE(EXCLUDED.garmoth_id, garmoth_build.garmoth_id) IS NOT NULL THEN 'garmoth' ELSE 'manual' END,
          char_name = EXCLUDED.char_name, char_class = EXCLUDED.char_class, spec = EXCLUDED.spec, level = EXCLUDED.level,
          ap = EXCLUDED.ap, aap = EXCLUDED.aap, dp = EXCLUDED.dp, acc = EXCLUDED.acc, dados = COALESCE(EXCLUDED.dados, garmoth_build.dados), atualizado = now()`,
    sql`INSERT INTO garmoth_gear_hist (nome_familia, garmoth_id, ap, aap, dp) VALUES (${familia}, ${g.garmothId}, ${g.ap}, ${g.aap}, ${g.dp})`,
  ]);
  await limparEtapa1(userId); // dado já commitado → some com o estado temporário

  // 2) EFEITOS no Discord (best-effort; o dado já está salvo). Falhas/erros viram aviso, não desfazem o dado.
  const cfg = await getDiscordConfig();
  const gid = guildId || cfg.guildId;
  const avisos: string[] = [];
  const tentar = async (fn: () => Promise<Response>, aviso: string) => { try { const r = await fn(); if (!r.ok) avisos.push(aviso); } catch { avisos.push(aviso); } };
  if (cfg.registroRoleId && gid) await tentar(() => botFetch(`/guilds/${gid}/members/${userId}/roles/${cfg.registroRoleId}`, { method: "PUT" }), "não consegui te dar o cargo de registrado");
  else avisos.push("cargo de registrado não configurado (avise a staff)");
  if (gid) {
    const suf = ` [${familia}]`;
    const nick = (apelido.slice(0, Math.max(1, 32 - suf.length)) + suf).slice(0, 32); // reserva o sufixo — nunca corta o colchete
    await tentar(() => botFetch(`/guilds/${gid}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ nick }) }), "não consegui trocar seu nick (peça pra staff)");
  }

  const base = `✅ Registro concluído! Bem-vindo(a), **${apelido} [${familia}]**.\nGS **${gs ?? "—"}** · AP ${g.ap} / AAP ${g.aap} / DP ${g.dp}${g.classeBdo ? ` · ${g.classeBdo}${g.classeTipo ? ` (${g.classeTipo})` : ""}` : ""}`;
  return { ok: true, msg: avisos.length ? `${base}\n⚠ ${avisos.join(" · ")}` : base };
}

/** Passo 2 — via Garmoth (recebe o link da build). */
export async function finalizarGarmoth(userId: string, guildId: string, link: string): Promise<{ ok: boolean; msg: string }> {
  const et = await getEtapa1(userId);
  if (!et) return { ok: false, msg: "Sua sessão de registro expirou. Comece de novo com /register." };
  const id = parseGarmothId(link);
  if (!id) return { ok: false, msg: "Link do Garmoth inválido. Cole a URL da build (garmoth.com/character/…)." };
  let chars;
  try { chars = await fetchBuilds([id]); } catch (e) { return { ok: false, msg: `Não consegui ler a build no Garmoth: ${(e as Error).message}` }; }
  const c = chars.find((x) => x.url === id) ?? chars[0];
  const r = c ? resumoBuild(c) : null;
  if (!r) return { ok: false, msg: "Não achei essa build. Ela está **pública** e é o **boneco de guerra** (1ª opção)?" };
  if (r.ap == null || r.aap == null || r.dp == null) return { ok: false, msg: "A build veio sem AP/AAP/DP. Confirme que a 1ª opção é o seu boneco de guerra." };
  const classe = classeGarmoth(r.char_class);
  if (!classe) return { ok: false, msg: "Não reconheci a classe da build. Selecione a classe correta no Garmoth e tente de novo." };
  const tipo = tipoGarmoth(classe, r.spec);
  return aplicar(userId, guildId, et.familia, et.apelido, {
    ap: r.ap, aap: r.aap, dp: r.dp, acc: r.acc, classeBdo: classe, classeTipo: tipo, spec: r.spec,
    garmothId: id, charName: r.char_name, charClass: r.char_class, level: r.level, dados: r.dados,
  });
}

const numGear = (s: string): number | null => {
  const n = Number(String(s).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n) : null;
};

/** Passo 2 — manual (ap, aap, dp, classe, proficiência succ/awk). */
export async function finalizarManual(userId: string, guildId: string, v: { ap: string; aap: string; dp: string; classe: string; prof: string }): Promise<{ ok: boolean; msg: string }> {
  const et = await getEtapa1(userId);
  if (!et) return { ok: false, msg: "Sua sessão de registro expirou. Comece de novo com /register." };
  const ap = numGear(v.ap), aap = numGear(v.aap), dp = numGear(v.dp);
  if (ap == null || aap == null || dp == null) return { ok: false, msg: "AP, AAP e DP têm que ser números (ex.: 395)." };
  const classe = resolverClasse(v.classe);
  if (!classe) return { ok: false, msg: `Classe "${v.classe}" não reconhecida. Ex.: Domadora, Guerreiro, Ranger…` };
  const profNorm = /^a/i.test(v.prof.trim()) ? "awk" : /^s/i.test(v.prof.trim()) ? "succ" : null;
  const tipo = tipoGarmoth(classe, profNorm);
  if (tipo == null && tiposDe(classe).length > 1) return { ok: false, msg: "Proficiência inválida. Escreva **succ** (Sucessão) ou **awk** (Despertar/Awakening)." };
  return aplicar(userId, guildId, et.familia, et.apelido, {
    ap, aap, dp, acc: null, classeBdo: classe, classeTipo: tipo, spec: profNorm,
    garmothId: null, charName: et.apelido, charClass: null, level: null, dados: null,
  });
}
