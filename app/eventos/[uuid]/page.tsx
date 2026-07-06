import Link from "next/link";
import { notFound } from "next/navigation";
import { C } from "@/lib/theme";
import { getEventoByUuid, desempenhoDaWar } from "@/lib/eventos";
import { getDiscordConfig } from "@/lib/discordConfig";
import { canEditNow } from "@/lib/requireAuth";
import { listNomesFamilia } from "@/lib/players";
import RosterView from "@/app/participacao/RosterView";
import EventoAcoes from "./EventoAcoes";
import ResultadoExtrair from "./ResultadoExtrair";

export const dynamic = "force-dynamic";
export const metadata = { title: "Evento · BAYGON" };

const rotulo = (t: string) => (t === "siege" ? "Siege" : t === "nodewar" ? "Nodewar" : t);
const badgeCor = (s: string) => (s === "aberto" ? C.verde : s === "travado" ? C.amarelo : C.mute);

// Página HUB visual do evento: snapshot da participação + facetas futuras (confirmados / resultado).
export default async function EventoDetalhe({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const [ev, dc, canEdit, nomes] = await Promise.all([getEventoByUuid(uuid), getDiscordConfig(), canEditNow(), listNomesFamilia()]);
  if (!ev) notFound();
  nomes.sort((a, b) => a.localeCompare(b, "pt-BR"));
  const statsIniciais = ev.warId != null ? await desempenhoDaWar(ev.warId) : []; // pré-carrega a tabela se já há war ligada

  const RES_LABEL: Record<string, string> = { derrota: "Derrota", participacao: "Participação", vitoria: "Vitória" };

  const msgUrl = ev.messageId && ev.channelId && dc.guildId ? `https://discord.com/channels/${dc.guildId}/${ev.channelId}/${ev.messageId}` : null;
  const card = { border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 16 } as const;
  const secTitulo = { color: C.mute, fontSize: 11, textTransform: "uppercase" as const, letterSpacing: 1.5, marginBottom: 8 };
  const meta = (k: string, v: string) => (<span style={{ color: C.mute, fontSize: 12 }}>{k}: <b style={{ color: C.texto }}>{v}</b></span>);

  return (
    <div style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <Link className="navlink" href="/eventos">← Eventos</Link>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Link className="navlink" href="/participacao">Participação</Link>
            <Link className="navlink" href="/confirmados">Confirmados</Link>
          </div>
        </div>

        {/* cabeçalho do evento */}
        <div style={{ ...card, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 20, fontWeight: 800, color: C.amarelo }}>{ev.titulo || "(sem título)"}</span>
            <span style={{ color: badgeCor(ev.status), fontSize: 12, fontWeight: 700, border: `1px solid ${C.border2}`, borderRadius: 999, padding: "2px 10px" }}>{ev.status}</span>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
            {meta("Tipo", rotulo(ev.tipo))}
            {meta("Data", ev.data)}
            {meta("Criado", new Date(ev.criado).toLocaleString("pt-BR"))}
            {ev.travadoEm && meta("Travado", new Date(ev.travadoEm).toLocaleString("pt-BR"))}
            {ev.finalizadoEm && meta("Finalizado", new Date(ev.finalizadoEm).toLocaleString("pt-BR"))}
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: C.borderSoft, fontSize: 11, fontFamily: "'Share Tech Mono', monospace" }}>uuid {ev.uuid}</span>
            {msgUrl && <a href={msgUrl} target="_blank" rel="noreferrer" style={{ color: C.verde, fontSize: 12, textDecoration: "none" }}>abrir mensagem no Discord →</a>}
          </div>
        </div>

        {/* FACETA 1: Participação (snapshot congelado) */}
        <div style={{ ...card, marginBottom: 14 }}>
          <div style={secTitulo}>Participação (snapshot do bot)</div>
          {ev.snapshot ? (
            <>
              <div style={{ color: C.verde, fontSize: 13, marginBottom: 10 }}>
                ● {ev.snapshot.templateNome} — {ev.snapshot.totalConfirmados}{ev.snapshot.tamanhoMax != null ? `/${ev.snapshot.tamanhoMax}` : ""} confirmados{ev.snapshot.totalEspera > 0 ? ` · ⏳ ${ev.snapshot.totalEspera} espera` : ""}
                <span style={{ color: C.borderSoft, marginLeft: 8 }}>congelado {new Date(ev.snapshot.capturadoEm).toLocaleString("pt-BR")}</span>
              </div>
              <RosterView sit={ev.snapshot} />
            </>
          ) : (
            <div style={{ color: C.borderSoft, fontSize: 12.5 }}>{ev.status === "finalizado" ? "Sem snapshot (evento sem roster no momento da finalização)." : "O snapshot é gravado ao FINALIZAR o evento. Enquanto ativo, veja a situação ao vivo em Participação."}</div>
          )}
        </div>

        {/* FACETA 2 e 3: futuras (linkam no mesmo evento) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={card}><div style={secTitulo}>Confirmados (Apollo)</div><div style={{ color: C.borderSoft, fontSize: 12.5 }}>Não integrado ainda — vai pendurar neste evento.</div></div>
          <div style={card}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <div style={{ ...secTitulo, marginBottom: 0 }}>Resultado da guerra</div>
              {ev.resultado && <span style={{ color: ev.resultado === "vitoria" ? C.verde : ev.resultado === "derrota" ? C.vermelho : C.amarelo, fontSize: 12, fontWeight: 700 }}>{RES_LABEL[ev.resultado]}</span>}
            </div>
            <EventoAcoes id={ev.id} resultadoInicial={ev.resultado} canEdit={canEdit} />
          </div>
        </div>

        {/* FACETA 3 (parte 2): stats por membro extraídos do print (Opus) → wars/desempenho */}
        <div style={{ ...card, marginTop: 14 }}>
          <div style={secTitulo}>Stats da guerra (por membro)</div>
          <ResultadoExtrair id={ev.id} canEdit={canEdit} players={nomes} warIdInicial={ev.warId} statsIniciais={statsIniciais} />
        </div>
      </div>
    </div>
  );
}
