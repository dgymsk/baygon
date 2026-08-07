"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { iconeUrl, type GuildEntry } from "@/lib/guild";
import { TIERS, corTier, type Tier } from "@/lib/tier";
import ConfirmacaoBoard from "./ConfirmacaoBoard";
import StatsWar from "./StatsWar";
import ApagarEvento from "./ApagarEvento";
import AutoSync from "@/app/confirmados/AutoSync";
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
 *   ⏳                = DM enviada, aguardando resposta;
 *   ✉                = escalado mas ainda NÃO convocado.
 * Brilho DOURADO = lendário (nunca chega ao bot); ⚠ N = guerras seguidas marcando e não jogando.
 */
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
export type GrupoVM = { funcaoId: number | null; nome: string; emoji: string | null; jogadores: JogadorVM[] };
export type PartyVM = { id: number; nome: string; icone: string | null };
// titulo já vem com COALESCE(titulo, tipo) pra exibir; tituloRaw é o valor CRU, que distingue
// "sem nome" de "chamado de nodewar" — é ele que abre no campo de renomear, senão o primeiro
// clique gravaria "nodewar" como nome de verdade e não haveria como voltar a não ter nome.
type Ev = { uuid: string; titulo: string; tituloRaw: string | null; tipo: string; tier: Tier | null; exigeRegistro: boolean; data: string; status: string; resultado: string | null; temWar: boolean; eventoId: number; messageId: string | null; warId: number | null; presetId: number | null };
export type EvLink = { uuid: string; titulo: string; data: string; status: string };
export type PresetLite = { id: number; nome: string; tipo: string };

export default function EventoBoard({
  evento, grupos, parties, envolvidos, canEdit, podeApagar = false, podeRenomear = false, guildas, emojisClasse = {}, temChamada = true,
  vizinhos = [], presets = [], playersNomes = [], statsIniciais = [], aliancasIniciais = [], recusaram = [],
  catalogoParties = [], partiesProprias = false,
}: {
  evento: Ev | null; grupos: GrupoVM[]; parties: PartyVM[]; envolvidos: JogadorVM[]; canEdit: boolean; guildas: GuildEntry[];
  podeApagar?: boolean; // staff, SEM o gate de status: evento fechado também tem que poder sumir
  podeRenomear?: boolean; // idem: consertar o nome de uma war passada é o caso mais comum de renomear
  emojisClasse?: Record<string, string>; // classe → emoji do Discord (o Shai é o que se procura de relance)
  temChamada?: boolean; // false = evento sem bot: o pool é o elenco, não quem marcou
  vizinhos?: EvLink[]; presets?: PresetLite[]; playersNomes?: string[]; statsIniciais?: StatIniciais[]; aliancasIniciais?: string[]; recusaram?: string[];
  catalogoParties?: PartyVM[];   // TODAS as PTs cadastradas — as colunas são um subconjunto disto
  partiesProprias?: boolean;     // o evento tem lista própria, ou está seguindo a da chamada?
}) {
  const router = useRouter();
  const [aba, setAba] = useState<"escalacao" | "presenca" | "stats">("escalacao");
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
  // as colunas de hoje: é o que o toggle marca/desmarca
  const ptsAtuais = parties.map((p) => p.id);
  const nPool = grupos.reduce((n, g) => n + g.jogadores.length, 0);
  const casaBusca = (j: JogadorVM) => !busca.trim() || j.familia.toLowerCase().includes(busca.trim().toLowerCase());
  const naParty = (id: number) => [...todos.values()].filter((j) => partyDe(j) === id)
    .sort((a, x) => (ordemOverrides[a.chave] ?? a.ordemPt ?? 1e9) - (ordemOverrides[x.chave] ?? x.ordemPt ?? 1e9)
      || a.familia.localeCompare(x.familia, "pt-BR"));
  const nEscalados = [...todos.values()].filter((j) => partyDe(j) != null).length;
  const nAceitaram = [...todos.values()].filter((j) => partyDe(j) != null && j.confirmouEscalacao === true).length;
  const nAguardando = [...todos.values()].filter((j) => partyDe(j) != null && j.confirmouEscalacao == null && j.convidado).length;
  const nSemConvocar = [...todos.values()].filter((j) => partyDe(j) != null && j.confirmouEscalacao == null && !j.convidado).length;
  // escalado que ainda não apareceu na conferência in-game — o alvo da cobrança
  const nSemIngame = [...todos.values()].filter((j) => partyDe(j) != null && j.confirmouEscalacao !== false && !j.confirmouIngame).length;

  async function api(body: Record<string, unknown>) {
    const res = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `erro ${res.status}`);
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
  async function enviarLote(tipo: "convocacao" | "ingame", acao: string, soNovos = true) {
    if (!canEdit || !evento) return;
    setSalvando(true);
    setEnvio({ acao, enviados: 0, falhas: [], total: 0, pendentes: 0, concluido: false });
    try {
      const criar = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "dm-criar", tipo, eventoId: evento.eventoId, soNovos }) });
      const c = await criar.json().catch(() => ({}));
      if (!criar.ok) throw new Error((c as { error?: string }).error ?? `erro ${criar.status}`);
      const { loteId, total } = c as { loteId: number; total: number };
      setEnvio({ acao, enviados: 0, falhas: [], total, pendentes: total, concluido: false });

      // teto de segurança no laço: um lote de 8 dá 1000×8 = 8000 pessoas, muito além do real
      for (let i = 0; i < 1000; i++) {
        const pr = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ acao: "dm-processar", loteId }) });
        const p = await pr.json().catch(() => ({}));
        if (!pr.ok) throw new Error((p as { error?: string }).error ?? `erro ${pr.status}`);
        const prog = p as { total: number; enviados: number; pendentes: number; concluido: boolean; falhasDetalhe: EnvioVM["falhas"]; log?: EnvioVM["log"] };
        setEnvio({ acao, enviados: prog.enviados, falhas: prog.falhasDetalhe ?? [], total: prog.total, pendentes: prog.pendentes, concluido: prog.concluido, log: prog.log });
        if (prog.concluido) break;
      }
      setErro(""); router.refresh();
    } catch (e) {
      // preserva o que já foi enviado na tela: o lote continua no banco e pode ser retomado
      setEnvio((v) => (v ? { ...v, concluido: true, erro: (e as Error).message } : v));
    }
    finally { setSalvando(false); }
  }

  /**
   * Troca as PTs DESTE evento. Lista vazia apaga a lista própria e volta a seguir a chamada.
   *
   * A ordem importa: é a ordem das colunas na escalação, e é a mesma da lista publicada. Manter a
   * ordem do catálogo (e não a de clique) evita que a coluna pule de lugar a cada toggle.
   */
  async function trocarParties(ids: number[]) {
    if (!canEdit || !evento) return;
    const ordenados = catalogoParties.map((x) => x.id).filter((id) => ids.includes(id));
    setSalvando(true);
    try { await api({ acao: "evento-parties", eventoId: evento.eventoId, ids: ordenados }); setErro(""); router.refresh(); }
    catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  async function convocar(soNovos: boolean) {
    if (!canEdit || !evento) return;
    const alvo = soNovos ? "quem ainda não respondeu" : "TODOS os escalados (inclusive quem já respondeu)";
    if (!confirm(`Enviar DM de confirmação para ${alvo}?`)) return;
    await enviarLote("convocacao", "Convocação", soNovos);
  }

  /**
   * Cobra o "participar" in-game de quem está escalado e não apareceu na conferência. Diferente da
   * convocação: ali a pergunta é "você vai?", aqui a pessoa já disse que vai e só falta apertar o
   * botão dentro do jogo.
   */
  async function pedirIngame() {
    if (!canEdit || !evento) return;
    if (!confirm(`Mandar DM pedindo pra marcar participar in-game?

Vai pra quem está escalado e ainda não apareceu na conferência (${nSemIngame}).`)) return;
    await enviarLote("ingame", "Pedido de participar in-game");
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
    canEdit, byId, escalado: partyDe(j) != null, lider,
    emojiClasse: (j.classe && emojisClasse[j.classe]) || null,
    onFimArraste: () => setSobre(null),
    onTogglePresenca: togglePresenca,
    onSoltarEmCima: canEdit && partyId != null ? (c) => reordenar(c, partyId, j.chave) : undefined,
  });

  const alvo = (id: number | "pool") => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setSobre(id); },
    onDragLeave: () => setSobre((s) => (s === id ? null : s)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setSobre(null); const c = e.dataTransfer.getData("text/plain"); if (c) mover(c, id === "pool" ? null : id); },
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
          {canEdit && nEscalados > 0 && (
            <button onClick={() => convocar(true)} disabled={salvando} title="manda DM pros escalados que ainda não responderam; segure Shift pra reenviar a todos"
              onMouseDown={(e) => { if (e.shiftKey) { e.preventDefault(); convocar(false); } }}
              style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: C.amarelo, padding: "5px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              📨 Convocar {nSemConvocar + nAguardando > 0 ? `(${nSemConvocar + nAguardando})` : "escalados"}
            </button>
          )}
          {canEdit && nSemIngame > 0 && (
            <button onClick={pedirIngame} disabled={salvando} title="DM pra quem está escalado e ainda não apareceu na conferência in-game"
              style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: C.amarelo, padding: "5px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              🎮 Pedir participar ({nSemIngame})
            </button>
          )}
          {canEdit && nEscalados > 0 && evento.messageId && (
            <button onClick={publicar} disabled={salvando} title="posta/atualiza a escalação no canal da lista (uma mensagem só, editada)"
              style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: C.verde, padding: "5px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              📋 Publicar lista
            </button>
          )}
          {canEdit && nEscalados > 0 && <button onClick={limpar} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.vermelho, padding: "5px 11px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>↺ Limpar</button>}
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
              <button key={x.id} disabled={salvando} onClick={() => trocarParties(on ? ptsAtuais.filter((y) => y !== x.id) : [...ptsAtuais, x.id])}
                title={on ? `tirar ${x.nome} desta guerra` : `adicionar ${x.nome} nesta guerra`}
                style={{ cursor: "pointer", borderRadius: 999, border: `1px solid ${on ? C.verde : C.borderSoft}`, background: on ? C.verdeTint : "transparent", color: on ? C.verde : C.mute, padding: "2px 9px", fontSize: 11.5, fontFamily: "inherit" }}>
                {x.icone ? `${x.icone} ` : ""}{x.nome}
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
        {([["escalacao", "🧩 Escalação"], ["presenca", "✅ Confirmação"], ["stats", "📊 Estatísticas"]] as const).map(([k, t]) => (
          <button key={k} onClick={() => setAba(k)} style={{ cursor: "pointer", borderRadius: 8, border: `1px solid ${aba === k ? C.verde : C.border2}`, background: aba === k ? C.verdeTint : "transparent", color: aba === k ? C.verde : C.mute, padding: "6px 13px", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" }}>{t}</button>
        ))}
      </div>

      <div style={{ display: aba === "escalacao" ? "block" : "none" }}>{(
        <>
          <div style={{ color: C.mute, fontSize: 12, marginBottom: 12 }}>
            <b style={{ color: C.verde }}>{nEscalados}</b> escalados de <b>{nPool}</b> {temChamada ? "que marcaram" : "no elenco"} · <b style={{ color: C.verde }}>{nAceitaram}</b> aceitaram, <b style={{ color: C.amarelo }}>{nAguardando}</b> aguardando, <b style={{ color: C.mute }}>{nSemConvocar}</b> sem convocar ·
            <span style={{ color: C.amarelo }}> pokébola = lendário</span> · <span style={{ color: C.verde }}>fundo verde ✔ = aceitou</span> · <span style={{ color: C.amarelo }}>⏳ aguardando resposta</span> · <span style={{ color: C.borderSoft }}>✉ ainda não convocado</span> · <span style={{ color: C.verde }}>borda verde</span> = confirmou in-game ·
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
              {/* pool por FUNÇÃO */}
              <div {...alvo("pool")} style={{ border: `1px dashed ${C.border2}`, borderRadius: 12, background: C.surface, padding: 12, ...realce("pool") }}>
                <div style={{ color: C.amarelo, fontWeight: 700, fontSize: 13, marginBottom: 9 }}>{temChamada ? "Marcaram, por função" : "Elenco, por função"}</div>
                {/* sem chamada o pool é o elenco inteiro; achar alguém rolando 90 nomes numa coluna
                    de 330px não é viável, então a busca aparece quando o pool cresce */}
                {nPool > 12 && (
                  <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="filtrar por nome…"
                    style={{ width: "100%", boxSizing: "border-box", background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "5px 9px", fontSize: 12, fontFamily: "inherit", outline: "none", marginBottom: 9 }} />
                )}
                {grupos.map((g) => {
                  const livres = g.jogadores.filter((j) => partyDe(j) == null && casaBusca(j));
                  // um grupo grande (tipicamente "Sem função", que junta quem não foi classificado)
                  // vira sanfona pra não empurrar os grupos úteis pra fora da tela
                  const dobra = livres.length > 12 && !busca.trim();
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
                    <div key={g.funcaoId ?? "sem"} style={{ marginBottom: 11 }}>
                      {dobra ? (
                        <details><summary style={{ cursor: "pointer", marginBottom: 5 }}>{cabeca}</summary>{corpo}</details>
                      ) : (
                        <><div style={{ marginBottom: 5 }}>{cabeca}</div>{corpo}</>
                      )}
                    </div>
                  );
                })}
                {!grupos.length && <span style={{ color: C.borderSoft, fontSize: 12 }}>{temChamada ? "Ninguém marcou ainda." : "Nenhum jogador ativo cadastrado."}</span>}

                {/* quem recusou a convocação: já saiu da PT, mas fica à vista pra você saber que
                    avisou (≠ de quem sumiu) e não reescalar sem querer */}
                {recusaram.length > 0 && (
                  <div style={{ borderTop: `1px solid ${C.borderSoft}`, marginTop: 10, paddingTop: 9 }}>
                    <div style={{ color: C.vermelho, fontSize: 12, fontWeight: 700, marginBottom: 5 }}>
                      ❌ Recusaram a convocação — {recusaram.length}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 8px" }}>
                      {recusaram.map((n) => <span key={n} style={{ fontSize: 12.5, color: C.mute, textDecoration: "line-through" }}>{n}</span>)}
                    </div>
                    <div style={{ color: C.borderSoft, fontSize: 10.5, marginTop: 4 }}>Já saíram da PT. Pra reescalar, arraste de volta.</div>
                  </div>
                )}
              </div>

              {/* colunas = PARTIES IN-GAME */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
                {parties.map((p) => {
                  const dentro = naParty(p.id);
                  const gss = dentro.map((j) => j.gs).filter((x): x is number => x != null);
                  const media = gss.length ? Math.round(gss.reduce((a, b) => a + b, 0) / gss.length) : null;
                  return (
                    <div key={p.id} {...alvo(p.id)} style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surfaceSolid, padding: 12, minHeight: 92, ...realce(p.id) }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 6 }}>
                        <span style={{ color: C.verde, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}><Icone raw={p.icone} nome={p.nome} /> {p.nome}</span>
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
          }))} aliancas={aliancasIniciais} />

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
function MiniCard({ j }: { j: JogadorVM }) {
  return (
  <div style={{
    position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 60, minWidth: 210,
    border: `1px solid ${j.lendario ? C.amarelo : C.border2}`, borderRadius: 10, background: C.bg0,
    boxShadow: "0 8px 26px rgba(0,0,0,.7)", padding: "9px 11px", cursor: "default", pointerEvents: "none",
    display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: C.mute,
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 5, color: C.texto, fontSize: 13, fontWeight: 700 }}>
      {j.lendario && <Pokebola size={14} />}{j.familia}
    </div>
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
        {j.respondeuEm && <Linha k={j.confirmouEscalacao === false ? "Recusou" : "Confirmou"} v={quando(j.respondeuEm)} cor={j.confirmouEscalacao === false ? C.vermelho : C.verde} />}
        {j.ingameEm && <Linha k="In-game" v={quando(j.ingameEm)} cor={C.verde} />}
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
  const [hover, setHover] = useState(false);
  const [alvo, setAlvo] = useState(false);   // outro card sendo arrastado por cima deste
  return (
    <div
      draggable={canEdit}
      // quem está sendo arrastado viaja no próprio evento (dataTransfer), não num ref: o ref
      // seria lido no meio do render dos alvos, e o React avisa com razão que isso não atualiza
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", j.chave); setHover(false); }}
      onDragEnd={onFimArraste}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      // soltar EM CIMA de um card insere antes dele. stopPropagation pra o alvo da coluna não
      // tratar isso como "jogar no fim" logo em seguida.
      {...(onSoltarEmCima ? {
        onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setAlvo(true); },
        onDragLeave: () => setAlvo(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault(); e.stopPropagation(); setAlvo(false); setHover(false);
          const c = e.dataTransfer.getData("text/plain");
          if (c) onSoltarEmCima(c);
        },
      } : {})}
      style={{
        position: "relative",
        // duas confirmações, dois sinais: FUNDO verde = aceitou a escalação (DM); BORDA verde =
        // apareceu in-game. Lendário manda no contorno (dourado + brilho) por ser atributo fixo.
        border: `1px solid ${j.lendario ? C.amarelo : j.confirmouIngame ? C.verde : C.border2}`,
        boxShadow: j.lendario ? "0 0 10px rgba(214,178,42,.5)" : "none",
        background: j.confirmouEscalacao === true ? "rgba(46,125,50,.30)" : j.confirmouIngame ? C.verdeTint : C.inputBg,
        borderRadius: 9, padding: "6px 9px", cursor: canEdit ? "grab" : "default",
        // linha no topo marca onde o card vai entrar
        boxSizing: "border-box", borderTop: alvo ? `3px solid ${C.verde}` : undefined,
        display: "flex", alignItems: "center", gap: 6, fontSize: 12.5,
      }}
    >
      {lider && <span title="líder da PT" style={{ fontSize: 11, flexShrink: 0 }}>👑</span>}
      {j.lendario && <Pokebola />}
      {j.confirmouEscalacao === true && <span style={{ color: C.verde, fontSize: 11 }} title="confirmou a escalação na DM">✔</span>}
      {escalado && j.confirmouEscalacao == null && (j.convidado
        ? <span style={{ color: C.amarelo, fontSize: 11 }} title="DM enviada — aguardando resposta">⏳</span>
        : <span style={{ color: C.borderSoft, fontSize: 11 }} title="ainda não foi convocado">✉</span>)}
      <GuildIcon id={j.guilda} byId={byId} />
      <span style={{ color: C.texto, fontWeight: 600, whiteSpace: "nowrap" }}>{j.familia}</span>
      {emojiClasse
        ? <IconeClasse raw={emojiClasse} nome={j.classe ?? ""} />
        : j.classe && <span style={{ color: C.mute, fontSize: 11, whiteSpace: "nowrap" }}>{j.classe}</span>}
      {j.gs != null && <span style={{ color: C.amarelo, fontSize: 11 }}>{j.gs}</span>}
      {/* veio in-game sem ter marcado: dá pra escalar, mas não estava previsto */}
      {j.filler && <span title="Filler — apareceu in-game sem marcar na chamada" style={{ color: C.vermelho, fontSize: 9, flexShrink: 0 }}>🔴</span>}

      {/* indicadores à direita: "faz N dias" pesa mais do que a contagem crua de guerras */}
      <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5 }}>
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
      {hover && <MiniCard j={j} />}
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
