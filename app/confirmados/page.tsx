import Link from "next/link";
import { fetchConfirmados, type PlayerConf } from "@/lib/confirmados";
import { getVagas, nomesDoTexto } from "@/lib/vagas";
import { getStatus } from "@/lib/participarStatus";
import { sql } from "@/lib/db";
import { canEditNow } from "@/lib/requireAuth";
import { C } from "@/lib/theme";
import RefreshButton from "./RefreshButton";
import ParticiparReconcile from "./ParticiparReconcile";

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
    sql`SELECT lower(nome_familia) AS n FROM players`,
    canEditNow(),
    getVagas(),
  ]);
  const roster = new Set((rosterRows as { n: string }[]).map((r) => r.n));
  const conhecido = (p: PlayerConf) => roster.has(p.nome.toLowerCase());

  const totalConf = conf.grupos.reduce((s, g) => s + g.players.length, 0);
  const nM = conf.grupos.reduce((s, g) => s + g.players.filter((p) => p.tag === "M").length, 0);
  const nR = totalConf - nM;
  const confirmadosNomes = conf.grupos.flatMap((g) => g.players.map((p) => p.nome));
  const esperaNomes = conf.listaEspera.map((p) => p.nome);
  const offBotMani = nomesDoTexto(vagas.MANI.texto);
  const offBotReso = nomesDoTexto(vagas.RESO.texto);
  const offBotNomes = [...offBotMani, ...offBotReso];
  const hiddenTotal = vagas.MANI.hidden + vagas.RESO.hidden;
  const warKey = conf.ok ? (conf.messageId ?? null) : null;
  const statusInicial = await getStatus(warKey);

  const Stat = ({ children }: { children: React.ReactNode }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, border: `1px solid ${C.borderSoft}`, background: C.inputBg, fontSize: 12, color: C.mute }}>{children}</span>
  );
  const Player = ({ p }: { p: PlayerConf }) => {
    const g = p.tag ? GUILD[p.tag] : null;
    const ok = conhecido(p);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: ok ? C.texto : C.mute }} title={ok ? "" : "fora do roster"}>
        {g && <img src={g.icon} alt={p.tag ?? ""} width={14} height={14} style={{ borderRadius: 3 }} />}
        <span>{p.nome}</span>
        {p.nota && <span style={{ color: C.mute, fontSize: 11 }}>({p.nota})</span>}
        {!ok && <span style={{ color: C.amarelo, fontSize: 10 }}>•</span>}
      </div>
    );
  };

  return (
    <div style={{ background: C.bgGlow, minHeight: "100vh", padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600;700&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>

      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/mascot.png" alt="BAYGON" width={40} height={40} style={{ filter: "drop-shadow(0 0 10px rgba(52,224,106,.45))" }} />
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
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <Stat><b style={{ color: C.verde }}>{totalConf}</b> confirmados</Stat>
              <Stat><img src={GUILD.M.icon} alt="" width={14} height={14} style={{ borderRadius: 3 }} /> {nM}</Stat>
              <Stat><img src={GUILD.R.icon} alt="" width={14} height={14} style={{ borderRadius: 3 }} /> {nR}</Stat>
              <Stat>{conf.listaEspera.length} na lista de espera</Stat>
              {hiddenTotal > 0 && <Stat>{hiddenTotal} reservada(s) fora do bot</Stat>}
              {conf.messageTs && <Stat>atualizado {fmtData(Math.floor(new Date(conf.messageTs).getTime() / 1000))}</Stat>}
            </div>

            {/* vagas fora do bot (configuradas em /config) */}
            {(hiddenTotal > 0 || offBotNomes.length > 0) && (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "12px 14px", marginBottom: 18 }}>
                <div style={{ color: C.amarelo, fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>Vagas fora do bot</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
                  {(["MANI", "RESO"] as const).map((g) => {
                    const nomes = g === "MANI" ? offBotMani : offBotReso;
                    return (
                      <div key={g} style={{ minWidth: 200 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.texto, marginBottom: 4 }}>
                          <img src={g === "MANI" ? "/guilds/manicomio.png" : "/guilds/resonance.png"} alt="" width={14} height={14} style={{ borderRadius: 3 }} />
                          {g === "MANI" ? "Manicômio" : "Resonance"} · <span style={{ color: C.mute }}>{vagas[g].hidden} reservada(s)</span>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
                          {nomes.length === 0 ? <span style={{ color: C.borderSoft, fontSize: 12 }}>—</span> : nomes.map((n) => <span key={n} style={{ fontSize: 12.5, color: C.texto }}>{n}</span>)}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p style={{ color: C.mute, fontSize: 11, marginTop: 8, marginBottom: 0 }}>Configurado em ⚙ Config. Esses nomes contam como vaga válida (não caem no “deve retirar”).</p>
              </div>
            )}

            {/* reconciliação bot x in-game (Participar) */}
            <ParticiparReconcile confirmados={confirmadosNomes} espera={esperaNomes} offBot={offBotNomes} canEdit={canEdit} statusInicial={statusInicial} warKey={warKey} />

            {/* grupos */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, marginBottom: 18 }}>
              {conf.grupos.map((g) => (
                <div key={g.nome} style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ color: C.verde, fontWeight: 700, fontSize: 13.5 }}>{g.nome}</span>
                    <span style={{ color: C.mute, fontSize: 11 }}>{g.capacidade}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {g.players.length === 0 ? <span style={{ color: C.borderSoft, fontSize: 12 }}>—</span> : g.players.map((p, i) => <Player key={i} p={p} />)}
                  </div>
                </div>
              ))}
            </div>

            {/* lista de espera */}
            {conf.listaEspera.length > 0 && (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "14px 16px" }}>
                <div style={{ color: C.amarelo, fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Lista de espera ({conf.listaEspera.length})</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "4px 14px" }}>
                  {conf.listaEspera.map((p, i) => <Player key={i} p={p} />)}
                </div>
              </div>
            )}

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
