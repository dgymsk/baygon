"use client";

import { useEffect, useState } from "react";
import { C } from "@/lib/theme";
import { formatarMetrica } from "@/lib/formatarMetrica";
import type { PlayerRow } from "@/lib/players";
import type { PerfilPlayer } from "@/lib/perfilPlayer";

/** 0 = domingo … 6 = sábado — a convenção de Date.getUTCDay(), a mesma de intencao_agenda. */
const DIA_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DIA_NOME = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
/** Amarelo claro do "dia dele" — o mesmo da listra no card da escalação. */
const DIA_CLARO = "#f0e08a";
const VERDE_OK = "#3fbf5f";
/** "Indefinido" é a AUSÊNCIA de papel, não um papel — e é onde está a maior parte do elenco. */
const semGrupo = (g: string | null) => !g || g === "Indefinido";

/**
 * O cartão que abre ao clicar no nome em /membros.
 *
 * Junta três coisas que hoje moram em telas diferentes, porque a pergunta da staff é uma só —
 * "posso contar com essa pessoa?": o cadastro (quem é), o funil (o que ela faz quando é chamada) e
 * a presença de fato (se apareceu). Cada uma sozinha responde metade.
 *
 * O resumo é buscado no CLIQUE e não vem com a tabela: são 220 linhas, e trazer o funil de todas
 * pra mostrar uma seria pagar 220 vezes por um clique.
 */
/**
 * Num e Linha ficam no ESCOPO DO MÓDULO, e não dentro do componente.
 *
 * Declarados lá dentro, o React vê um TIPO de componente novo a cada render e desmonta/remonta
 * tudo — perde estado e foco. É o mesmo motivo pelo qual o Card do EventoBoard mora fora do
 * EventoBoard, e o lint do projeto pega isso.
 */
const Num = ({ v, t, cor }: { v: number | string; t: string; cor?: string }) => (
  <div style={{ minWidth: 74 }}>
    <div style={{ color: cor ?? C.texto, fontSize: 19, fontWeight: 700, lineHeight: 1.1 }}>{v}</div>
    <div className="leg" style={{ color: C.dim, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6 }}>{t}</div>
  </div>
);
const Linha = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0", borderBottom: `1px solid ${C.borderSoft}` }}>
    <span style={{ color: C.mute, fontSize: 12 }}>{k}</span>
    <span style={{ color: C.texto, fontSize: 12, textAlign: "right" }}>{v}</span>
  </div>
);

/**
 * Uma guerra na régua. A barra é 100% da largura quando a pessoa empatou com a referência, então o
 * traço vertical no meio é a régua — dá pra ler a linha inteira sem ler número nenhum.
 *
 * O teto visual é 200%: acima disso a barra satura, e o número ao lado continua dizendo a verdade.
 * Sem teto, uma noite de 400% comprimiria todas as outras a nada.
 */
const BarraPct = ({ pct }: { pct: number | null }) => {
  if (pct == null) return <span style={{ color: C.dim, fontSize: 11 }} title="jogou sozinho no grupo nessa guerra — não há com quem comparar">sem régua</span>;
  const larg = Math.max(2, Math.min(pct, 200) / 2);   // 200% -> 100% da caixa
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ position: "relative", flex: "1 1 auto", height: 7, background: C.inputBg, borderRadius: 4, overflow: "hidden", minWidth: 40 }}>
        <div style={{ width: `${larg}%`, height: "100%", background: pct >= 100 ? VERDE_OK : C.mute, opacity: pct >= 100 ? 0.85 : 0.55 }} />
        {/* a régua: 100% cai exatamente no meio da caixa */}
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: C.border2 }} />
      </div>
      <span style={{ color: pct >= 100 ? VERDE_OK : C.mute, fontSize: 11.5, fontWeight: 700, minWidth: 38, textAlign: "right" }}>{Math.round(pct)}%</span>
    </div>
  );
};

export default function PerfilModal({ row, onClose, canEdit = false, onRenomeado, elenco = [] }: { row: PlayerRow; onClose: () => void; canEdit?: boolean; onRenomeado?: (novo: string) => void; elenco?: string[] }) {
  const [perfil, setPerfil] = useState<PerfilPlayer | null>(null);
  const [erro, setErro] = useState("");
  const [renomeando, setRenomeando] = useState(false);
  const [novoNome, setNovoNome] = useState(row.nome_familia);
  const [renErro, setRenErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [fundindo, setFundindo] = useState(false);
  const [alvoFusao, setAlvoFusao] = useState("");
  const [fusErro, setFusErro] = useState("");
  /** Dias otimistas: o clique pinta na hora e o servidor confirma depois (ver `alternarDia`). */
  const [dias, setDias] = useState<number[] | null>(null);
  const [diasErro, setDiasErro] = useState("");
  /**
   * A ordem importa: palpite otimista > resposta do servidor > o que a TABELA já sabia.
   *
   * O último degrau é o que mata a corrida: sem ele, enquanto o GET do perfil está no ar os sete
   * botões apareciam todos apagados — inclusive pra quem tem dias gravados —, e o primeiro clique
   * mandava só o dia clicado, apagando o resto. `row` vem da /membros e já traz a coluna.
   */
  const diasAtuais = dias ?? perfil?.diasSemana ?? row.dias_semana ?? [];

  /**
   * Liga/desliga um dia. Grava direto, sem botão de salvar: é um toggle de 7 posições, e um
   * "salvar" a mais só criaria a chance de fechar o cartão com a escolha perdida.
   *
   * O palpite otimista vale até o servidor responder; se falhar, volta ao que era e diz o motivo.
   */
  async function alternarDia(d: number) {
    if (!canEdit) return;
    const antes = diasAtuais;
    const novo = antes.includes(d) ? antes.filter((x) => x !== d) : [...antes, d].sort((a, b) => a - b);
    setDias(novo);
    setDiasErro("");
    try {
      const res = await fetch("/api/players/dias", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: row.nome_familia, dias: novo }),
      });
      const d2 = (await res.json().catch(() => ({}))) as { dias?: number[]; error?: string };
      if (!res.ok) throw new Error(d2.error ?? `erro ${res.status}`);
      setDias(d2.dias ?? novo);
    } catch (e) {
      setDias(antes);
      setDiasErro((e as Error).message);
    }
  }

  /**
   * FUNDIR — quando este cadastro e outro são a MESMA pessoa (trocou o nome no jogo e o print da
   * war seguinte criou um cadastro novo, sem Discord nem histórico).
   *
   * Este cadastro é o que DESAPARECE: o histórico dele vai pro escolhido. A direção é essa porque o
   * que se quer preservar é o vínculo de Discord e o histórico antigo, que moram no cadastro
   * original — e é ele que deve continuar existindo.
   */
  async function fundir(forcar = false) {
    if (!alvoFusao || alvoFusao === row.nome_familia) return;
    if (!forcar && !confirm(`Fundir "${row.nome_familia}" em "${alvoFusao}"?

Todo o histórico de "${row.nome_familia}" (estatística, escalação, presença) passa para "${alvoFusao}", e este cadastro DEIXA DE EXISTIR.

Onde os dois tiverem o mesmo fato, fica o de "${alvoFusao}".`)) return;
    setSalvando(true); setFusErro("");
    try {
      const res = await fetch("/api/players/fundir", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perdedor: row.nome_familia, vencedor: alvoFusao, forcar }) });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409 && (d as { codigo?: string }).codigo === "jogaram_juntos") {
        const w = ((d as { warsEmComum?: number[] }).warsEmComum ?? []).join(", ");
        if (confirm(`Os dois têm estatística nas wars ${w} — ou seja, apareceram em campo ao mesmo tempo.

Isso normalmente quer dizer que NÃO são a mesma pessoa. Insistir mesmo assim?`)) return fundir(true);
        setSalvando(false); return;
      }
      if (!res.ok) throw new Error((d as { error?: string }).error ?? `erro ${res.status}`);
      onRenomeado?.(alvoFusao);   // recarrega a lista; este cadastro não existe mais
      onClose();
    } catch (e) { setFusErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  /**
   * RENOMEAR. Fica atrás de um "abrir" e de uma confirmação com o nome digitado por extenso porque
   * é irreversível na prática: o nome é a chave primária e viaja denormalizado por 12 tabelas.
   *
   * O servidor é quem recusa fusão e colisão — aqui só se mostra o motivo. Duplicar essa regra no
   * cliente daria duas definições de "pode renomear", e a do cliente é a que envelhece.
   */
  async function renomear() {
    const para = novoNome.trim();
    if (!para || para === row.nome_familia) return;
    if (!confirm(`Renomear "${row.nome_familia}" para "${para}"?

O nome é a identidade do jogador em todo o app — escalação, presença, estatística e histórico vão junto.

Só confirme se você JÁ renomeou no jogo: os prints são lidos pelo nome, e um print com o nome velho recria o cadastro antigo.`)) return;
    setSalvando(true); setRenErro("");
    try {
      const res = await fetch("/api/players/renomear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ de: row.nome_familia, para }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((d as { error?: string }).error ?? `erro ${res.status}`);
      onRenomeado?.(para);
      onClose();
    } catch (e) { setRenErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  useEffect(() => {
    let vivo = true;
    /**
     * Sem zerar estado aqui: quem garante cartão limpo a cada jogador é o `key` no pai
     * (MembrosTable), que REMONTA o componente quando o nome muda. Zerar dentro do efeito faria a
     * mesma coisa por um caminho pior — uma cascata de renders a cada abertura, que o lint pega.
     *
     * O estrago que isso evita não é só cosmético: `dias` é palpite otimista e vence o que vem do
     * servidor, então os botões do jogador anterior continuariam marcados no cartão do próximo, e
     * o clique seguinte gravaria aquela escolha no nome errado.
     */
    fetch(`/api/players/perfil?nome=${encodeURIComponent(row.nome_familia)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((d as { error?: string }).error ?? `erro ${r.status}`);
        if (vivo) setPerfil((d as { perfil: PerfilPlayer }).perfil);
      })
      .catch((e) => vivo && setErro((e as Error).message));
    return () => { vivo = false; };
  }, [row.nome_familia]);

  // Esc fecha: o modal é de consulta rápida, e obrigar a mirar no ✕ atrapalha quem abre vários
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const gs = row.garmoth?.gs ?? null;
  const f = perfil?.funil;

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.62)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 12px", overflowY: "auto" }}>
      {/* o clique DENTRO do cartão não pode fechar — só o fundo */}
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(680px, 100%)", border: `1px solid ${C.border2}`, borderRadius: 14, background: C.surfaceSolid, padding: 18, boxShadow: "0 20px 60px rgba(0,0,0,.6)" }}>

        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20, color: C.texto, fontFamily: "'Share Tech Mono', monospace" }}>{row.nome_familia}</h2>
          <span style={{ color: C.mute, fontSize: 12 }}>{row.guilda} · {row.grupo}{row.grupo_siege ? ` / ${row.grupo_siege} (siege)` : ""}</span>
          {!row.ativo && <span style={{ color: C.vermelho, fontSize: 11.5, fontWeight: 700 }}>ex-membro{row.saida_tipo ? ` · ${row.saida_tipo}` : ""}</span>}
          {row.is_core && <span style={{ color: C.amarelo, fontSize: 11.5, fontWeight: 700 }}>★ core</span>}
          <button onClick={onClose} className="tap" style={{ marginLeft: "auto", background: "none", border: `1px solid ${C.border2}`, borderRadius: 8, color: C.mute, padding: "3px 10px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
        </div>

        {erro && <div style={{ color: C.vermelho, fontSize: 12.5, marginBottom: 10 }}>⚠ {erro}</div>}

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 14 }}>
          <Num v={row.n_wars} t="wars com stat" />
          <Num v={gs ?? "—"} t="gear score" />
          <Num v={f ? `${f.jogou}/${f.eventos}` : "…"} t="jogou / eventos" />
          <Num v={f ? f.recusou : "…"} t="recusou" cor={f && f.recusou > 0 ? C.laranja : undefined} />
          <Num v={f ? f.semResposta : "…"} t="sem responder" cor={f && f.semResposta > 0 ? C.laranja : undefined} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <Linha k="Classe" v={row.classe_bdo ? `${row.classe_bdo}${row.classe_tipo ? ` · ${row.classe_tipo}` : ""}` : "—"} />
          <Linha k="AP / AAP / DP" v={row.garmoth ? `${row.garmoth.ap ?? "?"} / ${row.garmoth.aap ?? "?"} / ${row.garmoth.dp ?? "?"}` : "sem Garmoth"} />
          <Linha k="Registro" v={row.registro ? "concluído" : <span style={{ color: C.laranja }}>não registrado</span>} />
          <Linha k="Wars com estatística" v={perfil ? `${perfil.wars.comEstatistica}${perfil.wars.primeira ? ` · de ${br(perfil.wars.primeira)} a ${br(perfil.wars.ultima)}` : ""}` : "…"} />
          {!row.ativo && <Linha k="Saída" v={`${row.saida_tipo ?? "—"}${row.saida_data ? ` · ${br(row.saida_data)}` : ""}`} />}
        </div>

        {/* DIAS QUE COSTUMA JOGAR — informação que hoje mora na cabeça de quem monta escalação
            ("o Dixit só joga começo de semana") e some a cada troca de staff. Quando a guerra cai
            num desses dias, o card dele ganha uma listra clara no pool. */}
        <div style={{ border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: "9px 11px", marginBottom: 14 }}>
          <div className="leg" style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 7 }}>
            Costuma jogar {diasAtuais.length > 0 && <span style={{ color: DIA_CLARO }}>({diasAtuais.length} dia{diasAtuais.length > 1 ? "s" : ""})</span>}
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {DIA_CURTO.map((rot, d) => {
              const on = diasAtuais.includes(d);
              return (
                <button key={d} onClick={() => alternarDia(d)} disabled={!canEdit} className="tap"
                  title={canEdit ? `${on ? "tirar" : "marcar"} ${DIA_NOME[d]}` : DIA_NOME[d]}
                  style={{ borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                    cursor: canEdit ? "pointer" : "default", textTransform: "capitalize",
                    border: `1px solid ${on ? DIA_CLARO : C.border2}`,
                    background: on ? "rgba(240,224,138,.14)" : "transparent",
                    color: on ? DIA_CLARO : C.dim }}>
                  {rot}
                </button>
              );
            })}
          </div>
          {diasErro && <div style={{ color: C.vermelho, fontSize: 12, marginTop: 7 }}>⚠ {diasErro}</div>}
          <div className="leg" style={{ color: C.dim, fontSize: 10.5, marginTop: 7, lineHeight: 1.5 }}>
            {diasAtuais.length === 0
              ? "Nenhum dia informado — é o normal, e não impede nada. Marque só de quem tem restrição de agenda."
              : "Nas guerras desses dias o card dele aparece com uma listra clara na escalação. Não escala ninguém sozinho nem barra os outros dias — é lembrete, não regra."}
          </div>
        </div>

        {canEdit && (
          <div style={{ border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: "9px 11px", marginBottom: 14 }}>
            {!renomeando ? (
              <button onClick={() => { setRenomeando(true); setNovoNome(row.nome_familia); }}
                style={{ background: "none", border: "none", color: C.mute, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
                ✎ renomear o nome de família…
              </button>
            ) : (
              <div>
                <div className="leg" style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Renomear</div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
                  <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} maxLength={60} autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") renomear(); if (e.key === "Escape") setRenomeando(false); }}
                    style={{ background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "6px 10px", fontSize: 13, fontFamily: "inherit", flex: "1 1 200px", minWidth: 0 }} />
                  <button onClick={renomear} disabled={salvando || !novoNome.trim() || novoNome.trim() === row.nome_familia}
                    style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: C.verde, padding: "6px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                    {salvando ? "renomeando…" : "Renomear"}
                  </button>
                  <button onClick={() => { setRenomeando(false); setRenErro(""); }}
                    style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.mute, padding: "6px 11px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>cancelar</button>
                </div>
                {renErro && <div style={{ color: C.vermelho, fontSize: 12, marginTop: 7 }}>⚠ {renErro}</div>}
                <div className="leg" style={{ color: C.dim, fontSize: 10.5, marginTop: 6, lineHeight: 1.5 }}>
                  Leva junto escalação, presença, estatística, funções e histórico. <b>Renomeie no jogo antes</b> — os prints
                  são lidos pelo nome, e um print com o nome velho recria o cadastro antigo. Se o nome novo já existir, o
                  pedido é recusado: renomear não funde dois cadastros.
                </div>
              </div>
            )}

            {/* FUNDIR fica junto do renomear porque a staff chega aqui pela mesma dúvida — "esse
                nome novo é a mesma pessoa?" — e a resposta muda qual das duas ações resolve. */}
            {!fundindo ? (
              <button onClick={() => setFundindo(true)}
                style={{ background: "none", border: "none", color: C.mute, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", padding: 0, marginTop: 7, display: "block" }}>
                ⇄ este cadastro é a mesma pessoa que outro…
              </button>
            ) : (
              <div style={{ marginTop: 9, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 9 }}>
                <div className="leg" style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Fundir cadastros</div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ color: C.mute, fontSize: 12 }}>o histórico de <b style={{ color: C.texto }}>{row.nome_familia}</b> vai para</span>
                  <select value={alvoFusao} onChange={(e) => setAlvoFusao(e.target.value)}
                    style={{ background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "6px 9px", fontSize: 13, fontFamily: "inherit", maxWidth: 220 }}>
                    <option value="">— escolha —</option>
                    {elenco.filter((n) => n !== row.nome_familia).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <button onClick={() => fundir()} disabled={salvando || !alvoFusao}
                    style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: C.vermelho, padding: "6px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                    {salvando ? "fundindo…" : "Fundir"}
                  </button>
                  <button onClick={() => { setFundindo(false); setFusErro(""); }}
                    style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: "transparent", color: C.mute, padding: "6px 11px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>cancelar</button>
                </div>
                {fusErro && <div style={{ color: C.vermelho, fontSize: 12, marginTop: 7 }}>⚠ {fusErro}</div>}
                <div className="leg" style={{ color: C.dim, fontSize: 10.5, marginTop: 6, lineHeight: 1.5 }}>
                  <b>{row.nome_familia}</b> deixa de existir. Use quando alguém trocou de nome no jogo e o print criou um
                  cadastro novo — funda o novo no antigo (que tem o Discord) e depois renomeie o antigo pro nome atual.
                  Se os dois tiverem estatística na mesma war, o pedido é barrado: seriam duas pessoas.
                </div>
              </div>
            )}
          </div>
        )}

        {/* DANO POR GUERRA — a outra metade da pergunta "posso contar com essa pessoa?". O funil
            acima diz se ela aparece; isto diz o que ela entrega quando aparece. A régua é a média
            dos OUTROS do grupo dela naquela guerra (core, se houver) — ela nunca entra na própria
            referência, senão o percentual tende a 100 por construção. */}
        <div className="leg" style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
          Dano por guerra {perfil ? `(${perfil.dano.length})` : ""}
          <span style={{ textTransform: "none", letterSpacing: 0, color: C.dim }}> · últimas 12 · % contra o core do grupo dele (sem core, contra os outros do grupo)</span>
        </div>
        {/* sem grupo, a comparação é fraca — e o conserto é uma ação concreta, não um aviso vago */}
        {perfil && perfil.dano.length > 0 && perfil.dano.every((p) => semGrupo(p.grupo)) && (
          <div className="leg" style={{ color: C.dim, fontSize: 10.5, marginBottom: 6, lineHeight: 1.5 }}>
            Ele está sem grupo definido, então a régua abaixo é a média dos outros sem grupo — que mistura papéis e diz
            pouco. Defina o <b>Grupo NW</b> dele na tabela de membros pra comparação passar a valer.
          </div>
        )}
        <div className="rolx" style={{ border: `1px solid ${C.border2}`, borderRadius: 10, marginBottom: 14 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.inputBg, color: C.mute, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5 }}>
                <th className="fixa" style={{ padding: "5px 8px", textAlign: "left" }}>Guerra</th>
                <th style={{ padding: "5px 6px", textAlign: "right" }}>Dano</th>
                <th style={{ padding: "5px 6px", textAlign: "right" }} title="o esperado naquela guerra: a média dos CORES do grupo dele; sem core no grupo, a média dos outros. Ele nunca entra na própria régua.">Régua</th>
                <th style={{ padding: "5px 8px", textAlign: "left", minWidth: 120 }}>vs régua</th>
              </tr>
            </thead>
            <tbody>
              {!perfil && !erro && <tr><td colSpan={4} style={{ padding: 14, color: C.dim, textAlign: "center" }}>carregando…</td></tr>}
              {perfil && perfil.dano.length === 0 && (
                <tr><td colSpan={4} style={{ padding: 12, color: C.dim, textAlign: "center" }}>nenhuma guerra com régua (rosas não entra)</td></tr>
              )}
              {perfil?.dano.map((p) => (
                <tr key={p.warId} style={{ borderTop: `1px solid ${C.borderSoft}` }}>
                  <td className="fixa" style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>
                    <span style={{ color: C.texto }}>{br(p.data)}</span>
                    <span style={{ color: C.dim, fontSize: 10.5 }}> · {p.tipo ?? "nodewar"}</span>
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right", color: C.texto, whiteSpace: "nowrap" }}>{formatarMetrica("dano_em_player", p.valor)}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right", color: C.dim, whiteSpace: "nowrap" }}
                      title={p.nCore > 0 ? `média de ${p.nCore} core(s) do grupo` : p.nOutros > 0 ? `sem core no grupo: média de ${p.nOutros} companheiro(s)` : "ninguém além dele no grupo"}>
                    {formatarMetrica("dano_em_player", p.regua)}
                    {p.regua != null && p.nCore === 0 && p.nOutros > 0 && <span style={{ color: C.dim, fontSize: 10 }} title="sem core no grupo nessa guerra"> ~</span>}
                  </td>
                  {/* A % aparece sempre; o que muda é o quanto ela vale. Sem grupo definido a régua
                      é "os outros sem grupo" — mistura healer com frontline —, e num grupo cuja
                      função não é medida por dano a comparação é fora do papel. Nos dois casos o
                      número fica apagado e o motivo está no title. */}
                  <td style={{ padding: "4px 8px", opacity: p.avaliada ? 1 : 0.45 }}
                      title={p.avaliada ? "" : semGrupo(p.grupo)
                        ? "ele não tem grupo definido: a régua vira a média dos outros sem grupo, que mistura papéis diferentes"
                        : `o grupo ${p.grupo} não é avaliado por dano — a comparação é fora do papel dele`}>
                    <BarraPct pct={p.pct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="leg" style={{ color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
          Últimos eventos {perfil ? `(${perfil.ultimos.length})` : ""}
        </div>
        <div className="rolx" style={{ border: `1px solid ${C.border2}`, borderRadius: 10 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.inputBg, color: C.mute, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5 }}>
                <th className="fixa" style={{ padding: "5px 8px", textAlign: "left" }}>Evento</th>
                <th style={{ padding: "5px 6px" }} title="marcou na chamada do bot">Marcou</th>
                <th style={{ padding: "5px 6px" }} title="a staff pôs numa PT">Escalado</th>
                <th style={{ padding: "5px 6px" }} title="resposta da DM de convocação">DM</th>
                <th style={{ padding: "5px 6px" }} title="apareceu na conferência in-game">In-game</th>
                <th style={{ padding: "5px 6px" }} title="tem estatística na war">Jogou</th>
              </tr>
            </thead>
            <tbody>
              {!perfil && !erro && <tr><td colSpan={6} style={{ padding: 14, color: C.dim, textAlign: "center" }}>carregando…</td></tr>}
              {perfil?.ultimos.map((e) => (
                <tr key={e.eventoId} style={{ borderTop: `1px solid ${C.borderSoft}` }}>
                  <td className="fixa" style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>
                    <span style={{ color: C.texto }}>{e.titulo}</span>
                    <span style={{ color: C.dim, fontSize: 10.5 }}> · {br(e.data)}</span>
                  </td>
                  <td style={{ textAlign: "center" }}>{e.marcou ? "✓" : <span style={{ color: C.dim }}>—</span>}</td>
                  <td style={{ textAlign: "center" }}>{e.escalado ? "✓" : <span style={{ color: C.dim }}>—</span>}</td>
                  <td style={{ textAlign: "center" }}>
                    {e.confirmou === true ? <span style={{ color: "#3fbf5f" }}>sim</span>
                      : e.confirmou === false ? <span style={{ color: "#e04b4b" }}>não</span>
                      : <span style={{ color: C.dim }}>—</span>}
                  </td>
                  <td style={{ textAlign: "center" }}>{e.ingame ? "🎮" : <span style={{ color: C.dim }}>—</span>}</td>
                  {/* jogou = null quando a war não foi gravada: sem estatística ninguém faltou */}
                  <td style={{ textAlign: "center" }}>
                    {e.jogou === true ? <span style={{ color: "#3fbf5f" }}>✓</span>
                      : e.jogou === false ? <span style={{ color: "#e04b4b" }}>✗</span>
                      : <span style={{ color: C.dim }} title="a war não teve estatística gravada">?</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const br = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
