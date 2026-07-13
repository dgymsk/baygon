import Link from "next/link";
import { fetchConfirmadosDoBot } from "@/lib/confirmadosBot";
import { getVagas, nomesDoTexto } from "@/lib/vagas";
import { getStatus, getPosLiberacao } from "@/lib/participarStatus";
import { getRemocoes } from "@/lib/remocaoStatus";
import { getPt, getPtConfig } from "@/lib/ptStatus";
import { gruposEfetivos } from "@/lib/substituicoes";
import { canonicalizarNomes } from "@/lib/casarNome";
import { chaveNome } from "@/lib/nomes";
import { sql } from "@/lib/db";
import { canEditNow } from "@/lib/requireAuth";
import { getGuildMeta, iconeUrl } from "@/lib/guildConfig";
import { C } from "@/lib/theme";
import RefreshButton from "../confirmados/RefreshButton";
import ParticiparReconcile from "../confirmados/ParticiparReconcile";
import VagasEditor from "../confirmados/VagasEditor";
import SubstituicoesBoard from "../confirmados/SubstituicoesBoard";
import MontarPtsBoard from "../confirmados/MontarPtsBoard";
import AutoSync from "../confirmados/AutoSync";
import EventoSelect from "./EventoSelect";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirmados (bot) · BAYGON" };

function fmtData(unix?: number): string {
  if (!unix) return "";
  return new Date(unix * 1000).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export default async function ConfirmadosBotPage({ searchParams }: { searchParams: Promise<{ ev?: string }> }) {
  const { ev: evParam } = await searchParams;
  const [rosterRows, canEdit, vagas, meta] = await Promise.all([
    sql`SELECT nome_familia, pt_preferida, guilda FROM players`,
    canEditNow(),
    getVagas(),
    getGuildMeta(),
  ]);
  const tagPorGuilda = Object.fromEntries(meta.guildas.map((g) => [g.id, g.tag]));
  const conf = await fetchConfirmadosDoBot({ eventoUuid: evParam ?? null, tagPorGuilda });

  const byId = new Map(meta.guildas.map((g) => [g.id, g]));
  const tagPorId = (id?: string | null) => (id ? byId.get(id)?.tag ?? null : null);
  const totalConf = conf.grupos.reduce((s, g) => s + g.players.length, 0);
  const contBot: Record<string, number> = {};
  for (const g of meta.guildas) contBot[g.tag] = 0;
  for (const grp of conf.grupos) for (const p of grp.players) if (p.tag && p.tag in contBot) contBot[p.tag]++;
  const confirmadosNomes = conf.grupos.flatMap((g) => g.players.map((p) => p.nome));
  const offBotPorGuilda = meta.guildas.map((g) => ({ tag: g.tag, nomes: nomesDoTexto(vagas[g.id]?.texto ?? "") }));
  const offBotNomes = offBotPorGuilda.flatMap((o) => o.nomes);
  const hiddenTotal = meta.guildas.reduce((s, g) => s + (vagas[g.id]?.hidden ?? 0), 0);
  const warKey = conf.ok ? (conf.messageId ?? null) : null;
  const [statusBruto, remocoesInit, ptInit, posLiberacao, ptCfg] = await Promise.all([getStatus(warKey), getRemocoes(warKey), getPt(warKey), getPosLiberacao(warKey), getPtConfig()]);
  const playersRows = rosterRows as { nome_familia: string; pt_preferida: string | null; guilda: string }[];
  const playersNomes = playersRows.map((r) => r.nome_familia);
  const rosterNomes = playersNomes.map((n) => n.toLowerCase());
  const prefPorChave = new Map<string, string>();
  const guildaPorChave = new Map<string, string>();
  for (const r of playersRows) {
    const k = chaveNome(r.nome_familia);
    if (r.pt_preferida) prefPorChave.set(k, r.pt_preferida);
    const t = tagPorId(r.guilda);
    if (k && t) guildaPorChave.set(k, t);
  }
  const guildasConf: Record<string, string> = {};
  for (const g of conf.grupos) for (const p of g.players) if (p.tag) guildasConf[chaveNome(p.nome)] = p.tag;
  for (const o of offBotPorGuilda) for (const n of o.nomes) guildasConf[chaveNome(n)] = o.tag;
  for (const [k, gg] of guildaPorChave) if (!(k in guildasConf)) guildasConf[k] = gg;

  const rosterCand = (() => {
    const m = new Map<string, string>();
    const add = (nome: string) => { const k = chaveNome(nome); if (k && !m.has(k)) m.set(k, nome); };
    for (const g of conf.grupos) for (const p of g.players) add(p.nome);
    for (const p of conf.listaEspera) add(p.nome);
    for (const n of offBotNomes) add(n);
    return [...m].map(([chave, nome]) => ({ chave, nome }));
  })();
  const playersCand = (() => {
    const m = new Map<string, string>();
    for (const n of playersNomes) { const k = chaveNome(n); if (k && !m.has(k)) m.set(k, n); }
    return [...m].map(([chave, nome]) => ({ chave, nome }));
  })();
  const { mapa: canonMapa, correcoes: correcoesScan, naoEncontrados } = canonicalizarNomes(statusBruto.map((s) => s.familia), rosterCand, playersCand);
  const participarChaves = new Set(statusBruto.filter((s) => s.participar).map((s) => chaveNome(s.familia)));
  const naoEncontradosPart = naoEncontrados.filter((n) => participarChaves.has(chaveNome(n)));
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
  const gruposPt = gruposEfetivos(conf.grupos, conf.listaEspera, new Set(removidosInit.map(chaveNome)), new Set(promovidosInit.map(chaveNome)));

  const botChaves = new Set(confirmadosNomes.map(chaveNome));
  const hiddenMembros = offBotPorGuilda
    .flatMap((o) => o.nomes.map((n) => ({ tag: o.tag as string | null, nome: n, nota: null as string | null, iconKey: null as string | null })))
    .filter((p) => { const k = chaveNome(p.nome); return k && !botChaves.has(k); });

  const oficiaisChaves = new Set([...confirmadosNomes, ...offBotNomes].map(chaveNome));
  const rouboMembros = posLiberacao
    ? statusInicial
        .filter((s) => s.participar && !oficiaisChaves.has(chaveNome(s.familia)))
        .map((s) => ({ tag: guildaPorChave.get(chaveNome(s.familia)) ?? null, nome: s.familia, nota: null, iconKey: null }))
    : [];

  const confirmadosIngame = new Set(statusInicial.filter((s) => s.participar).map((s) => chaveNome(s.familia)));
  const gruposPtConf = gruposPt.map((g) => ({ ...g, players: g.players.filter((p) => confirmadosIngame.has(chaveNome(p.nome))) }));
  const ptBotChaves = new Set(gruposPtConf.flatMap((g) => g.players).map((p) => chaveNome(p.nome)));
  const hiddenConf = hiddenMembros.filter((p) => { const k = chaveNome(p.nome); return confirmadosIngame.has(k) && !ptBotChaves.has(k); });
  const hiddenChaves = new Set(hiddenConf.map((p) => chaveNome(p.nome)));
  const rouboConf = rouboMembros.filter((p) => { const k = chaveNome(p.nome); return !ptBotChaves.has(k) && !hiddenChaves.has(k); });
  const preferidas = Object.fromEntries(prefPorChave);

  const Stat = ({ children }: { children: React.ReactNode }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, border: `1px solid ${C.borderSoft}`, background: C.inputBg, fontSize: 12, color: C.mute }}>{children}</span>
  );

  return (
    <div style={{ background: C.bgGlow, minHeight: "100vh", padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600;700&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>

      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/mascot.png" alt="BAYGON" width={40} height={40} style={{ filter: "drop-shadow(0 0 10px rgba(204,0,0,.45))" }} />
            <div>
              <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 26, letterSpacing: 1, margin: 0, color: C.amarelo }}>
                BAYGON <span style={{ color: C.mute, fontSize: 14, letterSpacing: 2 }}>· CONFIRMADOS (BOT)</span>
              </h1>
              {conf.ok && (
                <div style={{ color: C.mute, fontSize: 13, marginTop: 4 }}>
                  <b style={{ color: C.verde }}>{conf.title}</b>{conf.inicioUnix ? ` · ${fmtData(conf.inicioUnix)}` : ""}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <EventoSelect eventos={conf.eventos} atual={conf.eventoUuid} />
            <RefreshButton />
            <Link className="navlink" href="/participacao">← Participação</Link>
            <Link className="navlink" href="/confirmados">Apollo</Link>
            <Link className="navlink" href="/membros">Membros</Link>
          </div>
        </div>

        {!conf.ok ? (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 24, color: C.mute }}>
            <p style={{ margin: 0, color: C.vermelho }}>⚠ {conf.erro}</p>
            <p style={{ marginBottom: 0, fontSize: 13 }}>
              Abra um evento no <Link className="navlink" href="/participacao" style={{ color: C.verde }}>Participação</Link> e dispare o bot (Can/Cant). Assim que houver respostas, o roster aparece aqui.
            </p>
          </div>
        ) : (
          <>
            <AutoSync />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <Stat><b style={{ color: C.verde }}>{totalConf}</b> confirmados</Stat>
              {meta.guildas.map((g) => { const u = iconeUrl(g.icone); return (
                <Stat key={g.id}>{u ? <img src={u} alt="" width={14} height={14} style={{ borderRadius: 3 }} /> : <span>{g.icone || g.tag}</span>} {contBot[g.tag] ?? 0}</Stat>
              ); })}
              <Stat>{conf.listaEspera.length} na lista de espera</Stat>
              {hiddenTotal > 0 && <Stat>{hiddenTotal} reservada(s) fora do bot</Stat>}
              {posLiberacao && <Stat><span style={{ color: C.laranja }}>🏴 {rouboMembros.length} roubaram vaga</span></Stat>}
            </div>

            <VagasEditor vagasInit={vagas} canEdit={canEdit} guildas={meta.guildas} />

            <ParticiparReconcile confirmados={confirmadosNomes} offBot={offBotNomes} canEdit={canEdit} statusInicial={statusInicial} posInicial={posLiberacao} warKey={warKey} correcoesInit={correcoesScan} naoEncontrados={naoEncontradosPart} guildas={guildasConf} totalBot={contBot} guildaDefs={meta.guildas} />

            <SubstituicoesBoard grupos={conf.grupos} listaEspera={conf.listaEspera} removidosInit={removidosInit} promovidosInit={promovidosInit} rosterNomes={rosterNomes} canEdit={canEdit} warKey={warKey} guildas={meta.guildas} />

            <MontarPtsBoard grupos={gruposPtConf} hidden={hiddenConf} roubo={rouboConf} marcacoesInit={ptInit} preferidas={preferidas} cfgInit={ptCfg} canEdit={canEdit} warKey={warKey} guildas={meta.guildas} />

            <p style={{ color: C.mute, fontSize: 11.5, marginTop: 14 }}>
              Lido do <b style={{ color: C.texto }}>nosso bot de participação</b> (Can/Cant + PTs atribuídas do evento ativo). <span style={{ color: C.amarelo }}>•</span> = nome fora do roster.
              {meta.guildas.map((g, i) => { const u = iconeUrl(g.icone); return (
                <span key={g.id}>{i === 0 ? " Ícone " : " · "}{u ? <img src={u} alt="" width={12} height={12} style={{ borderRadius: 2, verticalAlign: "-1px" }} /> : <span>{g.icone || g.tag}</span>} {g.nome}</span>
              ); })}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
