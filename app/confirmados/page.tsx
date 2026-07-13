import Link from "next/link";
import { fetchConfirmados } from "@/lib/confirmados";
import { getVagas, nomesDoTexto } from "@/lib/vagas";
import { getStatus, getPosLiberacao } from "@/lib/participarStatus";
import { getRemocoes } from "@/lib/remocaoStatus";
import { getPt, getPtConfig } from "@/lib/ptStatus";
import { gruposEfetivos } from "@/lib/substituicoes";
import { canonicalizarNomes } from "@/lib/casarNome";
import { chaveNome } from "@/lib/nomes";
import { sql } from "@/lib/db";
import { canEditNow } from "@/lib/requireAuth";
import { C } from "@/lib/theme";
import RefreshButton from "./RefreshButton";
import ParticiparReconcile from "./ParticiparReconcile";
import VagasEditor from "./VagasEditor";
import SubstituicoesBoard from "./SubstituicoesBoard";
import MontarPtsBoard from "./MontarPtsBoard";
import AutoSync from "./AutoSync";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirmados · BAYGON" };

const GUILD: Record<string, { label: string; icon: string }> = {
  M: { label: "Manicômio", icon: "/guilds/manicomio.png" },
  R: { label: "Resonance", icon: "/guilds/resonance.png" },
};

function fmtData(unix?: number): string {
  if (!unix) return "";
  return new Date(unix * 1000).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export default async function ConfirmadosPage() {
  const [conf, rosterRows, canEdit, vagas] = await Promise.all([
    fetchConfirmados(),
    sql`SELECT nome_familia, pt_preferida, guilda FROM players`,
    canEditNow(),
    getVagas(),
  ]);
  const totalConf = conf.grupos.reduce((s, g) => s + g.players.length, 0);
  const nM = conf.grupos.reduce((s, g) => s + g.players.filter((p) => p.tag === "M").length, 0);
  const nR = totalConf - nM;
  const confirmadosNomes = conf.grupos.flatMap((g) => g.players.map((p) => p.nome));
  const offBotMani = nomesDoTexto(vagas.MANI.texto);
  const offBotReso = nomesDoTexto(vagas.RESO.texto);
  const offBotNomes = [...offBotMani, ...offBotReso];
  const hiddenTotal = vagas.MANI.hidden + vagas.RESO.hidden;
  const warKey = conf.ok ? (conf.messageId ?? null) : null;
  const [statusBruto, remocoesInit, ptInit, posLiberacao, ptCfg] = await Promise.all([getStatus(warKey), getRemocoes(warKey), getPt(warKey), getPosLiberacao(warKey), getPtConfig()]);
  const playersRows = rosterRows as { nome_familia: string; pt_preferida: string | null; guilda: string }[];
  const playersNomes = playersRows.map((r) => r.nome_familia);
  const rosterNomes = playersNomes.map((n) => n.toLowerCase());
  // PT preferida (base de nodewar) + guilda (p/ o ícone) por chave canônica
  const prefPorChave = new Map<string, string>();
  const guildaPorChave = new Map<string, "M" | "R">();
  for (const r of playersRows) {
    const k = chaveNome(r.nome_familia);
    if (r.pt_preferida) prefPorChave.set(k, r.pt_preferida);
    if (k) guildaPorChave.set(k, r.guilda === "RESO" ? "R" : "M");
  }
  // guilda por chave p/ a conferência (tag do bot tem prioridade; depois reservas; depois players)
  const guildasConf: Record<string, "M" | "R"> = {};
  for (const g of conf.grupos) for (const p of g.players) if (p.tag) guildasConf[chaveNome(p.nome)] = p.tag;
  for (const n of offBotMani) guildasConf[chaveNome(n)] = "M";
  for (const n of offBotReso) guildasConf[chaveNome(n)] = "R";
  for (const [k, gg] of guildaPorChave) if (!(k in guildasConf)) guildasConf[k] = gg;

  // canonicaliza os nomes lidos pela IA (Sykoltic→Sykotic, Denzell→Denzel) com PRIORIDADE
  // pro roster do bot/espera/reservas sobre a tabela players. Conserta o scan já salvo.
  const rosterCand = (() => {
    const m = new Map<string, string>();
    const add = (nome: string) => { const k = chaveNome(nome); if (k && !m.has(k)) m.set(k, nome); };
    for (const g of conf.grupos) for (const p of g.players) add(p.nome);
    for (const p of conf.listaEspera) add(p.nome);
    for (const n of [...offBotMani, ...offBotReso]) add(n);
    return [...m].map(([chave, nome]) => ({ chave, nome }));
  })();
  const playersCand = (() => {
    const m = new Map<string, string>();
    for (const n of playersNomes) { const k = chaveNome(n); if (k && !m.has(k)) m.set(k, n); }
    return [...m].map(([chave, nome]) => ({ chave, nome }));
  })();
  const { mapa: canonMapa, correcoes: correcoesScan, naoEncontrados } = canonicalizarNomes(statusBruto.map((s) => s.familia), rosterCand, playersCand);
  // só avisa "não encontrado" de quem marcou Participar (quem marcou "Não" é ruído)
  const participarChaves = new Set(statusBruto.filter((s) => s.participar).map((s) => chaveNome(s.familia)));
  const naoEncontradosPart = naoEncontrados.filter((n) => participarChaves.has(chaveNome(n)));
  // re-deduplica por chave canônica (se 2 leituras viram a mesma pessoa, Participar=true vence)
  const statusMap = new Map<string, { familia: string; participar: boolean }>();
  for (const s of statusBruto) {
    const canon = canonMapa.get(chaveNome(s.familia)) ?? s.familia;
    const k = chaveNome(canon);
    const ant = statusMap.get(k);
    statusMap.set(k, { familia: canon, participar: (ant?.participar ?? false) || s.participar });
  }
  const statusInicial = [...statusMap.values()];
  const removidosInit = remocoesInit.filter((r) => r.tipo === "remover").map((r) => r.familia);
  const promovidosInit = remocoesInit.filter((r) => r.tipo === "subir").map((r) => r.familia);
  // roster efetivo pós-substituição (removidos saem, promovidos confirmados entram) p/ o board de PTs
  const gruposPt = gruposEfetivos(conf.grupos, conf.listaEspera, new Set(removidosInit.map(chaveNome)), new Set(promovidosInit.map(chaveNome)));

  // reservas (hidden) como linhas de roster, deduplicadas contra os nomes do bot
  const botChaves = new Set(confirmadosNomes.map(chaveNome));
  const hiddenMembros = [
    ...offBotMani.map((n) => ({ tag: "M" as const, nome: n, nota: null, iconKey: null })),
    ...offBotReso.map((n) => ({ tag: "R" as const, nome: n, nota: null, iconKey: null })),
  ].filter((p) => { const k = chaveNome(p.nome); return k && !botChaves.has(k); });

  // roubo de vaga (pós-liberação): Participar in-game e NÃO oficial (nem bot, nem reserva)
  const oficiaisChaves = new Set([...confirmadosNomes, ...offBotNomes].map(chaveNome));
  const rouboMembros = posLiberacao
    ? statusInicial
        .filter((s) => s.participar && !oficiaisChaves.has(chaveNome(s.familia)))
        .map((s) => ({ tag: guildaPorChave.get(chaveNome(s.familia)) ?? null, nome: s.familia, nota: null, iconKey: null }))
    : [];

  // Montar PTs = SÓ quem confirmou Participar in-game (panorama real de quem vai pra war).
  // Filtra o roster do bot + reservas pelo scan; roubo já é participar=true por definição.
  const confirmadosIngame = new Set(statusInicial.filter((s) => s.participar).map((s) => chaveNome(s.familia)));
  const gruposPtConf = gruposPt.map((g) => ({ ...g, players: g.players.filter((p) => confirmadosIngame.has(chaveNome(p.nome))) }));
  // dedup: ninguém aparece 2x. Quem já está nos grupos (inclui promovidos) não repete em reservas/roubo.
  const ptBotChaves = new Set(gruposPtConf.flatMap((g) => g.players).map((p) => chaveNome(p.nome)));
  const hiddenConf = hiddenMembros.filter((p) => { const k = chaveNome(p.nome); return confirmadosIngame.has(k) && !ptBotChaves.has(k); });
  const hiddenChaves = new Set(hiddenConf.map((p) => chaveNome(p.nome)));
  const rouboConf = rouboMembros.filter((p) => { const k = chaveNome(p.nome); return !ptBotChaves.has(k) && !hiddenChaves.has(k); });
  const preferidas = Object.fromEntries(prefPorChave); // chave -> pt preferida (base do board)

  const Stat = ({ children }: { children: React.ReactNode }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, border: `1px solid ${C.borderSoft}`, background: C.inputBg, fontSize: 12, color: C.mute }}>{children}</span>
  );

  return (
    <div style={{ background: C.bgGlow, minHeight: "100vh", padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600;700&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>

      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/mascot.png" alt="BAYGON" width={40} height={40} style={{ filter: "drop-shadow(0 0 10px rgba(204,0,0,.45))" }} />
            <div>
              <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 26, letterSpacing: 1, margin: 0, color: C.amarelo }}>
                BAYGON <span style={{ color: C.mute, fontSize: 14, letterSpacing: 2 }}>· CONFIRMADOS</span>
              </h1>
              {conf.ok && (
                <div style={{ color: C.mute, fontSize: 13, marginTop: 4 }}>
                  <b style={{ color: C.verde }}>{conf.title}</b>{conf.inicioUnix ? ` · ${fmtData(conf.inicioUnix)}` : ""}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <RefreshButton />
            <Link className="navlink" href="/painel">← Painel</Link>
            <Link className="navlink" href="/membros">Membros</Link>
            <Link className="navlink" href="/config">⚙ Config</Link>
          </div>
        </div>

        {!conf.ok ? (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 24, color: C.mute }}>
            <p style={{ margin: 0, color: C.vermelho }}>⚠ Não consegui ler a confirmação: {conf.erro}</p>
            <p style={{ marginBottom: 0, fontSize: 13 }}>
              {conf.erro === "bot sem acesso ao canal"
                ? "O bot BAYGON precisa de “Ver Canal” + “Ler Histórico de Mensagens” no canal do Apollo."
                : "Verifique se há uma mensagem de confirmação recente no canal."}
            </p>
          </div>
        ) : (
          <>
            <AutoSync />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <Stat><b style={{ color: C.verde }}>{totalConf}</b> confirmados</Stat>
              <Stat><img src={GUILD.M.icon} alt="" width={14} height={14} style={{ borderRadius: 3 }} /> {nM}</Stat>
              <Stat><img src={GUILD.R.icon} alt="" width={14} height={14} style={{ borderRadius: 3 }} /> {nR}</Stat>
              <Stat>{conf.listaEspera.length} na lista de espera</Stat>
              {hiddenTotal > 0 && <Stat>{hiddenTotal} reservada(s) fora do bot</Stat>}
              {posLiberacao && <Stat><span style={{ color: C.laranja }}>🏴 {rouboMembros.length} roubaram vaga</span></Stat>}
              {conf.messageTs && <Stat>atualizado {fmtData(Math.floor(new Date(conf.messageTs).getTime() / 1000))}</Stat>}
            </div>

            {/* vagas fora do bot — editável aqui (migrado do /config) */}
            <VagasEditor vagasInit={vagas} canEdit={canEdit} />

            {/* reconciliação bot x in-game (Participar) */}
            <ParticiparReconcile confirmados={confirmadosNomes} offBot={offBotNomes} canEdit={canEdit} statusInicial={statusInicial} posInicial={posLiberacao} warKey={warKey} correcoesInit={correcoesScan} naoEncontrados={naoEncontradosPart} guildas={guildasConf} totalBot={{ M: nM, R: nR }} />

            {/* substituições: remover do grupo + confirmar quem sobe da espera */}
            <SubstituicoesBoard grupos={conf.grupos} listaEspera={conf.listaEspera} removidosInit={removidosInit} promovidosInit={promovidosInit} rosterNomes={rosterNomes} canEdit={canEdit} warKey={warKey} />

            {/* montar PTs (squads): SÓ confirmados in-game; coroa de líder + 1/2/Defesa/UngaBunga + popup */}
            <MontarPtsBoard grupos={gruposPtConf} hidden={hiddenConf} roubo={rouboConf} marcacoesInit={ptInit} preferidas={preferidas} cfgInit={ptCfg} canEdit={canEdit} warKey={warKey} />

            <p style={{ color: C.mute, fontSize: 11.5, marginTop: 14 }}>
              Lido da mensagem do Apollo no Discord (atualiza com o botão ↻). <span style={{ color: C.amarelo }}>•</span> = nome fora do roster.
              Ícone <img src={GUILD.M.icon} alt="" width={12} height={12} style={{ borderRadius: 2, verticalAlign: "-1px" }} /> Manicômio · <img src={GUILD.R.icon} alt="" width={12} height={12} style={{ borderRadius: 2, verticalAlign: "-1px" }} /> Resonance.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
