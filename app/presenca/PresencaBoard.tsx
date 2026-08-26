"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { C } from "@/lib/theme";
import { ESTADO } from "@/lib/estadoWarCores";
import { rotuloGuerra } from "@/lib/tiposGuerra";
import type { EstadoWar } from "@/lib/historicoSemana";
import type { ColunaPresenca, GradePresenca } from "@/lib/presencaGlobal";

/**
 * A GRADE: uma linha por jogador, uma coluna por evento do período.
 *
 * A célula é o MESMO quadradinho do card da escalação, com a mesma paleta (lib/estadoWarCores) —
 * quem já aprendeu a ler o card não precisa aprender nada aqui.
 *
 * A última coluna, quando há um evento aberto escolhido, é o PROVISÓRIO: um clique diz "pretendo
 * levar essa pessoa". Não é escalação (não ocupa PT, não dispara DM); é o rascunho que antes só
 * existia na cabeça de quem monta, e que agora aparece em azul no pool da escalação.
 */

/** Azul do provisório: fora da paleta do site de propósito, como as cores dos quadradinhos. */
const AZUL = "#2f5fa8";
const AZUL_FUNDO = "rgba(47,95,168,.30)";
const AZUL_CLARO = "#9dc0f0";
const LADO = 15;

/**
 * A tinta do M, escolhida pelo BRILHO do fundo do quadrado.
 *
 * Os oito estados vão de verde claro a quase-preto: uma cor fixa some em metade deles. Fundo
 * transparente conta como escuro, porque atrás dele está o fundo da página.
 */
function tinta(fill: string): string {
  const h = fill.replace("#", "");
  if (h.length !== 6) return "rgba(255,255,255,.85)";               // 'transparent'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 130 ? "rgba(0,0,0,.72)" : "rgba(255,255,255,.85)";
}

/**
 * `m` = marcou uma função na chamada da guerra escolhida pro provisório (só a coluna dela recebe).
 *
 * Desenhado ANTES das marcas de estado (o X de falta, a bola do silêncio, o traço da recusa), então
 * quando os dois coexistem quem manda na leitura é o estado — o M fica de pano de fundo. É a ordem
 * certa: "faltou" é a informação que a staff precisa ver primeiro; "tinha marcado" é o agravante.
 */
function Quadrado({ estado, titulo, m: marcou = false }: { estado: EstadoWar; titulo: string; m?: boolean }) {
  const s = ESTADO[estado];
  const m = LADO / 2;
  return (
    <svg width={LADO} height={LADO} style={{ display: "block" }}>
      <title>{titulo}</title>
      <rect x={0.5} y={0.5} width={LADO - 1} height={LADO - 1} rx={2.5}
        fill={s.fill} stroke={s.stroke ?? "rgba(0,0,0,.45)"} strokeWidth={s.stroke ? 1.2 : 0.7} />
      {marcou && (
        <text x={m} y={m + 0.5} textAnchor="middle" dominantBaseline="middle"
          fontSize={10} fontWeight={800} fontFamily="'Share Tech Mono', monospace" fill={tinta(s.fill)}>M</text>
      )}
      {s.marca === "x" && (
        <g stroke="#e04b4b" strokeWidth={1.4} strokeLinecap="round">
          <line x1={4} y1={4} x2={LADO - 4} y2={LADO - 4} /><line x1={LADO - 4} y1={4} x2={4} y2={LADO - 4} />
        </g>
      )}
      {s.marca === "o" && <circle cx={m} cy={m} r={m - 4.5} fill="none" stroke="#8f8f8f" strokeWidth={1.3} />}
      {s.marca === "traco" && <line x1={4} y1={m} x2={LADO - 4} y2={m} stroke="#8f8f8f" strokeWidth={1.4} strokeLinecap="round" />}
    </svg>
  );
}

const DIA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const br = (iso: string) => iso.slice(5, 10).split("-").reverse().join("/");
/** UTC: `data` é DATE puro. Sem o T00:00:00Z o fuso local joga a data pro dia anterior. */
const diaDaSemana = (iso: string) => DIA[new Date(`${iso}T00:00:00Z`).getUTCDay()];
/**
 * O rótulo da célula. Em evento AINDA ABERTO, `sem_stat` não é "faltou o print": é guerra que
 * nem foi jogada. Mesmo quadrado cinza, texto honesto.
 */
function rotulo(e: EstadoWar, c: ColunaPresenca) {
  if (c.status !== "finalizado") {
    if (e === "sem_stat") return "escalado — evento ainda em aberto";
    if (e === "nao_respondeu") return "ainda não respondeu";
  }
  return ESTADO[e].rot;
}

/** O mesmo laranja do quadrado "marcou": na grade, laranja já quer dizer "ele disse que vai". */
const COR_MARCOU = ESTADO.marcou.fill;

const LEGENDA: EstadoWar[] = ["jogou", "jogou_sem_escala", "marcou", "faltou", "recusou", "nao_respondeu", "sem_stat", "sem"];

export default function PresencaBoard({ grade, de, ate, guilda, eventoProvisorio, canEdit }: {
  grade: GradePresenca; de: string; ate: string; guilda: string; eventoProvisorio: number | null; canEdit: boolean;
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<"nome" | "jogou">("nome");
  /** Só quem marcou no bot da chamada escolhida. Estado de tela, não de URL: é um recorte de
   *  trabalho ("me mostra só os candidatos"), não um endereço que alguém queira mandar pra outro. */
  const [soMarcados, setSoMarcados] = useState(false);
  const [prov, setProv] = useState<Record<string, boolean>>({});
  const [salvando, setSalvando] = useState<string | null>(null);

  // navega por URL: o estado da grade É o endereço, então dá pra mandar o link pra outra pessoa
  const ir = (p: Record<string, string>) => {
    const u = new URLSearchParams({ de, ate, ...(guilda ? { guilda } : {}), ...(eventoProvisorio ? { ev: String(eventoProvisorio) } : {}), ...p });
    router.push(`/presenca?${u.toString()}`);
  };

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    let base = q ? grade.linhas.filter((l) => l.familia.toLowerCase().includes(q)) : grade.linhas;
    // o filtro só existe com uma chamada escolhida — sem ela, "marcou no bot" não tem a que se referir
    if (soMarcados && eventoProvisorio) base = base.filter((l) => l.marcouBot);
    return ordem === "jogou"
      ? [...base].sort((a, b) => b.jogou - a.jogou || a.familia.localeCompare(b.familia, "pt-BR"))
      : base;
  }, [grade.linhas, busca, ordem, soMarcados, eventoProvisorio]);
  /** Quantos marcaram, do elenco INTEIRO da guilda filtrada — o número do botão não pode encolher
   *  junto com a lista que ele mesmo filtra. */
  const nMarcaram = useMemo(() => grade.linhas.filter((l) => l.marcouBot).length, [grade.linhas]);

  const ehProv = (chave: string, base: boolean) => prov[chave] ?? base;

  async function alternar(l: { chave: string; familia: string; provisorio: boolean }) {
    if (!canEdit || !eventoProvisorio) return;
    const alvo = !ehProv(l.chave, l.provisorio);
    setProv((s) => ({ ...s, [l.chave]: alvo }));   // otimista: são 70 linhas, esperar o servidor trava o dedo
    setSalvando(l.chave);
    try {
      const res = await fetch("/api/presenca/provisorio", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventoId: eventoProvisorio, familia: l.familia, marcar: alvo }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((d as { error?: string }).error ?? `erro ${res.status}`);
      // vale o que o SERVIDOR gravou, não o que a tela supôs
      setProv((s) => ({ ...s, [l.chave]: (d as { provisorio?: boolean }).provisorio === true }));
    } catch { setProv((s) => ({ ...s, [l.chave]: l.provisorio })); }
    finally { setSalvando(null); }
  }

  const nProv = linhas.filter((l) => ehProv(l.chave, l.provisorio)).length;
  const evAberto = grade.abertos.find((a) => a.eventoId === eventoProvisorio);
  /** A guerra escolhida tem coluna na grade? Sem coluna não há quadrado onde pintar o M. */
  const temColuna = grade.colunas.some((c) => c.eventoId === eventoProvisorio);
  const cel = { padding: "3px 5px", textAlign: "center" as const };

  return (
    <div className="pg" style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}
        .gp tbody tr:hover{background:rgba(255,255,255,.03)}`}</style>

      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 26, letterSpacing: 1, margin: 0, color: C.amarelo }}>
            BAYGON <span style={{ color: C.mute, fontSize: 14, letterSpacing: 2 }}>· PRESENÇA</span>
          </h1>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Link className="navlink" href="/hub">Hub</Link>
            <Link className="navlink" href="/membros">Membros</Link>
            <Link className="navlink" href="/painel">← Painel</Link>
          </div>
        </div>

        {/* filtros — tudo por URL, então o estado da tela é compartilhável */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <label style={{ color: C.mute, fontSize: 12 }}>de{" "}
            <input type="date" defaultValue={de} onChange={(e) => ir({ de: e.target.value })}
              style={{ background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "5px 8px", fontSize: 12.5, fontFamily: "inherit" }} />
          </label>
          <label style={{ color: C.mute, fontSize: 12 }}>até{" "}
            <input type="date" defaultValue={ate} onChange={(e) => ir({ ate: e.target.value })}
              style={{ background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "5px 8px", fontSize: 12.5, fontFamily: "inherit" }} />
          </label>
          <select value={guilda} onChange={(e) => ir({ guilda: e.target.value })}
            style={{ background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "5px 9px", fontSize: 12.5, fontFamily: "inherit", cursor: "pointer" }}>
            <option value="">todas as guildas</option>
            {grade.guildas.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="filtrar nome…"
            style={{ background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "5px 9px", fontSize: 12.5, fontFamily: "inherit", width: 150 }} />
          <button onClick={() => setOrdem((o) => (o === "nome" ? "jogou" : "nome"))}
            style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: C.mute, padding: "5px 11px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
            ordem: {ordem === "nome" ? "nome" : "quem mais jogou"}
          </button>
          {/* só aparece com uma chamada escolhida: sem ela, "marcou no bot" não tem a que se referir */}
          {eventoProvisorio != null && (
            <button onClick={() => setSoMarcados((v) => !v)} disabled={!nMarcaram && !soMarcados}
              title={nMarcaram ? "mostra só quem marcou uma função na chamada do bot desta guerra" : "ninguém marcou nessa chamada ainda"}
              style={{ borderRadius: 8, border: `1px solid ${soMarcados ? COR_MARCOU : C.border2}`, background: soMarcados ? "rgba(224,138,58,.14)" : C.inputBg,
                color: nMarcaram || soMarcados ? (soMarcados ? COR_MARCOU : C.mute) : C.borderSoft,
                padding: "5px 11px", fontSize: 12.5, cursor: nMarcaram || soMarcados ? "pointer" : "not-allowed", fontFamily: "inherit", fontWeight: soMarcados ? 700 : 400 }}>
              {soMarcados ? "✓ " : ""}só quem marcou no bot ({nMarcaram})
            </button>
          )}
          <span style={{ color: C.mute, fontSize: 12, marginLeft: "auto" }}>
            <b style={{ color: C.texto }}>{linhas.length}</b> jogadores · <b style={{ color: C.texto }}>{grade.colunas.length}</b> eventos
          </span>
        </div>

        {/* PROVISÓRIO: de qual guerra aberta se está montando o rascunho */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12,
          border: `1px solid ${eventoProvisorio ? AZUL : C.border}`, borderRadius: 10, background: C.surface, padding: "8px 12px" }}>
          <span style={{ color: C.mute, fontSize: 12.5 }}>montar provisório da guerra</span>
          <select value={eventoProvisorio ?? ""} onChange={(e) => ir({ ev: e.target.value })}
            style={{ background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "5px 9px", fontSize: 12.5, fontFamily: "inherit", cursor: "pointer", maxWidth: 300 }}>
            <option value="">— nenhuma —</option>
            {grade.abertos.map((a) => <option key={a.eventoId} value={a.eventoId}>{br(a.data)} · {a.titulo} ({rotuloGuerra(a.tipo)})</option>)}
          </select>
          {evAberto ? (
            <>
              <span style={{ color: AZUL_CLARO, fontSize: 12.5, fontWeight: 700 }}>{nProv} no rascunho</span>
              <span style={{ color: COR_MARCOU, fontSize: 12.5, fontWeight: 700 }} title="marcaram uma função na chamada do bot desta guerra">{nMarcaram} marcaram no bot</span>
              {/* sem coluna, o M não tem onde aparecer — e some sem explicação nenhuma */}
              {!temColuna && (
                <button onClick={() => ir({ de: evAberto.data, ate: evAberto.data > ate ? evAberto.data : ate })}
                  title="a grade só mostra o período escolhido; esta guerra está fora dele"
                  style={{ borderRadius: 8, border: `1px solid ${COR_MARCOU}`, background: "rgba(224,138,58,.12)", color: COR_MARCOU, padding: "4px 9px", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>
                  ⚠ {br(evAberto.data)} está fora do período — clique pra incluir
                </button>
              )}
              <span className="leg" style={{ color: C.dim, fontSize: 11 }}>
                clique na última coluna. Provisório NÃO escala nem manda DM — ele pinta o card de azul no pool da escalação.
              </span>
            </>
          ) : (
            <span className="leg" style={{ color: C.dim, fontSize: 11 }}>escolha uma guerra aberta pra habilitar a coluna de rascunho</span>
          )}
        </div>

        <div className="rolx" style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface }}>
          <table className="gp" style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: C.inputBg }}>
                <th className="fixa" style={{ padding: "7px 10px", textAlign: "left", color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, whiteSpace: "nowrap" }}>
                  Nome da Família
                </th>
                {grade.colunas.map((c) => (
                  <th key={c.eventoId} style={{ padding: "5px 4px", minWidth: 54, whiteSpace: "nowrap" }}
                    title={`${c.titulo} · ${rotuloGuerra(c.tipo)} · ${c.status}${c.temWar ? "" : " · sem estatística"}`}>
                    <div style={{ color: c.status === "finalizado" ? C.mute : C.amarelo, fontSize: 11, fontWeight: 700 }}>{diaDaSemana(c.data)}</div>
                    <div style={{ color: C.dim, fontSize: 10 }}>{br(c.data)}</div>
                  </th>
                ))}
                {evAberto && (
                  <th style={{ padding: "5px 8px", minWidth: 70, whiteSpace: "nowrap", borderLeft: `2px solid ${AZUL}` }}>
                    <div style={{ color: AZUL_CLARO, fontSize: 11, fontWeight: 700 }}>PROVISÓRIO</div>
                    <div style={{ color: C.dim, fontSize: 10 }}>{evAberto.titulo}</div>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const on = ehProv(l.chave, l.provisorio);
                return (
                  <tr key={l.chave} style={{ borderTop: `1px solid ${C.borderSoft}` }}>
                    <td className="fixa" style={{ padding: "4px 10px", whiteSpace: "nowrap" }}>
                      <span style={{ color: C.texto, fontWeight: 600 }}>{l.familia}</span>
                      <span style={{ color: C.dim, fontSize: 10.5 }}> ({l.jogou})</span>
                      {!guilda && <span style={{ color: C.dim, fontSize: 10 }}> {l.guilda}</span>}
                    </td>
                    {l.celulas.map((e, i) => (
                      <td key={grade.colunas[i].eventoId} style={cel}>
                        <div style={{ display: "flex", justifyContent: "center" }}>
                          {/* o M só na coluna da guerra ESCOLHIDA pro provisório: é nela que a
                              pergunta "quem avisou que vem?" está sendo feita agora */}
                          <Quadrado estado={e} m={grade.colunas[i].eventoId === eventoProvisorio && l.marcouBot}
                            titulo={`${l.familia} · ${grade.colunas[i].titulo}: ${rotulo(e, grade.colunas[i])}${grade.colunas[i].eventoId === eventoProvisorio && l.marcouBot ? " — marcou no bot" : ""}`} />
                        </div>
                      </td>
                    ))}
                    {evAberto && (
                      <td style={{ ...cel, borderLeft: `2px solid ${AZUL}` }}>
                        <button onClick={() => alternar(l)} disabled={!canEdit || salvando === l.chave} className="tap"
                          title={on ? "tirar do provisório" : "marcar como provisório"}
                          style={{ width: 44, height: 22, borderRadius: 6, cursor: canEdit ? "pointer" : "default",
                            border: `1px solid ${on ? AZUL : C.border2}`, background: on ? AZUL_FUNDO : "transparent",
                            color: on ? AZUL_CLARO : C.dim, fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>
                          {on ? "✓" : "–"}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!linhas.length && (
                <tr><td colSpan={grade.colunas.length + (evAberto ? 2 : 1)} style={{ padding: 22, textAlign: "center", color: C.dim }}>
                  Nenhum jogador — confira o filtro de guilda e o período.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* a legenda é a MESMA do card, desenhada com o mesmo componente */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12, color: C.mute, fontSize: 11.5 }}>
          {LEGENDA.map((e) => (
            <span key={e} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Quadrado estado={e} titulo={ESTADO[e].rot} /> {ESTADO[e].rot}
            </span>
          ))}
          {/* o M é uma CAMADA por cima do estado, não um estado — por isso vem depois, com um
              quadrado qualquer de exemplo em vez de cor própria na fileira */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Quadrado estado="jogou" m titulo="marcou no bot" /> marcou no bot (só na guerra escolhida)
          </span>
        </div>
        <p className="leg" style={{ color: C.dim, fontSize: 11, marginTop: 8 }}>
<b>M</b> dentro do quadradinho = marcou uma função na chamada do bot. Aparece <b>só na coluna da guerra escolhida
          no seletor de provisório</b>, e por cima de qualquer estado — inclusive onde a cor esconde a marcação: quem
          marcou e jogou fica verde, e aí só o M conta que ele tinha avisado.{" "}
          O número entre parênteses depois do nome é quantas vezes a pessoa JOGOU no período. Eventos ainda abertos entram
          na grade — diferente do histórico do card, que só mostra guerra fechada; aqui o que interessa é o que está em andamento.
        </p>
      </div>
    </div>
  );
}
