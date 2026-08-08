import Link from "next/link";
import { notFound } from "next/navigation";
import { C, CorResultado, corDoResultado } from "@/lib/theme";
import { corTier } from "@/lib/tier";
import { resumoEvento, type LinhaResumo } from "@/lib/resumoEvento";

/**
 * RESUMO do evento — uma tela só, leitura pura, feita pra ser olhada depois da guerra (e pra caber
 * num print).
 *
 * As abas do evento servem pra TRABALHAR: arrastar, conferir, gravar. Passada a war, ninguém quer
 * trabalhar — quer responder "o que aconteceu ali" sem clicar em nada. Por isso tudo aqui é
 * calculado no servidor, numa leitura só: o resumo não muda de número dependendo de quem abre.
 */
export const dynamic = "force-dynamic";

// a paleta tem verde e vermelho iguais; pra "aceitou/recusou" e "jogou/não" isso apagaria a
// diferença, então estes dois vêm do semáforo de resultado
const OK = CorResultado.vitoria.cor;
const RUIM = CorResultado.derrota.cor;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fmtData = (d: string) =>
  new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });



// a proteção de sessão é do middleware, como no resto de /hub — aqui não há escrita nenhuma
export default async function ResumoPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  // uuid malformado vai pro 404 aqui: o ::uuid do Postgres estouraria 500 antes de qualquer coisa
  if (!UUID_RE.test(uuid)) notFound();
  const r = await resumoEvento(uuid);
  if (!r) notFound();

  const { evento: e, totais: t } = r;
  const corRes = corDoResultado(e.resultado)?.cor ?? C.mute;

  return (
    <div style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}
        @media print { body { background: #fff } a.navlink { display: none } }`}</style>

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 24, letterSpacing: 1, margin: 0, color: C.amarelo }}>
            {e.titulo}
          </h1>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <Link className="navlink" href={`/hub/${e.uuid}`}>← Evento</Link>
            <Link className="navlink" href="/hub">Hub</Link>
          </div>
        </div>
        <div style={{ color: C.mute, fontSize: 12.5, marginBottom: 16 }}>
          {fmtData(e.data)} · {e.tipo}
          {e.tier && <span style={{ color: corTier[e.tier], fontWeight: 700 }}> · {e.tier}</span>}
          {r.presetNome && <> · chamada <b style={{ color: C.texto }}>{r.presetNome}</b></>}
          {e.status !== "aberto" && <span style={{ color: C.amarelo }}> · 🔒 {e.status}</span>}
          {e.resultado && <span style={{ color: corRes, fontWeight: 700 }}> · {e.resultado.toUpperCase()}</span>}
        </div>

        {/* o funil da guerra, da chamada até quem de fato jogou */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <Numero rot="marcaram" n={t.marcaram} cor={C.texto} />
          <Numero rot="não vão" n={t.naoVao} cor={C.mute} />
          <Numero rot="escalados" n={t.escalados} cor={OK} sufixo={e.tamanhoMax ? `/${e.tamanhoMax}` : undefined} />
          <Numero rot="aceitaram a DM" n={t.aceitaram} cor={OK} />
          {/* quem recusa sai da PT na hora, então some de "escalados" — mostrar só o card faria
              esses N sumirem da folha inteira, que é a informação que a staff mais cobra depois */}
          <Numero rot={t.recusaramForaDePt ? "recusaram (saíram da PT)" : "recusaram"}
            n={t.recusaram + t.recusaramForaDePt} cor={RUIM} />
          <Numero rot="sem responder" n={t.semResposta} cor={C.amarelo} />
          <Numero rot="apareceram in-game" n={t.ingame} cor={OK} />
          {/* sem war gravada não é ZERO, é desconhecido — 0 aqui seria uma acusação falsa */}
          <Numero rot="jogaram (stats)" n={r.war ? t.jogaram : "—"} cor={r.war ? OK : C.mute} />
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <Bloco titulo="Por guilda" flex="1 1 260px">
            {r.porGuilda.length ? r.porGuilda.map((g) => (
              <Linha key={g.guilda}>
                <span style={{ color: C.texto }}>{g.guilda}</span>
                <span style={{ color: C.mute }}>{g.total}{g.lendarios ? ` · ${g.lendarios} lendário(s)` : ""}</span>
              </Linha>
            )) : <Vazio>ninguém escalado</Vazio>}
          </Bloco>

          <Bloco titulo="Oponentes em campo" flex="1 1 260px">
            {r.war?.aliancas.length
              ? <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {r.war.aliancas.map((a) => (
                    <span key={a} style={{ border: `1px solid ${C.border2}`, borderRadius: 999, padding: "2px 10px", fontSize: 12.5, color: C.texto }}>{a}</span>
                  ))}
                </div>
              : <Vazio>{r.war ? "não registrados" : "sem war gravada"}</Vazio>}
            {r.war?.territorio && <div style={{ color: C.mute, fontSize: 12, marginTop: 6 }}>território: {r.war.territorio}</div>}
          </Bloco>

          <Bloco titulo="Chamadas enviadas" flex="1 1 260px">
            {r.chamadas.length ? r.chamadas.map((l) => (
              <Linha key={l.id}>
                <span style={{ color: C.texto }}>{l.rotulo}{l.publico ? ` · ${l.publico}` : ""}</span>
                <span style={{ color: C.mute }}>{l.enviados} ok{l.falhas ? ` · ${l.falhas} não` : ""}</span>
              </Linha>
            )) : <Vazio>nenhuma DM disparada</Vazio>}
          </Bloco>
        </div>

        {/* a escalação como ela ficou, PT por PT */}
        {r.parties.map((p) => (
          <Bloco key={p.id} titulo={`${p.nome} — ${p.membros.length}`} margem>
            {p.membros.length ? <Tabela linhas={p.membros} temWar={!!r.war} /> : <Vazio>PT vazia</Vazio>}
          </Bloco>
        ))}

        {r.foraDePt.length > 0 && (
          <Bloco titulo={`Fora de PT — ${r.foraDePt.length}`} margem>
            <div style={{ color: C.borderSoft, fontSize: 11, marginBottom: 6 }}>
              Tem linha na escalação deste evento mas não está em nenhuma party — recusou a convocação, foi tirado da PT, ou a PT dele saiu da lista da guerra. Quem só marcou no bot e nunca foi escalado não aparece aqui: veja o número de “marcaram” acima.
            </div>
            <Tabela linhas={r.foraDePt} temWar={!!r.war} />
          </Bloco>
        )}
      </div>
    </div>
  );
}

function Tabela({ linhas, temWar }: { linhas: LinhaResumo[]; temWar: boolean }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
        <thead>
          <tr style={{ color: C.mute, fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>
            <Th>jogador</Th><Th>guilda</Th><Th>classe</Th><Th>GS</Th><Th>função</Th><Th>DM</Th><Th>in-game</Th>{temWar && <Th>jogou</Th>}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.chave} style={{ borderTop: `1px solid ${C.borderSoft}` }}>
              <Td cor={C.texto}>{l.lendario ? "★ " : ""}{l.familia}</Td>
              <Td>{l.guildaNome ?? "—"}</Td>
              <Td>{l.classe ?? "—"}</Td>
              <Td>{l.gs ?? "—"}</Td>
              <Td>{l.funcao ?? "—"}</Td>
              <Td cor={l.confirmouDm === true ? OK : l.confirmouDm === false ? RUIM : C.mute}>
                {l.confirmouDm === true ? "aceitou" : l.confirmouDm === false ? "recusou" : "sem resposta"}
              </Td>
              <Td cor={l.ingame ? OK : C.mute}>{l.ingame ? "sim" : "não"}</Td>
              {temWar && <Td cor={l.jogou ? OK : RUIM}>{l.jogou ? "sim" : "não"}</Td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Numero = ({ rot, n, cor, sufixo }: { rot: string; n: number | string; cor: string; sufixo?: string }) => (
  <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, background: C.surface, padding: "8px 14px", minWidth: 104 }}>
    <div style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 21, color: cor, lineHeight: 1.1 }}>
      {n}{sufixo && <span style={{ color: C.mute, fontSize: 14 }}>{sufixo}</span>}
    </div>
    <div style={{ color: C.mute, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 1 }}>{rot}</div>
  </div>
);

const Bloco = ({ titulo, children, flex, margem }: { titulo: string; children: React.ReactNode; flex?: string; margem?: boolean }) => (
  <div style={{ flex, border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "11px 14px", marginBottom: margem ? 12 : 0 }}>
    <div style={{ color: C.verde, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{titulo}</div>
    {children}
  </div>
);
const Linha = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, padding: "2px 0" }}>{children}</div>
);
const Vazio = ({ children }: { children: React.ReactNode }) => <span style={{ color: C.borderSoft, fontSize: 12 }}>{children}</span>;
const Th = ({ children }: { children: React.ReactNode }) => <th style={{ textAlign: "left", padding: "5px 9px", fontWeight: 600 }}>{children}</th>;
const Td = ({ children, cor }: { children: React.ReactNode; cor?: string }) => <td style={{ padding: "4px 9px", color: cor ?? C.mute }}>{children}</td>;
