import Link from "next/link";
import { funilEventos, resumoSerie, totaisHub } from "@/lib/hub";
import { postsIntencaoAtivos } from "@/lib/intencao";
import { canEditNow } from "@/lib/requireAuth";
import { C } from "@/lib/theme";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hub · BAYGON" };

const fmtData = (d: string) =>
  new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });

export default async function HubPage() {
  const [eventos, serie, totais, ativos, canEdit] = await Promise.all([
    funilEventos(), resumoSerie(), totaisHub(), postsIntencaoAtivos(), canEditNow(),
  ]);

  return (
    <div style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}
        a.card:hover{border-color:${C.verde}!important}`}</style>

      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
          <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 26, letterSpacing: 1, margin: 0, color: C.amarelo }}>
            BAYGON <span style={{ color: C.mute, fontSize: 14, letterSpacing: 2 }}>· HUB DE EVENTOS</span>
          </h1>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            {canEdit && <Link className="navlink" href="/hub/config">⚙ Definições</Link>}
            <Link className="navlink" href="/confirmados">Confirmados</Link>
            <Link className="navlink" href="/painel">← Painel</Link>
          </div>
        </div>

        <p style={{ color: C.mute, fontSize: 12.5, margin: "0 0 16px" }}>
          Cada evento passa por quatro degraus: <b style={{ color: C.texto }}>marcaram</b> no bot →
          <b style={{ color: C.texto }}> escalados</b> por você → <b style={{ color: C.verde }}>confirmaram in-game</b> →
          <b style={{ color: C.amarelo }}> presença oficial</b> (estatística da war). A queda entre o primeiro e o último é a falta.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          <Stat>{totais.eventos} eventos</Stat>
          <Stat>{totais.avaliaveis} com estatística</Stat>
          <Stat>{totais.funcoes} funções</Stat>
          <Stat>{totais.parties} parties</Stat>
          <Stat>{totais.reliquias} relíquias</Stat>
        </div>

        {ativos.length > 0 && (
          <div style={{ border: `1px solid ${C.border2}`, borderRadius: 12, background: C.inputBg, padding: "10px 14px", marginBottom: 18 }}>
            <span style={{ color: C.verde, fontWeight: 700, fontSize: 13 }}>Chamada ativa</span>
            {ativos.map((a) => (
              <span key={a.message_id} style={{ color: C.mute, fontSize: 12.5, marginLeft: 10 }}>
                {a.titulo} ({a.tipo}) · {a.criado.slice(0, 16).replace("T", " ")}
                {a.evento_uuid && <> · <Link href={`/hub/${a.evento_uuid}`} style={{ color: C.verde }}>abrir</Link></>}
              </span>
            ))}
          </div>
        )}

        <h2 style={{ color: C.verde, fontSize: 15, margin: "0 0 10px" }}>Eventos</h2>
        {!eventos.length ? (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 24, color: C.mute, fontSize: 13 }}>
            Nenhuma chamada de intenção postada ainda.{canEdit && <> Configure em <Link href="/hub/config" style={{ color: C.verde }}>Definições</Link> e dispare por lá ou pelo <code>/intencao-nodewar</code>.</>}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12, marginBottom: 26 }}>
            {eventos.map((e) => (
              <Link key={e.uuid} className="card" href={`/hub/${e.uuid}`}
                style={{ textDecoration: "none", border: `1px solid ${C.border}`, borderRadius: 12, background: C.surfaceSolid, padding: "12px 14px", display: "block" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 9 }}>
                  <span style={{ color: C.texto, fontWeight: 700, fontSize: 13.5 }}>{e.titulo}</span>
                  <span style={{ color: C.mute, fontSize: 11.5 }}>{fmtData(e.data)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, flexWrap: "wrap" }}>
                  <Degrau n={e.marcaram} rot="marcaram" cor={C.texto} />
                  <Seta />
                  <Degrau n={e.escalados} rot="escalados" cor={C.texto} />
                  <Seta />
                  <Degrau n={e.confirmaram} rot="in-game" cor={C.verde} />
                  <Seta />
                  {e.temWar
                    ? <Degrau n={e.jogaram} rot="jogaram" cor={C.amarelo} />
                    : <span style={{ color: C.borderSoft, fontSize: 11 }} title="resultado da war ainda não gravado">sem estatística</span>}
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>{e.tipo}</span>
                  {e.status !== "aberto" && <span style={{ color: C.amarelo, fontSize: 11 }}>🔒 {e.status}</span>}
                  {e.resultado && <span style={{ color: e.resultado === "vitoria" ? C.verde : e.resultado === "derrota" ? C.vermelho : C.mute, fontSize: 11 }}>{e.resultado}</span>}
                </div>
              </Link>
            ))}
          </div>
        )}

        <h2 style={{ color: C.verde, fontSize: 15, margin: "0 0 4px" }}>Série — quem marca e não joga</h2>
        <p style={{ color: C.mute, fontSize: 11.5, margin: "0 0 10px" }}>
          Sobre os últimos eventos com estatística gravada. <b>Seq</b> = guerras seguidas marcando e não jogando.
        </p>
        {!serie.length || !serie.some((l) => l.avaliados > 0) ? (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 20, color: C.mute, fontSize: 13 }}>
            Sem histórico avaliável ainda — nenhum evento teve o resultado da war gravado. Grave um em
            <Link href="/eventos" style={{ color: C.verde }}> Eventos</Link> e a série começa a existir.
          </div>
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
                  <Th>Jogador</Th><Th>Seq</Th><Th>Marcou</Th><Th>In-game</Th><Th>Jogou</Th><Th>Avaliados</Th>
                </tr>
              </thead>
              <tbody>
                {serie.filter((l) => l.avaliados > 0).slice(0, 40).map((l) => (
                  <tr key={l.chave} style={{ borderTop: `1px solid ${C.borderSoft}` }}>
                    <Td><span style={{ color: C.texto }}>{l.familia}</span></Td>
                    <Td><span style={{ color: l.sequencia >= 3 ? C.vermelho : l.sequencia > 0 ? C.laranja : C.mute, fontWeight: 700 }}>{l.sequencia}</span></Td>
                    <Td>{l.marcou}</Td><Td>{l.confirmou}</Td><Td>{l.jogou}</Td><Td>{l.avaliados}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ children }: { children: React.ReactNode }) {
  return <span style={{ border: `1px solid ${C.border2}`, borderRadius: 999, padding: "4px 12px", fontSize: 12, color: C.mute, background: C.inputBg }}>{children}</span>;
}
function Degrau({ n, rot, cor }: { n: number; rot: string; cor: string }) {
  return <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3 }}><b style={{ color: cor, fontSize: 14 }}>{n}</b><span style={{ color: C.mute, fontSize: 10.5 }}>{rot}</span></span>;
}
const Seta = () => <span style={{ color: C.borderSoft, fontSize: 11 }}>›</span>;
const Th = ({ children }: { children: React.ReactNode }) => <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>{children}</th>;
const Td = ({ children }: { children: React.ReactNode }) => <td style={{ padding: "7px 12px", color: C.mute }}>{children}</td>;
