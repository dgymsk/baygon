"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { C, CorResultado } from "@/lib/theme";
import { iconeUrl, type GuildEntry } from "@/lib/guild";
import { TIERS, corTier, type Tier } from "@/lib/tier";
import ConfirmacaoBoard from "./ConfirmacaoBoard";
import StatsWar from "./StatsWar";
import ApagarEvento from "./ApagarEvento";
import ChamadasLog from "./ChamadasLog";
import type { LoteResumo } from "@/lib/loteDM";
import AutoSync from "@/app/confirmados/AutoSync";
import type { EstadoWar, HistoricoJogador, HistoricoSemana } from "@/lib/historicoSemana";
// captura das estatísticas de combate: o MESMO componente do /eventos, reaproveitado no hub
import ResultadoExtrair, { type StatIniciais } from "@/app/eventos/[uuid]/ResultadoExtrair";

/**
 * Tela do evento. A escalação é o coração: à esquerda o pool AGRUPADO POR FUNÇÃO (a função que a
 * pessoa marcou no bot — uma por rodada), à direita uma coluna por PARTY IN-GAME. Arrastar move
 * da função pra party; a party é onde ela joga de fato.
 *
 * São DUAS confirmações, com sinais distintos:
 *   FUNDO verde + ✔  = aceitou a escalação na DM (recusar tira da PT sozinho);
 *   BORDA verde       = apareceu in-game (o checkbox final);
 *   🎮                = não respondeu a DM MAS já está in-game — resolvido, não cobre;
 *   ⏳                = DM enviada, aguardando resposta;
 *   ✉                = escalado mas ainda NÃO convocado;
 *   nome rubro + ✖   = respondeu que NÃO vai; volta pro pool, num grupo separado no fim.
 * Brilho DOURADO = lendário (nunca chega ao bot); ⚠ N = guerras seguidas marcando e não jogando.
 */

/**
 * Verde e rubro DE VERDADE, fora da paleta do site: nela `C.verde`, `C.vermelho` e `C.verdeTint`
 * são todos o mesmo carmesim (#cc0000), o que aqui inverteria o significado — "está tudo certo"
 * saía pintado de alarme. Mesma exceção que `CorResultado` já abre pra vitória/derrota.
 */
const VERDE = CorResultado.vitoria.cor;
const RUBRO = CorResultado.derrota.cor;

export type JogadorVM = {
  chave: string; familia: string; userId: string;
  guilda: string | null; classe: string | null; gs: number | null;
  ap: number | null; aap: number | null; dp: number | null; nWars: number | null;
  lendario: boolean; confirmouIngame: boolean; jogou: boolean | null;
  escaladoEm: number | null;
  confirmouEscalacao: boolean | null; // resposta da DM: null = não respondeu, false = recusou
  convidado: boolean;                 // a DM já saiu? separa "não chamado" de "chamado e calado"
  faltas: number | null;          // guerras seguidas marcando e não jogando
  diasSemJogar: number | null;    // "faz N dias" é mais concreto que "N guerras"
  diasDesdeFalta: number | null;
  funcaoNome: string | null;      // a que ele marcou no bot (útil depois de escalado)
  // carimbos do funil — é o "quando" de cada passo, e o que responde "quem chegou primeiro"
  marcouEm: string | null;        // clicou participar no bot
  ordem: number | null;           // posição na fila de chegada
  convidadoEm: string | null;     // DM de convocação enviada
  respondeuEm: string | null;     // respondeu a DM (aceitou ou recusou)
  ingameEm: string | null;        // apareceu na conferência in-game
  ordemPt: number | null;         // posição DENTRO da PT — 0 é o líder
  filler: boolean;                // apareceu in-game sem ter marcado na chamada
  semana: HistoricoJogador;       // 6 node wars + a siege (ver lib/historicoSemana)
};

/** Pokébola — só no site, nunca no bot. SVG inline pra não depender de emoji nem de CDN. */
function Pokebola({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ flexShrink: 0, verticalAlign: "-2px" }} aria-label="lendário">
      <circle cx="16" cy="16" r="15" fill="#f2f2f2" stroke="#111" strokeWidth="2" />
      <path d="M1 16a15 15 0 0 1 30 0z" fill="#e0322e" stroke="#111" strokeWidth="2" />
      <line x1="1" y1="16" x2="31" y2="16" stroke="#111" strokeWidth="3" />
      <circle cx="16" cy="16" r="5" fill="#f2f2f2" stroke="#111" strokeWidth="2.5" />
    </svg>
  );
}
/**
 * Tipo próprio pro arraste de COLUNA. Existe porque `dataTransfer.getData` não pode ser lido
 * durante o dragover (só no drop) — mas `types` pode. É o que permite ao card se calar antes de
 * virar alvo, em vez de descobrir tarde demais que quem estava sendo arrastado era uma PT.
 */
/** Rótulos do público de disparo — espelham lib/loteDM.ROTULO_PUBLICO, que é quem manda no servidor. */
const ROTULOS_PUBLICO: Record<string, string> = {
  nao_receberam: "quem ainda não recebeu",
  sem_resposta: "quem não respondeu",
  todos: "todos os escalados",
  confirmou_nao_recebeu: "confirmou e não recebeu",
  confirmou: "quem confirmou o SIM",
  faltam_ingame: "quem falta aparecer in-game",
  calados_nao_receberam: "calados que não receberam",
  calados: "todos os calados",
};
const PUBLICOS_CONV = ["nao_receberam", "sem_resposta", "todos"] as const;
const PUBLICOS_INGAME = ["confirmou_nao_recebeu", "confirmou", "faltam_ingame"] as const;
const PUBLICOS_INTENCAO = ["calados_nao_receberam", "calados"] as const;
const seletorPublico = { background: C.inputBg, color: C.mute, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "4px 6px", fontSize: 11.5, fontFamily: "inherit", cursor: "pointer", maxWidth: 175 } as const;

const TIPO_PT = "application/x-pt";
const arrastandoPT = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(TIPO_PT);

export type GrupoVM = { funcaoId: number | null; nome: string; emoji: string | null; jogadores: JogadorVM[] };
export type PartyVM = { id: number; nome: string; icone: string | null };
// titulo já vem com COALESCE(titulo, tipo) pra exibir; tituloRaw é o valor CRU, que distingue
// "sem nome" de "chamado de nodewar" — é ele que abre no campo de renomear, senão o primeiro
// clique gravaria "nodewar" como nome de verdade e não haveria como voltar a não ter nome.
type Ev = { uuid: string; titulo: string; tituloRaw: string | null;
  /** teto de vagas DESTE evento; null = segue o da chamada (tamanhoMaxPreset) */
  tamanhoMax: number | null; tamanhoMaxPreset: number | null;
  /** a MENSAGEM do bot está fechada pra novas marcações — nada a ver com o status do evento */
  intencaoFechada: boolean;
  tipo: string; tier: Tier | null; exigeRegistro: boolean; data: string; status: string; resultado: string | null; temWar: boolean; eventoId: number; messageId: string | null; warId: number | null; presetId: number | null };
export type EvLink = { uuid: string; titulo: string; data: string; status: string };
export type PresetLite = { id: number; nome: string; tipo: string };

export default function EventoBoard({
  evento, grupos, parties, envolvidos, canEdit, podeApagar = false, podeRenomear = false, guildas, emojisClasse = {}, temChamada = true,
  vizinhos = [], presets = [], playersNomes = [], statsIniciais = [], aliancasIniciais = [],
  catalogoParties = [], partiesProprias = false, chamadas = [], warsSemana = { nodewars: [], siege: null, porChave: new Map() }, foraDaRegua = [],
}: {
  evento: Ev | null; grupos: GrupoVM[]; parties: PartyVM[]; envolvidos: JogadorVM[]; canEdit: boolean; guildas: GuildEntry[];
  podeApagar?: boolean; // staff, SEM o gate de status: evento fechado também tem que poder sumir
  podeRenomear?: boolean; // idem: consertar o nome de uma war passada é o caso mais comum de renomear
  emojisClasse?: Record<string, string>; // classe → emoji do Discord (o Shai é o que se procura de relance)
  temChamada?: boolean; // false = evento sem bot: o pool é o elenco, não quem marcou
  vizinhos?: EvLink[]; presets?: PresetLite[]; playersNomes?: string[]; statsIniciais?: StatIniciais[]; aliancasIniciais?: string[];
  catalogoParties?: PartyVM[];   // TODAS as PTs cadastradas — as colunas são um subconjunto disto
  partiesProprias?: boolean;     // o evento tem lista própria, ou está seguindo a da chamada?
  chamadas?: LoteResumo[];       // histórico de disparos de DM deste evento
  warsSemana?: HistoricoSemana;  // quais guerras cada casinha representa, na mesma ordem
  foraDaRegua?: string[];        // quem já está fora das médias desta war
}) {
  const router = useRouter();
  const [aba, setAba] = useState<"escalacao" | "presenca" | "stats" | "chamadas">("escalacao");
  const [local, setLocal] = useState<Record<string, number | null>>({});
  const [sobre, setSobre] = useState<number | "pool" | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [sincronizou, setSincronizou] = useState(false);
  const [envio, setEnvio] = useState<EnvioVM | null>(null);   // relatório de entrega das DMs
  const [aviso, setAviso] = useState("");                      // recado simples (mensagem de canal)
  const [renomeando, setRenomeando] = useState<string | null>(null); // null = não está editando o nome
  const [nomeOtimista, setNomeOtimista] = useState<string | null>(null);
  const [salvandoNome, setSalvandoNome] = useState(false);
  const [ptsOtimista, setPtsOtimista] = useState<number[] | null>(null);
  const [publicoConv, setPublicoConv] = useState("nao_receberam");
  const [publicoIntencao, setPublicoIntencao] = useState("calados_nao_receberam");
  const [publicoIngame, setPublicoIngame] = useState("confirmou_nao_recebeu");
  // grupos dobrados à mão no pool. Sobrevive ao auto-refresh e a escalar gente, ao contrário de
  // depender do <details> não controlado, que remontava junto com o grupo
  const [fechados, setFechados] = useState<Record<string, boolean>>({});
  const [busca, setBusca] = useState("");
  // posição otimista dentro da PT enquanto o servidor não confirma — mesma ideia do arrastar entre PTs
  const [ordemLocal, setOrdemLocal] = useState<Record<string, number>>({});
  const byId = useMemo(() => new Map(guildas.map((g) => [g.id, g])), [guildas]);
  // a lista vem do mais recente pro mais antigo → "próximo" é o de cima
  const iAtual = vizinhos.findIndex((v) => v.uuid === evento?.uuid);
  const proximo = iAtual > 0 ? vizinhos[iAtual - 1] : null;
  const anterior = iAtual >= 0 && iAtual < vizinhos.length - 1 ? vizinhos[iAtual + 1] : null;

  const todos = useMemo(() => {
    const m = new Map<string, JogadorVM>();
    for (const g of grupos) for (const j of g.jogadores) m.set(j.chave, j);
    for (const j of envolvidos) if (!m.has(j.chave)) m.set(j.chave, j);
    return m;
  }, [grupos, envolvidos]);

  /**
   * O estado otimista do arrastar vale só enquanto DISCORDA do servidor. Ele é descartado na
   * leitura, não num efeito que limpa depois: senão o override seria eterno e passaria por cima do
   * que chega do auto-refresh — a recusa de alguém na DM, ou o remanejo de outra pessoa da staff,
   * nunca apareceriam nesta aba.
   */
  const overrides = useMemo(() => {
    const n: Record<string, number | null> = {};
    for (const [chave, v] of Object.entries(local)) {
      const j = todos.get(chave);
      if (!j || j.escaladoEm !== v) n[chave] = v; // servidor ainda não confirmou → mantém o local
    }
    return n;
  }, [local, todos]);
  const ordemOverrides = useMemo(() => {
    const n: Record<string, number> = {};
    for (const [chave, v] of Object.entries(ordemLocal)) {
      const j = todos.get(chave);
      if (!j || j.ordemPt !== v) n[chave] = v;   // servidor ainda não confirmou → mantém o local
    }
    return n;
  }, [ordemLocal, todos]);
  const partyDe = (j: JogadorVM) => (j.chave in overrides ? overrides[j.chave] : j.escaladoEm);
  /** As colunas de hoje, na ordem. A ordem otimista só vale enquanto DISCORDA do servidor —
   *  descartar na leitura (e não num efeito) evita que ela sobreviva ao auto-refresh de 20s. */
  const ptsServidor = parties.map((p) => p.id);
  const ptsAtuais = ptsOtimista && ptsOtimista.join() !== ptsServidor.join() ? ptsOtimista : ptsServidor;
  const partiesOrdenadas = ptsAtuais.map((id) => parties.find((p) => p.id === id)).filter((p): p is PartyVM => !!p);
  const nPool = grupos.reduce((n, g) => n + g.jogadores.length, 0);
  const casaBusca = (j: JogadorVM) => !busca.trim() || j.familia.toLowerCase().includes(busca.trim().toLowerCase());
  const naParty = (id: number) => [...todos.values()].filter((j) => partyDe(j) === id)
    .sort((a, x) => (ordemOverrides[a.chave] ?? a.ordemPt ?? 1e9) - (ordemOverrides[x.chave] ?? x.ordemPt ?? 1e9)
      || a.familia.localeCompare(x.familia, "pt-BR"));
  const nEscalados = [...todos.values()].filter((j) => partyDe(j) != null).length;
  /**
   * Recusou a convocação na DM: saiu da PT e volta pro pool NUM GRUPO PRÓPRIO, não misturado com
   * quem nunca foi chamado. A diferença é grande na hora de remontar: um disse que não vem, o outro
   * ainda não foi perguntado.
   *
   * Fica fora dos grupos por função (o filtro `livres` exclui recusa) pra não aparecer duas vezes.
   */
  const recusados = [...todos.values()]
    .filter((j) => partyDe(j) == null && j.confirmouEscalacao === false && casaBusca(j))
    .sort((a, b) => a.familia.localeCompare(b.familia, "pt-BR"));

  /**
   * PÚBLICO do disparo. A régua que faltava era NÃO RECEBEU (≠ não respondeu): quem recebeu a DM e
   * ficou calado já foi cobrado, e reenviar pra ele é spam — o caso vira comum quando o Discord
   * limita o bot e o lote sai pela metade.
   *
   * Quem já recebeu sai do HISTÓRICO de chamadas (`chamadas`), a mesma fonte que o servidor usa —
   * assim o número no botão é o mesmo que vai ser disparado, e não uma estimativa.
   */
  const recebeu = (tipo: "convocacao" | "ingame") =>
    new Set(chamadas.filter((l) => l.tipo === tipo).flatMap((l) => l.alvos.filter((a) => a.status === "ok").map((a) => a.familia)));
  const jaRecebeuConv = recebeu("convocacao");
  const jaRecebeuIngame = recebeu("ingame");
  const escaladosVivos = [...todos.values()].filter((j) => partyDe(j) != null);
  const alvosConv = escaladosVivos.filter((j) =>
    publicoConv === "todos" ? true
      : publicoConv === "sem_resposta" ? j.confirmouEscalacao == null
      : !j.convidado && !jaRecebeuConv.has(j.familia));
  const alvosIngame = escaladosVivos.filter((j) =>
    publicoIngame === "faltam_ingame" ? j.confirmouEscalacao !== false && !j.confirmouIngame
      : publicoIngame === "confirmou" ? j.confirmouEscalacao === true
      : j.confirmouEscalacao === true && !jaRecebeuIngame.has(j.familia));

  /** Teto efetivo: o do EVENTO manda, e sem ele vale o da chamada. */
  const tetoVagas = evento?.tamanhoMax ?? evento?.tamanhoMaxPreset ?? null;
  const vagasLivres = tetoVagas != null ? tetoVagas - nEscalados : 0;
  const corVagas = tetoVagas == null ? C.verde : vagasLivres < 0 ? C.vermelho : vagasLivres === 0 ? C.amarelo : C.verde;

  /**
   * Quantos escalados cada guilda está pondo na guerra, e quantos deles são lendários.
   * Calculado na leitura (sem useMemo) porque depende de `partyDe`, que muda com o arraste otimista
   * — uma lista de dependências aqui erraria em silêncio e o placar ficaria congelado.
   */
  const porGuilda = (() => {
    const m = new Map<string | null, { total: number; lendarios: number }>();
    for (const j of todos.values()) {
      if (partyDe(j) == null) continue;
      const k = j.guilda || null;
      const v = m.get(k) ?? { total: 0, lendarios: 0 };
      v.total++;
      if (j.lendario) v.lendarios++;
      m.set(k, v);
    }
    return [...m.entries()]
      .map(([id, v]) => ({ id, nome: (id && byId.get(id)?.nome) || "sem guilda", ...v }))
      .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"));
  })();

  /** Teto de vagas desta guerra. Vazio volta a seguir o da chamada. */
  async function trocarTeto(valor: string) {
    if (!podeRenomear || !evento) return;
    const n = valor.trim() ? Math.trunc(Number(valor)) : null;
    const alvo = n != null && Number.isFinite(n) && n > 0 ? n : null;
    if (alvo === evento.tamanhoMax) return;
    setSalvando(true);
    try { await api({ acao: "evento-tamanho", eventoId: evento.eventoId, tamanhoMax: alvo }); setErro(""); router.refresh(); }
    catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }
  const nAceitaram = [...todos.values()].filter((j) => partyDe(j) != null && j.confirmouEscalacao === true).length;
  /**
   * "Aguardando" agora ignora quem já está IN-GAME. Quem apareceu no jogo respondeu de fato a
   * pergunta que a DM fazia — deixá-lo na fila de cobrança inflava o número e mandava a staff atrás
   * de gente que já estava lá. Eles saem para `nIngameSemDm`, que é um estado resolvido.
   */
  const semDm = (j: JogadorVM) => partyDe(j) != null && j.confirmouEscalacao == null && !j.confirmouIngame;
  const nAguardando = [...todos.values()].filter((j) => semDm(j) && j.convidado).length;
  const nSemConvocar = [...todos.values()].filter((j) => semDm(j) && !j.convidado).length;
  const nIngameSemDm = [...todos.values()].filter((j) => partyDe(j) != null && j.confirmouEscalacao == null && j.confirmouIngame).length;
  // o contador da cobrança in-game virou `alvosIngame`, que segue o público escolhido no seletor

  async function api(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error((d.error as string) ?? `erro ${res.status}`);
    return d;
  }

  async function mover(chave: string, partyId: number | null) {
    if (!canEdit || !evento) return;
    const j = todos.get(chave);
    if (!j || partyDe(j) === partyId) return;
    setLocal((s) => ({ ...s, [chave]: partyId }));
    setSalvando(true);
    try {
      await api({ acao: "escalar", eventoId: evento.eventoId, ops: [{ familia: j.familia, partyId }] });
      setErro(""); router.refresh();
    } catch (e) {
      setErro((e as Error).message);
      setLocal((s) => { const n = { ...s }; delete n[chave]; return n; });
    } finally { setSalvando(false); }
  }

  async function togglePresenca(j: JogadorVM) {
    if (!canEdit || !evento) return;
    try { await api({ acao: "presenca-manual", eventoId: evento.eventoId, familia: j.familia, participar: !j.confirmouIngame }); router.refresh(); }
    catch (e) { setErro((e as Error).message); }
  }

  /** Redesenha a mensagem do bot no canal com o estado atual — não muda dado, só reescreve. */
  /**
   * Renomear o evento. É um estado de edição explícito (null = não editando) em vez de um input
   * sempre ligado ao título: esta tela se recarrega sozinha a cada 20s, e um campo controlado pela
   * prop apagaria o que estivesse sendo digitado no meio do refresh.
   *
   * O `editandoRef` existe porque Enter fecha o campo e o blur dispara logo atrás: sem ele, o mesmo
   * nome seria gravado duas vezes (o state ainda não atualizou dentro do mesmo tique).
   *
   * O `baseRef` guarda o nome de quando o campo ABRIU. É contra ele que se decide se houve edição —
   * comparar com o valor atual da prop transformaria "abri e cliquei fora" numa gravação sempre que
   * outra pessoa renomeasse no meio, desfazendo o trabalho dela em silêncio.
   *
   * `salvandoNome` é separado do `salvando` geral de propósito: o blur dispara no mousedown, e um
   * estado compartilhado desabilitaria a barra de botões antes do clique chegar — o clique sumia.
   */
  const editandoRef = useRef(false);
  const baseRef = useRef("");
  const abrirRenome = () => {
    if (!podeRenomear || !evento) return;
    editandoRef.current = true;
    baseRef.current = evento.tituloRaw ?? "";
    setRenomeando(baseRef.current);
  };
  const cancelarRenome = () => { editandoRef.current = false; setRenomeando(null); };

  async function renomear(novo: string) {
    if (!evento || !editandoRef.current) return;
    const t = novo.trim();
    if (t === baseRef.current) { cancelarRenome(); return; } // nada digitado: nem requisição, nem espelho
    const atual = evento.tituloRaw ?? "";
    if (atual !== baseRef.current && !confirm(`Outra pessoa renomeou para "${evento.titulo}". Gravar "${t || evento.tipo}" por cima?`)) {
      cancelarRenome();
      return;
    }
    editandoRef.current = false;
    setRenomeando(null);
    setNomeOtimista(t || evento.tipo); // mostra o nome novo na hora: o refresh do servidor demora
    setSalvandoNome(true);
    try { await api({ acao: "evento-renomear", eventoId: evento.eventoId, titulo: t }); setErro(""); router.refresh(); }
    catch (e) {
      // devolve o texto digitado em vez de engolir: o erro mais provável é sessão vencida, e
      // perder o nome inteiro por causa disso é o pior desfecho possível
      setErro((e as Error).message);
      setNomeOtimista(null);
      editandoRef.current = true;
      setRenomeando(novo);
    }
    finally { setSalvandoNome(false); }
  }

  async function sincronizar() {
    if (!evento) return;
    setSalvando(true);
    try {
      if (!evento.messageId) return;
      await api({ acao: "sync", messageId: evento.messageId });
      setErro(""); setSincronizou(true); setTimeout(() => setSincronizou(false), 2500);
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  /**
   * Manda a DM de convocação pros escalados. Por padrão só pra quem ainda não respondeu, pra
   * reenviar não incomodar quem já confirmou.
   */
  /**
   * Dispara um envio de DM em LOTE e acompanha até o fim.
   *
   * O envio é fatiado no servidor (lib/loteDM): esta função abre o lote e chama o processamento em
   * laço, cada rodada mandando um punhado. É o que permite mostrar o placar enquanto acontece — e o
   * que impede a requisição única de morrer no meio numa escalação grande, deixando parte das DMs
   * enviadas sem relatório nenhum.
   *
   * O estado de cada pessoa fica no banco, então fechar a aba no meio não reenvia pra quem já
   * recebeu: é só disparar de novo que ele continua de onde parou.
   */
  async function enviarLote(tipo: "convocacao" | "ingame" | "intencao", acao: string, publico: string) {
    if (!canEdit || !evento) return;
    setSalvando(true);
    setEnvio({ acao, enviados: 0, falhas: [], total: 0, pendentes: 0, concluido: false });
    try {
      const criar = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "dm-criar", tipo, eventoId: evento.eventoId, publico }) });
      const c = await criar.json().catch(() => ({}));
      if (!criar.ok) throw new Error((c as { error?: string }).error ?? `erro ${criar.status}`);
      const { loteId, total } = c as { loteId: number; total: number };
      setEnvio({ acao, enviados: 0, falhas: [], total, pendentes: total, concluido: false });

      // uma rodada, com retentativa: 502/504 do gateway são passageiros e o lote é retomável — o
      // que já saiu está gravado, então insistir nunca reenvia pra quem recebeu
      const rodada = async () => {
        let ultimo = "";
        for (let t = 0; t < 3; t++) {
          try {
            const pr = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ acao: "dm-processar", loteId }) });
            const p = await pr.json().catch(() => ({}));
            if (pr.ok) return p as { total: number; enviados: number; pendentes: number; concluido: boolean; falhasDetalhe: EnvioVM["falhas"]; log?: EnvioVM["log"] };
            ultimo = (p as { error?: string }).error ?? `erro ${pr.status}`;
          } catch (e) { ultimo = (e as Error).message; }
          await new Promise((r) => setTimeout(r, 1500 * (t + 1)));
        }
        throw new Error(ultimo || "falha no envio");
      };

      // teto de segurança no laço; e um freio se o envio parar de andar, pra não girar à toa
      let feitosAntes = -1, parado = 0;
      for (let i = 0; i < 1000; i++) {
        const prog = await rodada();
        setEnvio({ acao, enviados: prog.enviados, falhas: prog.falhasDetalhe ?? [], total: prog.total, pendentes: prog.pendentes, concluido: prog.concluido, log: prog.log });
        if (prog.concluido) break;
        const feitos = prog.total - prog.pendentes;
        if (feitos === feitosAntes) {
          if (++parado >= 4) throw new Error("o envio travou sem avançar — o Discord deve estar limitando o bot. O que já saiu está salvo; tente de novo em alguns minutos.");
        } else parado = 0;
        feitosAntes = feitos;
      }
      setErro(""); router.refresh();
    } catch (e) {
      // preserva o que já foi enviado na tela: o lote continua no banco e pode ser retomado
      setEnvio((v) => (v ? { ...v, concluido: true, erro: (e as Error).message } : v));
    }
    finally { setSalvando(false); }
  }

  /**
   * Grava as PTs DESTE evento NA ORDEM DADA — é a ordem das colunas da escalação e a da lista
   * publicada no Discord. Lista vazia apaga a lista própria e volta a seguir a chamada.
   *
   * A ordem otimista existe porque a coluna precisa pular de lugar no mesmo instante em que se
   * solta o arraste: esperar o servidor faria a PT voltar pro lugar antigo por um piscar, que é
   * exatamente o que faz a pessoa achar que não funcionou e arrastar de novo.
   *
   * Depois de gravar, o otimista é RECOLOCADO com o que o servidor devolveu — não com o que a tela
   * mandou. A diferença é o caso de apagar a lista: aí o servidor devolve null (o evento volta a
   * seguir a chamada) e a tela precisa largar o override na hora. Mantendo `[]`, ele nunca mais
   * empataria com a leitura seguinte e a escalação inteira ficava invisível até dar F5.
   */
  async function trocarParties(ids: number[]) {
    if (!canEdit || !evento) return;
    setPtsOtimista(ids);
    setSalvando(true);
    try {
      const d = await api({ acao: "evento-parties", eventoId: evento.eventoId, ids });
      setPtsOtimista(Array.isArray(d.ids) ? (d.ids as number[]) : null);
      setErro("");
      router.refresh();
    }
    catch (e) { setErro((e as Error).message); setPtsOtimista(null); }
    finally { setSalvando(false); }
  }

  /** Liga/desliga uma PT nesta guerra. Entrando, vai pro fim — depois é só arrastar pro lugar. */
  const alternarParty = (id: number) =>
    trocarParties(ptsAtuais.includes(id) ? ptsAtuais.filter((x) => x !== id) : [...ptsAtuais, id]);

  /** Arrastar a coluna: tira a PT de origem e a enfia NA POSIÇÃO da PT sobre a qual foi solta. */
  function moverParty(origem: number, destino: number) {
    if (origem === destino) return;
    const sem = ptsAtuais.filter((x) => x !== origem);
    const i = sem.indexOf(destino);
    if (i < 0) return;
    trocarParties([...sem.slice(0, i), origem, ...sem.slice(i)]);
  }

  /**
   * Fecha (ou reabre) a intenção. Fechado, o bot recusa marcação e a mensagem no canal vira a
   * versão curta — sem a lista nominal e sem botões.
   *
   * O gate é `podeRenomear` (staff, sem o filtro de status) e não `canEdit`: `canEdit` já exige
   * evento aberto, então usar ele aqui deixaria o botão de REABRIR fora do alcance justamente
   * quando é preciso.
   */
  async function fecharIntencao(fechar: boolean) {
    if (!podeRenomear || !evento) return;
    if (!confirm(fechar
      ? "Encerrar a intenção?\n\nO bot para de aceitar marcação NOVA e a mensagem no canal vira um aviso curto, sem a lista.\n\nO resto continua igual: escalar, arrastar PT, convocar por DM, presença e estatística. Quem já marcou continua valendo."
      : "Reabrir a intenção?\n\nA mensagem volta com a lista e os botões, e o pessoal pode marcar de novo.")) return;
    setSalvando(true);
    try {
      const d = await api({ acao: "evento-fechar", eventoId: evento.eventoId, fechar });
      const msgOk = (d as { mensagemAtualizada?: boolean }).mensagemAtualizada !== false;
      setErro("");
      setAviso((fechar ? "🔒 Intenção encerrada — o bot não aceita mais marcação. A escalação segue normal." : "🔓 Intenção reaberta.")
        + (msgOk ? "" : " ⚠ A mensagem no Discord não pôde ser atualizada — use o 🔄."));
      router.refresh();
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  /**
   * Encerra (ou reabre) o EVENTO. Trava tudo — escalação, convocação, presença, estatística — mas a
   * página continua visível pra consulta: o histórico é o motivo de o evento existir depois da war.
   * Diferente de fechar a INTENÇÃO, que só desliga a marcação no bot.
   */
  async function encerrarEvento(encerrar: boolean) {
    if (!podeRenomear || !evento) return;
    if (!confirm(encerrar
      ? "Encerrar o evento?\n\nTudo fica travado: escalação, convocação, presença e estatística. A página continua visível pra consulta, e dá pra reabrir depois."
      : "Reabrir o evento?\n\nVolta a permitir escalar, convocar e gravar estatística.")) return;
    setSalvando(true);
    try { await api({ acao: "evento-encerrar", eventoId: evento.eventoId, encerrar }); setErro(""); setAviso(encerrar ? "🏁 Evento encerrado — tudo travado, tudo visível." : "↩ Evento reaberto."); router.refresh(); }
    catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  /**
   * Cutuca por DM quem ainda não respondeu a CHAMADA (não a escalação). Diferente dos outros dois
   * envios: aqui a pessoa nem foi escalada — o que falta é ela dizer se vai. A DM leva o link direto
   * pra mensagem no canal, senão vira recado ("vai lá marcar") e a pessoa tem que caçar o post.
   */
  async function lembrarIntencao() {
    if (!canEdit || !evento) return;
    if (!evento.messageId) { setErro("Este evento não tem chamada do bot — não há intenção pra cobrar."); return; }
    if (!confirm(`Mandar DM pra quem ainda não respondeu a chamada — ${ROTULOS_PUBLICO[publicoIntencao]}?\n\nA mensagem leva um botão que abre a chamada no canal.`)) return;
    await enviarLote("intencao", "Lembrete de intenção", publicoIntencao);
  }

  async function convocar() {
    if (!canEdit || !evento) return;
    const n = alvosConv.length;
    if (!n) { setErro(`Ninguém em "${ROTULOS_PUBLICO[publicoConv]}".`); return; }
    if (!confirm(`Enviar DM de convocação para ${n} pessoa(s) — ${ROTULOS_PUBLICO[publicoConv]}?`)) return;
    await enviarLote("convocacao", "Convocação", publicoConv);
  }

  /**
   * Cobra o "participar" in-game de quem está escalado e não apareceu na conferência. Diferente da
   * convocação: ali a pergunta é "você vai?", aqui a pessoa já disse que vai e só falta apertar o
   * botão dentro do jogo.
   */
  async function pedirIngame() {
    if (!canEdit || !evento) return;
    const n = alvosIngame.length;
    if (!n) { setErro(`Ninguém em "${ROTULOS_PUBLICO[publicoIngame]}".`); return; }
    if (!confirm(`Mandar DM pedindo pra marcar participar in-game para ${n} pessoa(s) — ${ROTULOS_PUBLICO[publicoIngame]}?`)) return;
    await enviarLote("ingame", "Pedido de participar in-game", publicoIngame);
  }

  /** Publica a escalação no canal da lista. É uma mensagem só por evento, editada a cada vez. */
  async function publicar() {
    if (!canEdit || !evento) return;
    setSalvando(true);
    try {
      const res = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "publicar-lista", eventoId: evento.eventoId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((d as { error?: string }).error ?? `erro ${res.status}`);
      // publicar é mensagem de canal, não DM: não existe "quem não recebeu", então é só um recado
      setAviso((d as { editou?: boolean }).editou ? "📋 lista atualizada no canal" : "📋 lista publicada no canal");
      setErro("");
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  /** Liga/desliga a exigência de cadastro nesta chamada. Vale a partir do próximo clique — quem já
   *  marcou continua marcado, porque a mensagem é editada e não reprocessada. */
  async function trocarRegistro(exige: boolean) {
    if (!canEdit || !evento) return;
    setSalvando(true);
    try { await api({ acao: "evento-registro", eventoId: evento.eventoId, exige }); setErro(""); router.refresh(); }
    catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  /** Troca o tier desta guerra. Fica no evento, não no preset: a mesma chamada serve pra T2 e T3,
   *  e o nó que efetivamente caiu só se sabe na hora. */
  async function trocarTier(tier: string) {
    if (!canEdit || !evento) return;
    setSalvando(true);
    try { await api({ acao: "evento-tier", eventoId: evento.eventoId, tier: tier || null }); setErro(""); router.refresh(); }
    catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  /** Troca a chamada que rege o evento — muda o agrupamento do pool por função. */
  async function trocarPreset(presetId: number) {
    if (!canEdit || !evento || !Number.isFinite(presetId)) return;
    setSalvando(true);
    try { await api({ acao: "preset-do-evento", eventoId: evento.eventoId, presetId }); setErro(""); router.refresh(); }
    catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  async function limpar() {
    if (!canEdit || !evento || !confirm("Tirar todo mundo da escalação?")) return;
    setSalvando(true);
    try { await api({ acao: "escalacao-limpar", eventoId: evento.eventoId }); setLocal({}); router.refresh(); }
    catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  /**
   * Reordena dentro da PT: quem foi arrastado entra ANTES do card em que soltou. Arrastar pra fora
   * do último card é o caso de "quero no fim", tratado pelo alvo da coluna, que já move pra lá.
   *
   * A ordem inteira é reenviada (não só a posição de um): reindexar no servidor a partir da lista
   * final é o que garante 0..n-1 sem buraco, mesmo com dois arrastes seguidos.
   */
  async function reordenar(chaveArrastada: string, partyId: number, chaveAlvo: string) {
    if (!canEdit || !evento || chaveArrastada === chaveAlvo) return;
    const atual = naParty(partyId).map((j) => j.chave);
    const de = atual.indexOf(chaveArrastada);
    const lista = de >= 0 ? atual.filter((c) => c !== chaveArrastada) : atual.slice();
    const para = lista.indexOf(chaveAlvo);
    if (para < 0) return;
    lista.splice(para, 0, chaveArrastada);
    setOrdemLocal((s) => ({ ...s, ...Object.fromEntries(lista.map((c, i) => [c, i])) }));
    // quem vinha de OUTRA PT precisa mudar de party antes de ter posição aqui
    const j = todos.get(chaveArrastada);
    setSalvando(true);
    try {
      if (j && partyDe(j) !== partyId) {
        setLocal((s) => ({ ...s, [chaveArrastada]: partyId }));
        await api({ acao: "escalar", eventoId: evento.eventoId, ops: [{ familia: j.familia, partyId }] });
      }
      await api({ acao: "escalacao-reordenar", eventoId: evento.eventoId, partyId, chaves: lista });
      setErro(""); router.refresh();
    } catch (e) {
      setErro((e as Error).message);
      setOrdemLocal({});
    } finally { setSalvando(false); }
  }

  // o que o card precisa do board. Objeto novo a cada render é de boa: o que não pode mudar de
  // identidade é o TIPO do componente, e ele agora é fixo (escopo de módulo).
  // `partyId` só vem quando o card está DENTRO de uma PT: no pool não há ordem a reordenar,
  // e o card não deve virar alvo de solta.
  const ctx = (j: JogadorVM, partyId?: number, lider?: boolean): CardCtx => ({
    canEdit, byId, escalado: partyDe(j) != null, lider, warsSemana,
    emojiClasse: (j.classe && emojisClasse[j.classe]) || null,
    onFimArraste: () => setSobre(null),
    onTogglePresenca: togglePresenca,
    onSoltarEmCima: canEdit && partyId != null ? (c) => reordenar(c, partyId, j.chave) : undefined,
  });

  const alvo = (id: number | "pool") => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setSobre(id); },
    onDragLeave: () => setSobre((s) => (s === id ? null : s)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setSobre(null);
      const c = e.dataTransfer.getData("text/plain");
      if (!c) return;
      // uma COLUNA arrastada viaja com o prefixo "pt:" — a chave de jogador é slug (letra e número),
      // então nunca contém dois-pontos e os dois arrastes não se confundem
      if (c.startsWith("pt:")) {
        const origem = Number(c.slice(3));
        // id inválido (payload de fora da tela) não pode entrar na lista e virar NaN gravado
        if (id !== "pool" && Number.isInteger(origem) && origem > 0) moverParty(origem, id);
        return;
      }
      mover(c, id === "pool" ? null : id);
    },
  });
  const realce = (id: number | "pool") => (sobre === id ? { borderColor: C.verde, background: C.verdeTint } : {});

  if (!evento) {
    return <Casca><div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 24, color: C.mute }}>Evento não encontrado, ou ele não teve chamada de intenção.</div></Casca>;
  }

  return (
    <Casca>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
        {/* minWidth 0: item de flex não encolhe abaixo do min-content por padrão, e um nome comprido
            sem espaço empurrava os botões pra fora da tela */}
        <div style={{ minWidth: 0 }}>
          {renomeando != null ? (
            // Enter só tira o foco: quem grava é o blur, num caminho só
            <input autoFocus value={renomeando} onChange={(e) => setRenomeando(e.target.value)} maxLength={200}
              placeholder={evento.tipo} title="Enter grava · Esc cancela · vazio volta pro nome padrão do tipo"
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") cancelarRenome(); }}
              // trocar de janela (alt-tab pro Discord) também dispara blur: sem esta guarda o nome
              // pela metade seria gravado E publicado no canal
              onBlur={(e) => { if (document.hasFocus()) renomear(e.target.value); }}
              style={{ ...tituloEstilo, background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "1px 8px", width: 340, maxWidth: "100%", boxSizing: "border-box", outline: "none" }} />
          ) : (
            <h1 onClick={abrirRenome} title={podeRenomear ? "clique pra renomear o evento" : undefined}
              style={{ ...tituloEstilo, cursor: podeRenomear ? "text" : "default", opacity: salvandoNome ? 0.6 : 1 }}>
              {nomeOtimista ?? evento.titulo}
              {podeRenomear && <span style={{ color: C.borderSoft, fontSize: 13, marginLeft: 8, verticalAlign: "middle" }}>✎</span>}
            </h1>
          )}
          <div style={{ color: C.mute, fontSize: 12.5, marginTop: 3 }}>
            {new Date(evento.data).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "2-digit" })} · {evento.tipo}
            {evento.tier && <span style={{ color: corTier[evento.tier], fontWeight: 700 }}> · {evento.tier}</span>}
            {evento.status !== "aberto" && <span style={{ color: C.amarelo }}> · 🔒 {evento.status}</span>}
            {evento.resultado && <span style={{ color: evento.resultado === "vitoria" ? C.verde : C.vermelho }}> · {evento.resultado}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          {salvando && <span style={{ color: C.mute, fontSize: 12 }}>salvando…</span>}
          {sincronizou && <span style={{ color: C.verde, fontSize: 12 }}>✓ mensagem atualizada</span>}
          {canEdit && evento.messageId && (
            <button onClick={sincronizar} disabled={salvando} title="redesenha a mensagem do bot no canal com o estado atual do banco"
              style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: C.verde, padding: "5px 11px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              🔄 Atualizar no Discord
            </button>
          )}
          {/* fecha só a MARCAÇÃO no bot. Escalar, convocar, presença e estatística seguem — por
              isso o estado vem de `intencaoFechada` (a mensagem) e não do status do evento, que é
              o interruptor da operação inteira */}
          {podeRenomear && evento.messageId && (
            <button onClick={() => fecharIntencao(!evento.intencaoFechada)} disabled={salvando}
              title={evento.intencaoFechada
                ? "volta a aceitar marcação e redesenha a mensagem com a lista"
                : "o bot para de aceitar marcação e a mensagem no canal encurta; a escalação continua normal"}
              style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: evento.intencaoFechada ? C.verde : C.amarelo, padding: "5px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              {evento.intencaoFechada ? "🔓 Reabrir intenção" : "🔒 Encerrar intenção"}
            </button>
          )}
          {/* cobrar a INTENÇÃO é o passo anterior à convocação: a chamada está aberta e falta a
              pessoa dizer se vai. Some quando a intenção é encerrada — aí não há o que responder */}
          {canEdit && evento.messageId && !evento.intencaoFechada && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <select value={publicoIntencao} onChange={(e) => setPublicoIntencao(e.target.value)} disabled={salvando}
                title="para quem o lembrete de intenção vai" style={seletorPublico}>
                {PUBLICOS_INTENCAO.map((p) => <option key={p} value={p}>{ROTULOS_PUBLICO[p]}</option>)}
              </select>
              <button onClick={lembrarIntencao} disabled={salvando}
                title="DM pra quem ainda não respondeu a chamada, com link direto pra mensagem no canal"
                style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: C.amarelo, padding: "5px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                ⏳ Cobrar intenção
              </button>
            </span>
          )}
          {/* O público fica AO LADO do botão, não escondido num Shift: a diferença entre "não
              respondeu" e "não recebeu" é a que evita spam, e escolha que ninguém vê ninguém usa.
              O número no botão é o do público escolhido, contado da mesma fonte que o servidor. */}
          {canEdit && nEscalados > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <select value={publicoConv} onChange={(e) => setPublicoConv(e.target.value)} disabled={salvando} title="para quem a convocação vai"
                style={seletorPublico}>
                {PUBLICOS_CONV.map((p) => <option key={p} value={p}>{ROTULOS_PUBLICO[p]}</option>)}
              </select>
              <button onClick={convocar} disabled={salvando || !alvosConv.length} title="DM de confirmação da escalação"
                style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: alvosConv.length ? C.amarelo : C.borderSoft, padding: "5px 11px", fontSize: 12.5, fontWeight: 700, cursor: alvosConv.length ? "pointer" : "not-allowed" }}>
                📨 Convocar ({alvosConv.length})
              </button>
            </span>
          )}
          {canEdit && nEscalados > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <select value={publicoIngame} onChange={(e) => setPublicoIngame(e.target.value)} disabled={salvando} title="para quem a cobrança do participar in-game vai"
                style={seletorPublico}>
                {PUBLICOS_INGAME.map((p) => <option key={p} value={p}>{ROTULOS_PUBLICO[p]}</option>)}
              </select>
              <button onClick={pedirIngame} disabled={salvando || !alvosIngame.length} title="DM pedindo pra marcar participar dentro do jogo"
                style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: alvosIngame.length ? C.amarelo : C.borderSoft, padding: "5px 11px", fontSize: 12.5, fontWeight: 700, cursor: alvosIngame.length ? "pointer" : "not-allowed" }}>
                🎮 Pedir participar ({alvosIngame.length})
              </button>
            </span>
          )}
          {canEdit && nEscalados > 0 && evento.messageId && (
            <button onClick={publicar} disabled={salvando} title="posta/atualiza a escalação no canal da lista (uma mensagem só, editada)"
              style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: C.verde, padding: "5px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              📋 Publicar lista
            </button>
          )}
          {canEdit && nEscalados > 0 && <button onClick={limpar} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.vermelho, padding: "5px 11px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>↺ Limpar</button>}
          <Link className="navlink" href={`/hub/${evento.uuid}/resumo`}>📄 Resumo</Link>
          {podeRenomear && (
            <button onClick={() => encerrarEvento(evento.status !== "finalizado")} disabled={salvando}
              title={evento.status === "finalizado" ? "volta a permitir escalar, convocar e gravar" : "trava tudo, mas a página continua visível pra consulta"}
              style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: evento.status === "finalizado" ? C.verde : C.mute, padding: "5px 11px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              {evento.status === "finalizado" ? "↩ Reabrir evento" : "🏁 Encerrar evento"}
            </button>
          )}
          <Link className="navlink" href="/hub">← Hub</Link>
        </div>
      </div>

      {/* navegação: pular de evento sem voltar ao hub, e trocar a chamada que rege este */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => anterior && router.push(`/hub/${anterior.uuid}`)} disabled={!anterior}
          title={anterior ? `← ${anterior.titulo}` : "é o mais antigo"} style={navBtn(!!anterior)}>‹ anterior</button>
        <select value={evento.uuid} onChange={(e) => router.push(`/hub/${e.target.value}`)}
          style={{ background: C.inputBg, color: C.texto, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "5px 9px", fontSize: 12.5, fontFamily: "inherit", cursor: "pointer", maxWidth: 320 }}>
          {vizinhos.map((v) => <option key={v.uuid} value={v.uuid}>{v.data.slice(0, 10)} · {v.titulo}{v.status !== "aberto" ? ` (${v.status})` : ""}</option>)}
        </select>
        <button onClick={() => proximo && router.push(`/hub/${proximo.uuid}`)} disabled={!proximo}
          title={proximo ? `${proximo.titulo} →` : "é o mais recente"} style={navBtn(!!proximo)}>próximo ›</button>

        {canEdit && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: evento.exigeRegistro ? C.amarelo : C.mute, fontSize: 11.5, cursor: "pointer" }}
              title="quem não fez /register não consegue marcar nesta chamada">
              <input type="checkbox" checked={evento.exigeRegistro} disabled={salvando} onChange={(e) => trocarRegistro(e.target.checked)} />
              só registrados
            </label>
            <span style={{ color: C.mute, fontSize: 11.5 }}>tier:</span>
            <select value={evento.tier ?? ""} onChange={(e) => trocarTier(e.target.value)} disabled={salvando}
              title="porte da guerra — T1, T2 ou T3"
              style={{ background: C.inputBg, color: evento.tier ? corTier[evento.tier] : C.mute, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "4px 8px", fontSize: 12, fontFamily: "inherit", fontWeight: 700, cursor: "pointer" }}>
              <option value="">—</option>
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </span>
        )}
        {canEdit && presets.length > 0 && (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: C.mute, fontSize: 11.5 }}>chamada:</span>
            <select value={evento.presetId ?? ""} onChange={(e) => trocarPreset(Number(e.target.value))} disabled={salvando}
              title="qual chamada rege este evento — muda como o pool é agrupado por função"
              style={{ background: C.inputBg, color: C.texto, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "4px 8px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
              {evento.presetId == null && <option value="">(nenhuma)</option>}
              {presets.map((p) => <option key={p.id} value={p.id}>{p.nome} · {p.tipo}</option>)}
            </select>
          </span>
        )}
      </div>

      {/* PTs DESTA guerra: adicionar ou tirar uma PT amanhã não pode reescrever as guerras de
          ontem, então o evento carrega a própria lista. Sem lista própria, segue a da chamada. */}
      {canEdit && catalogoParties.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          <span style={{ color: C.mute, fontSize: 11.5 }}>PTs desta guerra:</span>
          {catalogoParties.map((x) => {
            const on = ptsAtuais.includes(x.id);
            return (
              <button key={x.id} disabled={salvando} onClick={() => alternarParty(x.id)}
                title={on ? `tirar ${x.nome} desta guerra` : `adicionar ${x.nome} nesta guerra`}
                style={{ cursor: "pointer", borderRadius: 999, border: `1px solid ${on ? C.verde : C.borderSoft}`, background: on ? C.verdeTint : "transparent", color: on ? C.verde : C.mute, padding: "2px 9px", fontSize: 11.5, fontFamily: "inherit" }}>
                {/* <Icone>, não interpolação: o ícone é `<:sata:1483…>` e como texto cru vira o
                    código na tela em vez do emoji */}
                <Icone raw={x.icone} nome={x.nome} /> {x.nome}
              </button>
            );
          })}
          <span style={{ color: C.borderSoft, fontSize: 11 }}>
            {partiesProprias
              ? <>só neste evento · <button onClick={() => trocarParties([])} disabled={salvando} style={{ background: "none", border: "none", color: C.mute, cursor: "pointer", fontSize: 11, textDecoration: "underline", fontFamily: "inherit" }}>voltar a seguir a chamada</button></>
              : "seguindo a chamada — mexer aqui vale só nesta guerra"}
          </span>
        </div>
      )}

      {/* releitura periódica: as respostas da DM chegam pelo Discord, não por esta aba */}
      {evento.status === "aberto" && <AutoSync ms={20000} />}

      {erro && <div style={{ color: C.vermelho, fontSize: 13, marginBottom: 8 }}>⚠ {erro}</div>}
      {aviso && <div style={{ color: C.mute, fontSize: 12.5, marginBottom: 8, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "7px 11px", background: C.inputBg }}>{aviso}</div>}
      {envio && <PainelEnvio envio={envio} onFechar={() => setEnvio(null)} />}

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {([["escalacao", "🧩 Escalação"], ["presenca", "✅ Confirmação"], ["stats", "📊 Estatísticas"], ["chamadas", chamadas.length ? `📨 Chamadas (${chamadas.length})` : "📨 Chamadas"]] as const).map(([k, t]) => (
          <button key={k} onClick={() => setAba(k)} style={{ cursor: "pointer", borderRadius: 8, border: `1px solid ${aba === k ? C.verde : C.border2}`, background: aba === k ? C.verdeTint : "transparent", color: aba === k ? C.verde : C.mute, padding: "6px 13px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" }}>{t}</button>
        ))}
      </div>

      <div style={{ display: aba === "escalacao" ? "block" : "none" }}>{(
        <>
          {/* Placar da guerra: quantas vagas foram preenchidas e de quem são. É a pergunta que a
              staff faz o tempo todo montando a escalação, e a resposta estava diluída numa linha
              de texto corrido. O teto é do EVENTO — o nó de hoje não tem o mesmo limite do de
              ontem, e mexer no da chamada mudaria a régua das guerras passadas. */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "10px 14px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 26, color: corVagas, lineHeight: 1 }}>{nEscalados}</span>
              <span style={{ color: C.mute, fontSize: 15 }}>/</span>
              {podeRenomear ? (
                <input type="number" min={1} max={500} defaultValue={evento.tamanhoMax ?? ""} placeholder={String(tetoVagas ?? "—")}
                  key={`teto-${evento.tamanhoMax ?? "n"}`}
                  title={evento.tamanhoMax != null ? "teto desta guerra — vazio volta a seguir a chamada" : "teto desta guerra — hoje segue o da chamada"}
                  onBlur={(e) => trocarTeto(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  style={{ width: 58, background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: tetoVagas != null ? C.amarelo : C.mute, padding: "2px 6px", fontSize: 17, fontWeight: 700, fontFamily: "'Share Tech Mono', monospace", outline: "none" }} />
              ) : (
                <span style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 22, color: C.amarelo }}>{tetoVagas ?? "—"}</span>
              )}
              <span style={{ color: C.mute, fontSize: 12 }}>
                escalados{tetoVagas != null && <> · {vagasLivres > 0 ? `faltam ${vagasLivres}` : vagasLivres === 0 ? "lotado" : `${-vagasLivres} acima do teto`}</>}
              </span>
            </div>

            {/* quem cada guilda está colocando na guerra. O lendário conta e é destacado: uma guilda
                com 8 dos quais 5 lendários não pesa o mesmo que outra com 8 comuns. */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginLeft: "auto" }}>
              {porGuilda.map((g) => (
                <span key={g.id ?? "sem"} title={`${g.nome}: ${g.total} escalados · ${g.total - g.lendarios} sem lendário`}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, border: `1px solid ${C.border2}`, borderRadius: 999, padding: "2px 9px" }}>
                  <GuildIcon id={g.id} byId={byId} /><span style={{ color: C.mute, fontSize: 11 }}>{g.id ? byId.get(g.id)?.tag ?? g.nome : "sem guilda"}</span>
                  <span style={{ color: C.texto, fontWeight: 700 }}>{g.total}</span>
                  {g.lendarios > 0 && (
                    <span style={{ color: C.amarelo, display: "inline-flex", alignItems: "center", gap: 2 }} title={`${g.lendarios} lendário(s) — ${g.total - g.lendarios} sem eles`}>
                      <Pokebola size={11} />{g.lendarios}
                    </span>
                  )}
                </span>
              ))}
              {!porGuilda.length && <span style={{ color: C.borderSoft, fontSize: 11.5 }}>ninguém escalado ainda</span>}
            </div>
          </div>

          <div style={{ color: C.mute, fontSize: 12, marginBottom: 12 }}>
            <b>{nPool}</b> {temChamada ? "marcaram" : "no elenco"} · <b style={{ color: VERDE }}>{nAceitaram}</b> aceitaram, <b style={{ color: C.amarelo }}>{nAguardando}</b> aguardando, <b style={{ color: C.mute }}>{nSemConvocar}</b> sem convocar
            {nIngameSemDm > 0 && <> · <b style={{ color: VERDE }}>{nIngameSemDm}</b> in-game sem responder</>} ·
            <span style={{ color: C.amarelo }}> pokébola = lendário</span> · <span style={{ color: VERDE }}>fundo verde ✔ = aceitou</span> · <span style={{ color: C.amarelo }}>⏳ aguardando resposta</span> · <span style={{ color: C.borderSoft }}>✉ ainda não convocado</span> · <span style={{ color: VERDE }}>borda verde 🎮</span> = está in-game · <span style={{ color: RUBRO }}>nome rubro ✖</span> = recusou ·
            <span style={{ color: C.laranja }}> ⚠ N</span> = guerras seguidas sem jogar
            {canEdit ? " · arraste da função pra uma party" : " · (só staff edita)"}
          </div>
          {!parties.length ? (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 20, color: C.amarelo, fontSize: 13 }}>
              {evento.presetId == null
                ? (canEdit && presets.length > 0
                    ? <>Este evento não tem chamada associada — escolha uma em <b>chamada:</b> aí em cima e as PTs dela viram as colunas.</>
                    : <>Este evento não tem chamada associada, então não há PTs pra montar. {evento.status === "aberto" ? "Peça pra staff associar uma." : `Evento ${evento.status} — a escalação não é mais editável.`}</>)
                : <>Nenhuma party in-game cadastrada — crie em <Link href="/hub/config" style={{ color: C.verde }}>Definições</Link> pra poder escalar.</>}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(250px, 330px) 1fr", gap: 14, alignItems: "start" }}>
              {/* Pool por FUNÇÃO — GRUDADO no topo e com rolagem PRÓPRIA.
                  Com 70 marcados o pool ficava mais alto que a tela, então arrastar os últimos
                  virava rolar a página até as colunas saírem de vista e soltar às cegas. Preso
                  aqui, as PTs ficam sempre no campo de visão e a rolagem é só da lista.
                  Cabeçalho e busca ficam FORA da área que rola: filtrar é justamente o que se faz
                  quando a lista é longa, e a busca sumindo pra cima seria o pior momento. */}
              <div {...alvo("pool")} style={{ border: `1px dashed ${C.border2}`, borderRadius: 12, background: C.surface, padding: 12, ...realce("pool"),
                position: "sticky", top: 8, maxHeight: "calc(100vh - 34px)", display: "flex", flexDirection: "column", gap: 0 }}>
                <div style={{ color: C.amarelo, fontWeight: 700, fontSize: 13, marginBottom: 9, flex: "none" }}>{temChamada ? "Marcaram, por função" : "Elenco, por função"}</div>
                {/* sem chamada o pool é o elenco inteiro; achar alguém rolando 90 nomes numa coluna
                    de 330px não é viável, então a busca aparece quando o pool cresce */}
                {nPool > 12 && (
                  <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="filtrar por nome…"
                    style={{ width: "100%", boxSizing: "border-box", background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "5px 9px", fontSize: 12, fontFamily: "inherit", outline: "none", marginBottom: 9, flex: "none" }} />
                )}
                {/* minHeight 0: sem isso o item de flex não encolhe abaixo do conteúdo e a rolagem
                    interna nunca aparece — a caixa é que estoura pra fora */}
                {/* scrollbarGutter stable: a barra clássica do Windows come ~15px de DENTRO da
                    caixa, e como `auto` a esconde assim que a lista cabe, escalar gente fazia todo
                    card do pool saltar de largura no meio da sequência de arrastes. Com a calha
                    sempre reservada, a largura não muda. O marginRight negativo devolve o espaço
                    comendo o padding do pool, pra coluna não estreitar por causa disso. */}
                <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", overflowX: "hidden", scrollbarGutter: "stable", paddingLeft: 10, marginLeft: -10, paddingRight: 2, marginRight: -10 }}>
                {grupos.map((g) => {
                  // quem recusou tem grupo próprio no fim do pool — aqui ele sairia duplicado
                  const livres = g.jogadores.filter((j) => partyDe(j) == null && j.confirmouEscalacao !== false && casaBusca(j));
                  // um grupo grande (tipicamente "Sem função", que junta quem não foi classificado)
                  // vira sanfona pra não empurrar os grupos úteis pra fora da tela
                  // chave por NOME quando não há função: dois grupos têm funcaoId null ("Sem função"
                  // e "Filler"), e a chave repetida fazia o React reconciliar o grupo errado
                  const kg = String(g.funcaoId ?? g.nome);
                  // buscar FORÇA aberto sem apagar o que a pessoa dobrou; fora da busca vale o mapa,
                  // e o padrão é grupo grande nascer dobrado
                  const aberto = busca.trim() ? true : !(fechados[kg] ?? livres.length > 12);
                  const cabeca = (
                    <span style={{ color: C.verde, fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <Icone raw={g.emoji} nome={g.nome} /> {g.nome} <span style={{ color: C.mute, fontWeight: 400 }}>{livres.length}</span>
                    </span>
                  );
                  const corpo = (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {livres.map((j) => <Card key={j.chave} j={j} ctx={ctx(j)} />)}
                      {!livres.length && <span style={{ color: C.borderSoft, fontSize: 11.5 }}>{busca.trim() ? "— nada com esse nome —" : "— todos escalados —"}</span>}
                    </div>
                  );
                  return (
                    /* SEMPRE <details>, nunca alternando com uma lista crua: trocar o TIPO do
                       elemento remonta o grupo, e escalar alguém cruza o limiar de 12 no meio do
                       trabalho — a sanfona fechava sozinha e o grupo pulava na tela. */
                    <div key={kg} style={{ marginBottom: 11 }}>
                      <details open={aberto}
                        onToggle={(e) => { if (!busca.trim()) setFechados((s) => ({ ...s, [kg]: !e.currentTarget.open })); }}>
                        <summary style={{ cursor: "pointer", marginBottom: 5 }}>{cabeca}</summary>
                        {corpo}
                      </details>
                    </div>
                  );
                })}
                {!grupos.length && <span style={{ color: C.borderSoft, fontSize: 12 }}>{temChamada ? "Ninguém marcou ainda." : "Nenhum jogador ativo cadastrado."}</span>}

                {/* quem RECUSOU na DM volta pro pool como card de verdade, num grupo próprio: ele
                    saiu da PT mas continua sendo gente que dá pra reescalar (mudou de ideia, sobrou
                    vaga). Como texto riscado não dava pra arrastar de volta, e a recusa parecia
                    definitiva quando não é. */}
                {recusados.length > 0 && (
                  <div style={{ marginBottom: 11, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 9 }}>
                    <div style={{ color: RUBRO, fontSize: 12, fontWeight: 700, marginBottom: 5, display: "flex", alignItems: "center", gap: 5 }}>
                      ❌ Recusaram a convocação <span style={{ color: C.mute, fontWeight: 400 }}>{recusados.length}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {recusados.map((j) => <Card key={j.chave} j={j} ctx={ctx(j)} />)}
                    </div>
                    <div style={{ color: C.borderSoft, fontSize: 10.5, marginTop: 4 }}>Disseram que não vão. Arraste de volta pra uma PT se mudarem de ideia.</div>
                  </div>
                )}
                </div>
              </div>

              {/* colunas = PARTIES IN-GAME */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
                {partiesOrdenadas.map((p) => {
                  const dentro = naParty(p.id);
                  const gss = dentro.map((j) => j.gs).filter((x): x is number => x != null);
                  const media = gss.length ? Math.round(gss.reduce((a, b) => a + b, 0) / gss.length) : null;
                  return (
                    <div key={p.id} {...alvo(p.id)} style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surfaceSolid, padding: 12, minHeight: 92, ...realce(p.id) }}>
                      {/* o CABEÇALHO é a alça de arrastar a coluna. Fica fora da área dos cards de
                          propósito: assim arrastar jogador e arrastar PT nunca disputam o mesmo gesto */}
                      <div draggable={canEdit}
                        // dois formatos: o tipo próprio (legível já no dragover, ver TIPO_PT) e o
                        // text/plain com prefixo, que é o que o drop lê
                        onDragStart={(e) => {
                          e.dataTransfer.setData(TIPO_PT, String(p.id));
                          e.dataTransfer.setData("text/plain", `pt:${p.id}`);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        title={canEdit ? "arraste para trocar a ordem das PTs" : undefined}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 6, cursor: canEdit ? "grab" : "default" }}>
                        <span style={{ color: C.verde, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}>
                          {canEdit && <span style={{ color: C.borderSoft, fontSize: 11, letterSpacing: -1 }}>⠿</span>}
                          <Icone raw={p.icone} nome={p.nome} /> {p.nome}
                        </span>
                        <span style={{ color: C.mute, fontSize: 11 }}>{dentro.length}{media != null ? ` · GS ${media}` : ""}</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {dentro.map((j, i) => <Card key={j.chave} j={j} ctx={ctx(j, p.id, i === 0)} />)}
                        {!dentro.length && <span style={{ color: C.borderSoft, fontSize: 12 }}>arraste alguém aqui</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* a legenda fica no FIM: quem já sabe ler as casinhas não precisa passar por ela toda vez
              que abre a tela, e quem não sabe procura embaixo — que é onde legenda mora */}
          {warsSemana.nodewars.some(Boolean) && <LegendaHistorico />}
        </>
      )}</div>

      <div style={{ display: aba === "presenca" ? "block" : "none" }}>{(
        <ConfirmacaoBoard eventoId={evento.eventoId} canEdit={canEdit} playersNomes={playersNomes} guildas={guildas} ativo={aba === "presenca"}
          alvos={[...todos.values()].sort((a, b) => a.familia.localeCompare(b.familia, "pt-BR")).map((j) => ({
            chave: j.chave, familia: j.familia, guilda: j.guilda, escalado: partyDe(j) != null, confirmouIngame: j.confirmouIngame,
          }))} />
      )}</div>

      <div style={{ display: aba === "stats" ? "block" : "none" }}>{(
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: 14 }}>
          {!evento.temWar && (
            <div style={{ color: C.amarelo, fontSize: 12.5, marginBottom: 12 }}>
              ⚠ Sem estatística da war ainda — é ela que fecha o funil e diz quem realmente jogou. Grave abaixo.
            </div>
          )}
          <StatsWar stats={statsIniciais} contexto={[...todos.values()].map((j) => ({
            chave: j.chave, escalado: partyDe(j) != null, confirmouIngame: j.confirmouIngame,
            party: parties.find((x) => x.id === partyDe(j))?.nome ?? null, lendario: j.lendario,
          }))} aliancas={aliancasIniciais} warId={evento.warId} canEdit={podeRenomear} foraIniciais={foraDaRegua} />

          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
                <Th>Jogador</Th><Th>Escalado</Th><Th>In-game</Th><Th>Jogou</Th><Th>Seq. faltas</Th><Th>Sem jogar</Th>
              </tr>
            </thead>
            <tbody>
              {[...todos.values()].sort((a, b) => a.familia.localeCompare(b.familia)).map((j) => {
                const p = partyDe(j);
                return (
                  <tr key={j.chave} style={{ borderTop: `1px solid ${C.borderSoft}` }}>
                    <Td><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{j.lendario && <Pokebola size={12} />}<span style={{ color: C.texto }}>{j.familia}</span></span></Td>
                    <Td>{p != null ? <span style={{ color: C.verde }}>{parties.find((x) => x.id === p)?.nome ?? "sim"}</span> : "—"}</Td>
                    <Td>{j.confirmouIngame ? <span style={{ color: C.verde }}>✅</span> : "—"}</Td>
                    <Td>{j.jogou == null ? <span style={{ color: C.borderSoft }}>?</span> : j.jogou ? <span style={{ color: C.verde }}>sim</span> : <span style={{ color: C.vermelho }}>não</span>}</Td>
                    <Td>{j.faltas == null ? <span style={{ color: C.borderSoft }}>—</span> : <span style={{ color: j.faltas >= 3 ? C.vermelho : j.faltas > 0 ? C.laranja : C.mute }}>{j.faltas}</span>}</Td>
                    <Td>{j.diasSemJogar == null ? <span style={{ color: C.borderSoft }}>—</span> : <span style={{ color: j.diasSemJogar >= 14 ? C.vermelho : j.diasSemJogar >= 7 ? C.laranja : C.mute }}>{j.diasSemJogar}d</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* captura das estatísticas de combate — MESMO fluxo do /eventos, trazido pra cá */}
          <div style={{ borderTop: `1px solid ${C.borderSoft}`, marginTop: 16, paddingTop: 4 }}>
            <ResultadoExtrair id={evento.eventoId} canEdit={canEdit} players={playersNomes}
              warIdInicial={evento.warId} statsIniciais={statsIniciais} aliancasIniciais={aliancasIniciais}
              ativo={aba === "stats"} />
          </div>
        </div>
      )}</div>

      {/* histórico dos disparos de DM deste evento — quem foi chamado, quem não recebeu e quando */}
      <div style={{ display: aba === "chamadas" ? "block" : "none" }}><ChamadasLog lotes={chamadas} /></div>

      {/* fim da página e faixa própria: colar isso no cabeçalho, ao lado do ↺ Limpar, é justamente
          o clique errado que a gente não pode facilitar. Fora do gate de status: evento travado ou
          finalizado também precisa poder ser apagado. */}
      {podeApagar && evento && (
        <ApagarEvento eventoId={evento.eventoId} titulo={evento.titulo} temChamada={!!evento.messageId} />
      )}
    </Casca>
  );
}

type CardCtx = {
  warsSemana: HistoricoSemana;  // quais guerras cada casinha representa
  canEdit: boolean;
  byId: Map<string, GuildEntry>;
  escalado: boolean;                       // já está numa PT — muda os selos de convocação
  lider?: boolean;                         // primeiro da PT
  emojiClasse?: string | null;             // ícone da classe (Shai é o que se procura de relance)
  onFimArraste: () => void;
  onTogglePresenca: (j: JogadorVM) => void;
  onSoltarEmCima?: (chaveArrastada: string) => void;  // reordenar dentro da PT
};

/**
 * Emoji de classe do Discord ("<:shai:123>") como imagem; unicode renderiza como texto.
 * Usa o `iconeUrl` de lib/guild — é o mesmo resolvedor do ícone de guilda, já testado. Ter uma
 * segunda regex aqui foi o que quebrou: um escape perdido virou /:w+:(d+)/ e o card passou a
 * cuspir o `<:TAMER:15263…>` cru na tela.
 */
function IconeClasse({ raw, nome }: { raw: string; nome: string }) {
  const u = iconeUrl(raw);
  if (u) return <img src={u} alt={nome} title={nome} width={14} height={14}
    style={{ flexShrink: 0, verticalAlign: "-2px" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />;
  return <span title={nome} style={{ fontSize: 12, flexShrink: 0 }}>{raw}</span>;
}

function GuildIcon({ id, byId }: { id: string | null; byId: Map<string, GuildEntry> }) {
  const g = id ? byId.get(id) : null;
  if (!g) return null;
  const u = iconeUrl(g.icone);
  return u ? <img src={u} alt="" width={13} height={13} style={{ borderRadius: 3 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
    : <span style={{ fontSize: 10, color: C.mute }}>{g.tag}</span>;
}

/** Mini-card do jogador, aberto ao passar o mouse no nome. Resume o que decide a escalação. */
/** Onde o mini-card vai aparecer, em coordenadas de TELA (ver o porquê em MiniCard). */
type PosMini = { left: number; top?: number; bottom?: number };

/**
 * O histórico recente ao lado do nome: uma BOLA (a siege mais recente) e SEIS QUADRADOS (as últimas
 * node wars) em duas fileiras de três. A guerra mais recente é sempre o último quadrado de baixo —
 * a fila anda pra esquerda, então a posição não dança de um dia pro outro.
 *
 * Desenhado em SVG, e não com divs: a esta altura (7px por casa) borda, X e anel precisam de
 * controle de subpixel que CSS não dá sem virar borrão.
 *
 * Cada estado tem COR e FORMA. Não é enfeite: a paleta do site tem verde e vermelho no mesmo
 * carmesim, então cor sozinha não distingue nada — e mesmo com cores próprias, quem enxerga mal
 * merece o X e o anel.
 */
const ESTADO: Record<EstadoWar, { fill: string; stroke?: string; marca?: "x" | "o" | "traco"; rot: string }> = {
  jogou:           { fill: "#3fbf5f", rot: "escalado e jogou" },
  jogou_sem_escala:{ fill: "#3f8fe0", rot: "não escalado, mas jogou" },
  marcou:          { fill: "#e08a3a", rot: "marcou e não foi escalado" },
  faltou:          { fill: "#2a1414", stroke: "#e04b4b", marca: "x", rot: "escalado e NÃO compareceu" },
  nao_respondeu:   { fill: "transparent", stroke: "#8f8f8f", marca: "o", rot: "não respondeu a chamada" },
  recusou:         { fill: "#3a3a3a", stroke: "#8f8f8f", marca: "traco", rot: "recusou — avisou que não ia" },
  sem_stat:        { fill: "#2e2e2e", stroke: "#5a5a5a", rot: "escalado, mas a war não teve estatística gravada" },
  sem:             { fill: "#242424", rot: "sem dado" },
};

const rotuloWar = (w: { data: string; titulo: string } | null | undefined) =>
  (w ? `${w.data.slice(8, 10)}/${w.data.slice(5, 7)} · ${w.titulo}` : "sem guerra nesta posição");

/** Uma casa: quadrado (node war) ou círculo (siege), com a marca por cima quando o estado pede. */
function Casa({ e, x, y, l, circulo }: { e: EstadoWar; x: number; y: number; l: number; circulo?: boolean }) {
  const s = ESTADO[e] ?? ESTADO.sem;
  const m = l / 2;
  return (
    <g>
      {circulo
        ? <circle cx={x + m} cy={y + m} r={m - 0.4} fill={s.fill} stroke={s.stroke ?? "rgba(0,0,0,.5)"} strokeWidth={s.stroke ? 1 : 0.6} />
        : <rect x={x} y={y} width={l} height={l} rx={1.2} fill={s.fill} stroke={s.stroke ?? "rgba(0,0,0,.5)"} strokeWidth={s.stroke ? 1 : 0.6} />}
      {s.marca === "x" && (
        <g stroke="#e04b4b" strokeWidth={1.1} strokeLinecap="round">
          <line x1={x + 1.7} y1={y + 1.7} x2={x + l - 1.7} y2={y + l - 1.7} />
          <line x1={x + l - 1.7} y1={y + 1.7} x2={x + 1.7} y2={y + l - 1.7} />
        </g>
      )}
      {s.marca === "o" && <circle cx={x + m} cy={y + m} r={m - 2} fill="none" stroke="#8f8f8f" strokeWidth={1} />}
      {s.marca === "traco" && <line x1={x + 1.8} y1={y + m} x2={x + l - 1.8} y2={y + m} stroke="#8f8f8f" strokeWidth={1.1} strokeLinecap="round" />}
    </g>
  );
}

/**
 * A legenda das casinhas, desenhada com o MESMO componente que o card usa.
 *
 * Nada de descrever a forma em texto ("quadrado cinza com traço"): a pessoa compara o desenho da
 * legenda com o desenho do card e pronto. É também o único jeito honesto de explicar a diferença
 * entre o traço e o O — os dois são cinzas, e o que os separa é o que a pessoa FEZ.
 */
const LEGENDA: { e: EstadoWar; texto: string }[] = [
  { e: "jogou", texto: "escalado e jogou" },
  { e: "jogou_sem_escala", texto: "jogou sem estar escalado" },
  { e: "faltou", texto: "escalado e não compareceu" },
  { e: "marcou", texto: "marcou e não foi escalado" },
  { e: "recusou", texto: "recusou — avisou que não ia" },
  { e: "nao_respondeu", texto: "não respondeu a chamada" },
  { e: "sem_stat", texto: "escalado, war sem estatística" },
  { e: "sem", texto: "sem dado (ou não estava no bot)" },
];

function LegendaHistorico() {
  return (
    <div style={{ marginTop: 14, border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "10px 14px" }}>
      <div style={{ color: C.mute, fontSize: 11, marginBottom: 8 }}>
        <b style={{ color: C.texto }}>Histórico ao lado do ✅</b> — a <b>bola</b> é a siege mais recente e os <b>6 quadrados</b> são as
        últimas node wars, da mais antiga (canto superior esquerdo) pra mais recente (canto inferior direito).
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px" }}>
        {LEGENDA.map(({ e, texto }) => (
          <span key={e} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: C.mute }}>
            <svg width={11} height={11} viewBox="0 0 11 11" style={{ flexShrink: 0, display: "block" }}>
              <Casa e={e} x={0.5} y={0.5} l={10} />
            </svg>
            {texto}
          </span>
        ))}
      </div>
      <div style={{ color: C.borderSoft, fontSize: 10.5, marginTop: 7 }}>
        O <b>traço</b> e o <b>O</b> são os dois cinzas e não querem dizer a mesma coisa: traço é quem <b>respondeu que não ia</b> —
        avisou, dá pra contar com isso. O <b>O</b> é quem ficou <b>calado</b>, tendo o bot à disposição. Já o quadrado escuro é
        ausência de informação: ninguém deve nada ali — inclusive quem se registrou depois daquela guerra.
      </div>
    </div>
  );
}

function Historico({ h, wars }: { h: HistoricoJogador; wars: HistoricoSemana }) {
  if (!h.nodewars.length) return null;
  const L = 7, G = 1.6;               // lado da casa e respiro
  const bola = 11;
  const x0 = bola + 3;                // os quadrados começam depois da bola
  const larg = x0 + L * 3 + G * 2;
  const alt = L * 2 + G;
  return (
    <svg width={larg} height={alt} viewBox={`0 0 ${larg} ${alt}`} style={{ flexShrink: 0, display: "block" }}
      aria-label="histórico recente">
      <title>
        {`siege: ${rotuloWar(wars.siege)} — ${h.siege ? ESTADO[h.siege].rot : "sem siege registrada"}`}
      </title>
      {h.siege && <Casa e={h.siege} x={0} y={(alt - bola) / 2} l={bola} circulo />}
      {!h.siege && <circle cx={bola / 2} cy={alt / 2} r={bola / 2 - 0.4} fill={ESTADO.sem.fill} stroke="rgba(0,0,0,.5)" strokeWidth={0.6} />}
      {h.nodewars.map((e, i) => {
        const col = i % 3, lin = Math.floor(i / 3);
        return (
          <g key={i}>
            <Casa e={e} x={x0 + col * (L + G)} y={lin * (L + G)} l={L} />
            {/* um <title> por casa: o SVG mostra o do elemento sob o cursor */}
            <rect x={x0 + col * (L + G)} y={lin * (L + G)} width={L} height={L} fill="transparent">
              <title>{`${rotuloWar(wars.nodewars[i])} — ${(ESTADO[e] ?? ESTADO.sem).rot}`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}

function MiniCard({ j, pos, wars }: { j: JogadorVM; pos: PosMini; wars: HistoricoSemana }) {
  return (
  /**
   * `position: fixed`, e não `absolute`: o pool agora é um container com `overflow`, e um
   * descendente absoluto cujo bloco contêiner está DENTRO do scroller é recortado por ele — z-index
   * não fura recorte. Como o card abria PRA CIMA, ele sumia por inteiro nos primeiros nomes da lista,
   * que é justamente onde se olha GS e faltas pra decidir quem escalar.
   *
   * Fixo escapa do recorte (nenhum ancestral tem transform/filter, que criariam bloco contêiner), à
   * custa de precisar da posição na tela — medida no hover, em `onMouseEnter`.
   */
  <div style={{
    position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, zIndex: 60, minWidth: 210,
    border: `1px solid ${j.lendario ? C.amarelo : C.border2}`, borderRadius: 10, background: C.bg0,
    boxShadow: "0 8px 26px rgba(0,0,0,.7)", padding: "9px 11px", cursor: "default", pointerEvents: "none",
    display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: C.mute,
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 5, color: C.texto, fontSize: 13, fontWeight: 700 }}>
      {j.lendario && <Pokebola size={14} />}{j.familia}
    </div>
    {/* o mesmo histórico do card, em tamanho de leitura, com a legenda do que cada casa quer dizer */}
    {j.semana.nodewars.length > 0 && (
      <div style={{ display: "flex", alignItems: "center", gap: 7, paddingBottom: 2 }}>
        <Historico h={j.semana} wars={wars} />
        <span style={{ color: C.borderSoft, fontSize: 10 }}>bola = siege · quadrados = node wars</span>
      </div>
    )}
    <Linha k="Classe" v={j.classe ?? "—"} />
    <Linha k="GS" v={j.gs != null ? String(j.gs) : "—"} />
    {(j.ap != null || j.aap != null || j.dp != null) && <Linha k="AP / AAP / DP" v={`${j.ap ?? "—"} / ${j.aap ?? "—"} / ${j.dp ?? "—"}`} />}
    {j.funcaoNome && <Linha k="Marcou" v={j.funcaoNome} />}
    <Linha k="Wars com stat" v={j.nWars != null ? String(j.nWars) : "—"} />
    <div style={{ borderTop: `1px solid ${C.borderSoft}`, marginTop: 2, paddingTop: 4 }}>
      {j.diasSemJogar != null
        ? <Linha k="Sem jogar" v={`${j.diasSemJogar} dia(s)`} cor={j.diasSemJogar >= 14 ? C.vermelho : j.diasSemJogar >= 7 ? C.laranja : C.verde} />
        : <Linha k="Sem jogar" v="nunca jogou no período" cor={C.mute} />}
      {j.faltas != null && j.faltas > 0 && <Linha k="Marcou e faltou" v={`${j.faltas} war(s) seguidas`} cor={j.faltas >= 3 ? C.vermelho : C.laranja} />}
      {j.diasDesdeFalta != null && <Linha k="Última falta" v={`há ${j.diasDesdeFalta} dia(s)`} />}
    </div>
    {/* quando cada passo aconteceu — é o que responde "quem chegou primeiro" na hora de priorizar */}
    {(j.marcouEm || j.convidadoEm || j.respondeuEm || j.ingameEm) && (
      <div style={{ borderTop: `1px solid ${C.borderSoft}`, marginTop: 2, paddingTop: 4 }}>
        {j.marcouEm && <Linha k={j.ordem != null ? `Marcou (#${j.ordem})` : "Marcou"} v={quando(j.marcouEm)} cor={C.texto} />}
        {j.convidadoEm && <Linha k="Convocado" v={quando(j.convidadoEm)} />}
        {j.respondeuEm && <Linha k={j.confirmouEscalacao === false ? "Recusou" : "Confirmou"} v={quando(j.respondeuEm)} cor={j.confirmouEscalacao === false ? RUBRO : VERDE} />}
        {j.ingameEm && <Linha k="In-game" v={quando(j.ingameEm)} cor={VERDE} />}
      </div>
    )}
  </div>
  );
}

/**
 * Card do jogador. Vive no ESCOPO DO MÓDULO, não dentro do board: definido lá dentro, o React
 * trataria cada render como um tipo novo e remontaria todos os cards — o mini-card do hover fechava
 * sozinho a cada releitura automática (de 20 em 20s), a cada arraste e a cada salvamento, e não
 * reabria sem tirar e devolver o mouse.
 */
function Card({ j, ctx }: { j: JogadorVM; ctx: CardCtx }) {
  const { canEdit, byId, escalado, lider, emojiClasse, onFimArraste, onTogglePresenca, onSoltarEmCima } = ctx;
  // respondeu NÃO na DM. Só vale fora da PT: se você o arrastou de volta pra uma coluna depois de
  // conversar, quem manda é a decisão da staff — o card volta ao normal em vez de acusar a recusa.
  const recusou = j.confirmouEscalacao === false && !escalado;
  // posição do mini-card na TELA, medida na hora do hover — ele é `fixed` pra escapar do recorte
  // do pool rolável (ver MiniCard), e fixo não herda a posição do card
  const [hover, setHover] = useState<PosMini | null>(null);
  const [alvo, setAlvo] = useState(false);   // outro card sendo arrastado por cima deste
  const setHoverFalse = () => setHover(null);
  return (
    <div
      draggable={canEdit}
      // quem está sendo arrastado viaja no próprio evento (dataTransfer), não num ref: o ref
      // seria lido no meio do render dos alvos, e o React avisa com razão que isso não atualiza
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", j.chave); setHoverFalse(); }}
      onDragEnd={onFimArraste}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        // abre pra cima; sem espaço lá (card no topo da lista), vira pra baixo em vez de sair da tela
        const paraBaixo = r.top < 250;
        setHover(paraBaixo
          ? { left: r.left, top: r.bottom + 6 }
          : { left: r.left, bottom: window.innerHeight - r.top + 6 });
      }}
      onMouseLeave={setHoverFalse}
      // soltar EM CIMA de um card insere antes dele. stopPropagation pra o alvo da coluna não
      // tratar isso como "jogar no fim" logo em seguida.
      //
      // Quando o que está sendo arrastado é uma COLUNA, o card se cala inteiro: sem preventDefault
      // ele deixa de ser alvo de solta e o browser entrega o drop pra coluna, que é quem sabe
      // reordenar. Cortar a propagação aqui (mesmo checando o payload depois) engolia o arraste —
      // e como os cards ocupam quase toda a área da coluna, reordenar PT quase nunca funcionava.
      // O teste é em `types` porque `getData` não é legível durante o dragover.
      {...(onSoltarEmCima ? {
        onDragOver: (e: React.DragEvent) => {
          if (arrastandoPT(e)) return;
          e.preventDefault(); e.stopPropagation(); setAlvo(true);
        },
        onDragLeave: () => setAlvo(false),
        onDrop: (e: React.DragEvent) => {
          if (arrastandoPT(e)) return;
          e.preventDefault(); e.stopPropagation(); setAlvo(false); setHoverFalse();
          const c = e.dataTransfer.getData("text/plain");
          if (c) onSoltarEmCima(c);
        },
      } : {})}
      style={{
        position: "relative",
        /**
         * Duas confirmações, dois sinais: FUNDO = aceitou a escalação (DM); BORDA = apareceu
         * in-game. Lendário manda no contorno (dourado + brilho) por ser atributo fixo.
         *
         * VERDE DE VERDADE, e não `C.verde`: nesta paleta `C.verde` é #cc0000 — o mesmo carmesim do
         * `C.vermelho`. Quem estava escalado e marcou participar in-game ganhava uma borda VERMELHA
         * dizendo "está tudo certo", e a tela lia como alarme. É a coisa mais lida do card; tinha
         * que ser a cor que a pessoa espera.
         *
         * Recusou na DM: nome rubro e contorno rubro — este SIM é o alerta.
         */
        border: `1px solid ${j.lendario ? C.amarelo : recusou ? RUBRO : j.confirmouIngame ? VERDE : C.border2}`,
        boxShadow: j.lendario ? "0 0 10px rgba(214,178,42,.5)" : "none",
        background: recusou ? "rgba(204,0,0,.14)"
          : j.confirmouEscalacao === true ? "rgba(63,191,95,.20)"
          : j.confirmouIngame ? "rgba(63,191,95,.10)" : C.inputBg,
        borderRadius: 9, padding: "6px 9px", cursor: canEdit ? "grab" : "default",
        // linha no topo marca onde o card vai entrar
        boxSizing: "border-box", borderTop: alvo ? `3px solid ${VERDE}` : undefined,
        display: "flex", alignItems: "center", gap: 6, fontSize: 12.5,
      }}
    >
      {lider && <span title="líder da PT" style={{ fontSize: 11, flexShrink: 0 }}>👑</span>}
      {j.lendario && <Pokebola />}
      {recusou && <span style={{ color: RUBRO, fontSize: 11 }} title="respondeu que NÃO vai — saiu da PT">✖</span>}
      {j.confirmouEscalacao === true && <span style={{ color: VERDE, fontSize: 11 }} title="confirmou a escalação na DM">✔</span>}
      {/* estar IN-GAME responde na prática a pergunta que o ⏳ fazia: quem já apareceu no jogo não
          está "aguardando resposta", está lá. Mostrar os dois virava alarme em quem está tranquilo */}
      {escalado && j.confirmouEscalacao == null && !j.confirmouIngame && (j.convidado
        ? <span style={{ color: C.amarelo, fontSize: 11 }} title="DM enviada — aguardando resposta">⏳</span>
        : <span style={{ color: C.borderSoft, fontSize: 11 }} title="ainda não foi convocado">✉</span>)}
      {escalado && j.confirmouEscalacao == null && j.confirmouIngame && (
        <span style={{ color: VERDE, fontSize: 11 }} title="não respondeu a DM, mas já está in-game — está resolvido">🎮</span>
      )}
      {/* recusou e a staff o arrastou de volta pra uma PT: o card volta ao normal (quem manda é a
          decisão de agora), mas fica a marca — senão ele ficaria sem sinal NENHUM, indistinguível
          de quem nunca foi convocado, e ainda consta como "não vou" na resposta gravada */}
      {escalado && j.confirmouEscalacao === false && (
        <span style={{ color: C.laranja, fontSize: 11 }} title="tinha recusado na DM e foi reescalado — confirme com ele">↩</span>
      )}
      <GuildIcon id={j.guilda} byId={byId} />
      <span style={{ color: recusou ? RUBRO : C.texto, fontWeight: 600, whiteSpace: "nowrap", textDecoration: recusou ? "line-through" : undefined }}>{j.familia}</span>
      {emojiClasse
        ? <IconeClasse raw={emojiClasse} nome={j.classe ?? ""} />
        : j.classe && <span style={{ color: C.mute, fontSize: 11, whiteSpace: "nowrap" }}>{j.classe}</span>}
      {j.gs != null && <span style={{ color: C.amarelo, fontSize: 11 }}>{j.gs}</span>}
      {/* veio in-game sem ter marcado: dá pra escalar, mas não estava previsto */}
      {j.filler && <span title="Filler — apareceu in-game sem marcar na chamada" style={{ color: C.vermelho, fontSize: 9, flexShrink: 0 }}>🔴</span>}

      {/* indicadores à direita: "faz N dias" pesa mais do que a contagem crua de guerras */}
      <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5 }}>
        {/* o passado recente encostado na borda, ao lado do tick de presença: é onde o olho já vai
            pra conferir quem está pronto, e aqui ele não empurra o nome nem a classe */}
        {j.semana.nodewars.length > 0 && <Historico h={j.semana} wars={ctx.warsSemana} />}
        {j.diasSemJogar != null && j.diasSemJogar >= 7 && (
          <span title={`Não joga há ${j.diasSemJogar} dias`}
            style={{ fontSize: 10, fontWeight: 700, color: j.diasSemJogar >= 14 ? C.vermelho : C.laranja }}>
            {j.diasSemJogar}d
          </span>
        )}
        {j.faltas != null && j.faltas > 0 && (
          <span title={`Marcou e não jogou nas ${j.faltas} últimas wars`}
            style={{ fontSize: 10, fontWeight: 700, color: j.faltas >= 3 ? C.vermelho : C.laranja }}>
            ⚠{j.faltas}
          </span>
        )}
        {canEdit && (
          <button onClick={() => onTogglePresenca(j)} title={j.confirmouIngame ? "desmarcar confirmação in-game" : "marcar confirmado in-game"}
            style={{ background: "none", border: "none", cursor: "pointer", color: j.confirmouIngame ? C.verde : C.borderSoft, fontSize: 12, padding: "0 2px" }}>
            {j.confirmouIngame ? "✅" : "◻"}
          </button>
        )}
      </span>
      {hover && <MiniCard j={j} pos={hover} wars={ctx.warsSemana} />}
    </div>
  );
}

function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>{children}</div>
    </div>
  );
}
/** Carimbo legível: hoje mostra só a hora, outro dia mostra o dia junto — numa war que vira a
 *  madrugada "23:58" e "00:04" sem data confundem mais do que informam. */
function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions = { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" };
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const dia = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return dia === hoje ? d.toLocaleTimeString("pt-BR", opts) : `${dia.slice(0, 5)} ${d.toLocaleTimeString("pt-BR", opts)}`;
}

const Linha = ({ k, v, cor }: { k: string; v: string; cor?: string }) => (
  <span style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
    <span style={{ color: "#8f8f8f" }}>{k}</span><span style={{ color: cor ?? "#e5e5e5" }}>{v}</span>
  </span>
);
export type EnvioVM = {
  acao: string; enviados: number;
  falhas: { familia: string; userId: string | null; motivo: string }[];
  log?: { postou: boolean; erro?: string };
  total?: number; pendentes?: number; concluido?: boolean; erro?: string;
};

/** Barra de progresso do envio em lote — enquanto as DMs saem de poucas em poucas. */
function BarraEnvio({ envio }: { envio: EnvioVM }) {
  const total = envio.total ?? 0;
  const feitos = envio.enviados + envio.falhas.length;
  const pct = total ? Math.round((feitos / total) * 100) : 0;
  return (
    <div style={{ marginTop: 7 }}>
      <div style={{ height: 6, borderRadius: 999, background: C.borderSoft, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: C.verde, transition: "width .3s" }} />
      </div>
      <div style={{ color: C.mute, fontSize: 11.5, marginTop: 4 }}>
        {feitos}/{total} · <span style={{ color: C.verde }}>{envio.enviados} ok</span>
        {envio.falhas.length ? <> · <span style={{ color: C.amarelo }}>{envio.falhas.length} falhou</span></> : null}
        {envio.pendentes ? <> · {envio.pendentes} na fila</> : null}
      </div>
    </div>
  );
}

/**
 * Resultado de um envio em lote de DM. O número de enviados não é a informação importante — quem
 * NÃO recebeu é. DM do Discord falha calado (bloqueou o bot, desligou DM do servidor, nunca rodou
 * /register), e sem esta lista a staff só descobre na hora da guerra, com a vaga vazia.
 *
 * Agrupado por motivo porque a ação é por motivo: "cinco com DM fechada" se resolve avisando no
 * canal; "dois sem /register" se resolve mandando registrar.
 */
function PainelEnvio({ envio, onFechar }: { envio: EnvioVM; onFechar: () => void }) {
  const falhas = envio.falhas ?? [];
  const porMotivo = new Map<string, typeof falhas>();
  for (const f of falhas) porMotivo.set(f.motivo, [...(porMotivo.get(f.motivo) ?? []), f]);
  const rodando = envio.concluido === false;
  const cor = envio.erro ? C.vermelho : rodando ? C.mute : falhas.length ? C.amarelo : C.verde;

  return (
    <div style={{ marginBottom: 8, border: `1px solid ${cor}`, borderRadius: 10, padding: "9px 12px", background: C.inputBg }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: cor, fontWeight: 700, fontSize: 13 }}>📨 {envio.acao}</span>
        <span style={{ color: C.mute, fontSize: 12.5 }}>
          {rodando
            ? "enviando…"
            : <>{envio.enviados} recebeu(ram)
                {falhas.length ? <span style={{ color: C.amarelo, fontWeight: 700 }}> · {falhas.length} NÃO recebeu(ram)</span> : " · ninguém ficou de fora"}</>}
        </span>
        {!rodando && <button onClick={onFechar} style={{ marginLeft: "auto", background: "none", border: "none", color: C.mute, cursor: "pointer", fontSize: 12 }}>✕ fechar</button>}
      </div>

      {envio.total != null && <BarraEnvio envio={envio} />}
      {envio.erro && <div style={{ color: C.vermelho, fontSize: 12.5, marginTop: 6 }}>⚠ {envio.erro}</div>}

      {[...porMotivo.entries()].map(([motivo, quem]) => (
        <div key={motivo} style={{ marginTop: 6, fontSize: 12.5 }}>
          <span style={{ color: C.amarelo }}>⚠ {motivo} — {quem.length}</span>
          <div style={{ color: C.texto, marginTop: 2 }}>{quem.map((q) => q.familia).join(" · ")}</div>
        </div>
      ))}

      {!rodando && (
        <div style={{ color: C.borderSoft, fontSize: 11, marginTop: 7 }}>
          {envio.log?.postou
            ? "registrado no canal de log do Discord"
            : `⚠ NÃO foi registrado no log${envio.log?.erro ? ` — ${envio.log.erro}` : ""}`}
        </div>
      )}
    </div>
  );
}

// o mesmo desenho no <h1> e no campo de renomear — trocar de um pro outro não pode mexer no layout
const tituloEstilo = { fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 24, letterSpacing: 1, margin: 0, color: C.amarelo, overflowWrap: "anywhere" } as const;

const navBtn = (on: boolean) => ({
  cursor: on ? "pointer" : "not-allowed", opacity: on ? 1 : 0.35,
  borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.mute,
  padding: "5px 10px", fontSize: 12, fontFamily: "inherit",
} as const);
const Th = ({ children }: { children: React.ReactNode }) => <th style={{ textAlign: "left", padding: "7px 11px", fontWeight: 600 }}>{children}</th>;
const Td = ({ children }: { children: React.ReactNode }) => <td style={{ padding: "6px 11px", color: C.mute }}>{children}</td>;

function Icone({ raw, nome }: { raw: string | null; nome: string }) {
  const m = (raw ?? "").match(/^<a?:\w+:(\d+)>$/);
  if (m) return <img src={`https://cdn.discordapp.com/emojis/${m[1]}.png`} alt="" width={14} height={14} style={{ verticalAlign: "-2px", borderRadius: 3 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />;
  if (raw) return <span style={{ fontSize: 13 }}>{raw}</span>;
  return <span style={{ fontSize: 10, color: "#8f8f8f" }}>{nome.slice(0, 2).toUpperCase()}</span>;
}
