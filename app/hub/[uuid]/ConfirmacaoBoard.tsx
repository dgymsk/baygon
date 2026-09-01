"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import { chaveNome } from "@/lib/nomes";
import { canonicalizarNomes, type Cand } from "@/lib/casarNome";
import { iconeUrl, type GuildEntry } from "@/lib/guild";

/**
 * Confirmação in-game do evento — mesma conferência do /confirmados (mesmo canonicalizarNomes,
 * mesmas três colunas), com o contexto do hub: "tem vaga" aqui significa ESTAR ESCALADO.
 *
 * A leitura por visão erra nome com frequência, então o print não vira presença direto: o que a
 * heurística corrigiu sozinha fica à mostra, e o que não bateu com ninguém vira pendência com
 * seletor — nome perdido em silêncio viraria falta em cima de quem compareceu.
 */
type Alvo = { chave: string; familia: string; guilda: string | null; escalado: boolean; confirmouIngame: boolean };
type Lido = { familia: string; participar: boolean };

const fileToBase64 = (f: File) =>
  new Promise<{ mediaType: string; data: string }>((res, rej) => {
    const r = new FileReader();
    r.onerror = () => rej(new Error("falha ao ler arquivo"));
    r.onload = () => { const s = String(r.result); const c = s.indexOf(","); res({ mediaType: f.type || "image/png", data: c >= 0 ? s.slice(c + 1) : s }); };
    r.readAsDataURL(f);
  });

export default function ConfirmacaoBoard({
  eventoId, alvos, playersNomes, guildas, canEdit, ativo = true,
}: { eventoId: number; alvos: Alvo[]; playersNomes: string[]; guildas: GuildEntry[]; canEdit: boolean; ativo?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [lidos, setLidos] = useState<Lido[] | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [prog, setProg] = useState("");
  const [erro, setErro] = useState("");
  const [falhas, setFalhas] = useState<{ nome: string; erro: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [copiado, setCopiado] = useState("");
  const [salvandoNome, setSalvandoNome] = useState<string | null>(null);

  const porChave = useMemo(() => new Map(alvos.map((a) => [a.chave, a])), [alvos]);
  const rosterCand: Cand[] = useMemo(() => alvos.map((a) => ({ chave: a.chave, nome: a.familia })), [alvos]);
  const playersCand: Cand[] = useMemo(() => playersNomes.map((n) => ({ chave: chaveNome(n), nome: n })), [playersNomes]);
  const opcoes = useMemo(() => [...playersNomes].sort((a, b) => a.localeCompare(b, "pt-BR")), [playersNomes]);

  /**
   * As colunas mostram SEMPRE o estado. Sem print lido, valem a presença já gravada — antes elas
   * ficavam vazias mesmo com gente confirmada, o que dava a impressão de que nada tinha sido
   * salvo. Com print lido, valem a leitura, e cada nome ganha marcador do que MUDA em relação ao
   * gravado (✚ entra, ✖ sai), que é o que interessa antes de clicar em gravar.
   */
  const conc = useMemo(() => {
    if (!lidos) return null;
    const vieram = lidos.filter((l) => l.participar);
    const { mapa, correcoes, naoEncontrados } = canonicalizarNomes(vieram.map((l) => l.familia), rosterCand, playersCand);
    const pendentes = naoEncontrados.filter((n) => !manual[chaveNome(n)]);
    const pendChaves = new Set(pendentes.map((p) => chaveNome(p)));
    const finais = new Map<string, string>();
    for (const l of vieram) {
      const k = chaveNome(l.familia);
      if (pendChaves.has(k)) continue; // não resolvido não entra
      const nome = manual[k] ?? mapa.get(k) ?? l.familia;
      finais.set(chaveNome(nome), nome);
    }
    const conta: Record<string, number> = {}, totalEscalado: Record<string, number> = {};
    for (const g of guildas) { conta[g.tag] = 0; totalEscalado[g.tag] = 0; }
    for (const a of alvos) {
      const tag = guildas.find((g) => g.id === a.guilda)?.tag;
      if (!tag || !(tag in conta)) continue;
      if (a.escalado) totalEscalado[tag]++;
      if (finais.has(a.chave)) conta[tag]++;
    }
    return {
      correcoes: correcoes.filter((c) => !manual[chaveNome(c.de)]),
      pendentes, finais, conta, totalEscalado,
    };
  }, [lidos, manual, alvos, rosterCand, playersCand, guildas]);

  /** Nomes das três colunas + o delta contra o gravado. Sem leitura, é o próprio gravado. */
  const colunas = useMemo(() => {
    const presente = (a: Alvo) => (conc ? conc.finais.has(a.chave) : a.confirmouIngame);
    const marca = (a: Alvo): string => {
      if (!conc) return a.familia;
      if (presente(a) && !a.confirmouIngame) return `${a.familia} ✚`;  // o print vai marcar
      if (!presente(a) && a.confirmouIngame) return `${a.familia} ✖`;  // o print vai desmarcar
      return a.familia;
    };
    const item = (a: Alvo) => ({ label: marca(a), familia: a.familia, ligado: a.confirmouIngame, guilda: a.guilda });
    const extras = conc
      ? [...conc.finais.entries()].filter(([k]) => !porChave.has(k)).map(([, n]) => ({ label: `${n} ✚`, familia: n, ligado: false, guilda: null })) // nem marcou no bot
      : [];
    return {
      certo: alvos.filter((a) => a.escalado && presente(a)).map(item),
      faltando: alvos.filter((a) => a.escalado && !presente(a)).map(item),
      semVaga: [...alvos.filter((a) => !a.escalado && presente(a)).map(item), ...extras],
      mudancas: conc ? alvos.filter((a) => presente(a) !== a.confirmouIngame).length + extras.length : 0,
    };
  }, [conc, alvos, porChave]);

  const copiar = (nomes: string[], id: string) => {
    navigator.clipboard?.writeText(nomes.join("\n")).then(() => { setCopiado(id); setTimeout(() => setCopiado(""), 1500); }).catch(() => {});
  };

  /**
   * Fila de prints. Colar (Ctrl+V) e escolher arquivo caem aqui do mesmo jeito; se chegar print
   * novo enquanto um está sendo lido, ele entra na fila em vez de disparar leitura concorrente.
   */
  const filaRef = useRef<File[]>([]);
  const lendoRef = useRef(false);
  // espelho do estado pra leitura dentro do loop assíncrono. Sincronizado em efeito, não no
  // render — escrever em ref durante o render é o tipo de coisa que quebra em modo concorrente.
  const lidosRef = useRef<Lido[] | null>(null);
  useEffect(() => { lidosRef.current = lidos; }, [lidos]);
  // o autosave roda dentro do loop de leitura, que capturou o closure do início — estes espelhos
  // são o que faz ele ver o roster e as resoluções manuais como estão agora
  const rosterCandRef = useRef(rosterCand);
  const playersCandRef = useRef(playersCand);
  const manualRef = useRef(manual);
  const gravarRef = useRef<(l?: Lido[]) => Promise<void>>(async () => {});
  useEffect(() => { rosterCandRef.current = rosterCand; playersCandRef.current = playersCand; manualRef.current = manual; gravarRef.current = gravar; });

  async function enfileirar(files: ArrayLike<File> | null) {
    if (!files?.length || !canEdit) return;
    filaRef.current.push(...Array.from(files));
    if (lendoRef.current) { setProg(`${filaRef.current.length} print(s) na fila…`); return; }

    lendoRef.current = true; setBusy(true); setErro("");
    const acc = new Map<string, Lido>(lidosRef.current?.map((l) => [chaveNome(l.familia), l]) ?? []);
    const ruins: { nome: string; erro: string }[] = [];
    let n = 0;
    try {
      while (filaRef.current.length) {
        const f = filaRef.current.shift()!;
        n++;
        setProg(`lendo print ${n}${filaRef.current.length ? ` · ${filaRef.current.length} na fila` : ""}…`);
        try {
          const image = await fileToBase64(f);
          const res = await fetch("/api/participar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
          const d = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error((d as { error?: string }).error ?? `erro ${res.status}`);
          for (const m of ((d as { membros?: Lido[] }).membros ?? [])) acc.set(chaveNome(m.familia), m); // último vence
        } catch (e) { ruins.push({ nome: f.name || "colado", erro: (e as Error).message }); } // um print ruim não derruba os outros
        setLidos([...acc.values()]); // mostra o parcial a cada print, não só no fim
      }
      setFalhas(ruins);
      const lidosFinais = [...acc.values()];
      setLidos(lidosFinais);
      // grava sozinho ao terminar a leitura. Nome que não casou com ninguém é o ÚNICO motivo pra
      // segurar: gravar sem resolver seria escolher por você, e depois vira falta em cima de quem
      // veio. Nesse caso a tabela fica na tela esperando o seletor e o botão de gravar.
      const vieram = lidosFinais.filter((l) => l.participar);
      const { naoEncontrados } = canonicalizarNomes(vieram.map((l) => l.familia), rosterCandRef.current, playersCandRef.current);
      const pend = naoEncontrados.filter((n) => !manualRef.current[chaveNome(n)]);
      if (pend.length) { setProg(`${acc.size} nome(s) · ${pend.length} pendente(s) — resolva pra gravar`); return; }
      await gravarRef.current(lidosFinais);
    } finally {
      lendoRef.current = false; setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  // Ctrl+V com print no clipboard (Windows: Shift+Win+S → Ctrl+V). Ouve no documento porque o
  // usuário cola sem ter clicado em campo nenhum. Ref pro listener não capturar closure velha.
  // Só escuta com a aba VISÍVEL: as abas ficam montadas (pra não perder a leitura ao trocar), e
  // sem isso colar o print do resultado da war na aba de estatísticas cairia aqui por engano.
  const enfileirarRef = useRef(enfileirar);
  useEffect(() => { enfileirarRef.current = enfileirar; });
  useEffect(() => {
    if (!canEdit || !ativo) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imgs: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) imgs.push(f); }
      }
      if (imgs.length) { e.preventDefault(); enfileirarRef.current(imgs); }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [canEdit, ativo]);

  async function gravar(lidosDiretos?: Lido[]) {
    if (!canEdit) return;
    // resolve na hora quando vem do autosave; senão usa o que a tela já mostra (conc)
    let nomes: string[];
    if (lidosDiretos) {
      const vieram = lidosDiretos.filter((l) => l.participar);
      const { mapa } = canonicalizarNomes(vieram.map((l) => l.familia), rosterCandRef.current, playersCandRef.current);
      const finais = new Map<string, string>();
      for (const l of vieram) {
        const k = chaveNome(l.familia);
        const nome = manualRef.current[k] ?? mapa.get(k) ?? l.familia;
        finais.set(chaveNome(nome), nome);
      }
      nomes = [...finais.values()];
    } else {
      if (!conc) return;
      nomes = [...conc.finais.values()];
    }
    setBusy(true);
    try {
      const membros = nomes.map((familia) => ({ familia, participar: true }));
      const res = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "presenca-print", eventoId, membros }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `erro ${res.status}`);
      setProg(`presença gravada ✓ — ${membros.length} confirmado(s)`); setLidos(null); setManual({}); router.refresh();
    } catch (e) { setErro((e as Error).message); }
    finally { setBusy(false); }
  }

  /**
   * Grava a presença de UMA pessoa na hora, sem depender do botão de gravar. Cada linha é
   * independente no banco (PK evento_id+chave), então editar o Azly não mexe em mais ninguém e
   * o que já foi decidido não se perde se a página cair no meio.
   */
  async function marcarUm(familia: string, participar: boolean) {
    if (!canEdit) return;
    setSalvandoNome(familia);
    try {
      const res = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "presenca-manual", eventoId, familia, participar }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `erro ${res.status}`);
      setErro(""); router.refresh();
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvandoNome(null); }
  }

  const col = { canEdit, copiado, salvandoNome, onCopiar: copiar, onToggle: marcarUm };

  const aviso = (cor: string) => ({ color: cor, fontSize: 12.5, marginTop: 6, marginBottom: 10, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "8px 11px", background: C.inputBg } as const);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
          <div style={{ color: C.verde, fontWeight: 700, fontSize: 14 }}>Conferir “Participar” (in-game)</div>
          {canEdit && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <input ref={inputRef} type="file" accept="image/*" multiple disabled={busy} onChange={(e) => enfileirar(e.target.files)} style={{ color: C.mute, fontSize: 12 }} />
              {lidos && <button onClick={() => { setLidos(null); setManual({}); setProg(""); setFalhas([]); }} style={{ background: "none", border: "none", color: C.mute, cursor: "pointer", fontSize: 12 }}>descartar</button>}
              {conc && <button onClick={() => gravar()} disabled={busy || !!conc.pendentes.length} title={conc.pendentes.length ? "resolva os nomes pendentes primeiro" : undefined}
                style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: conc.pendentes.length ? "transparent" : C.verdeTint, color: conc.pendentes.length ? C.mute : C.verde, padding: "5px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Gravar presença</button>}
            </div>
          )}
        </div>
        <div style={{ color: C.mute, fontSize: 11.5 }}>
          {canEdit && <><b style={{ color: C.texto }}>Cole o print com Ctrl+V</b> em qualquer lugar da página (Shift+Win+S
          pra recortar), ou escolha o arquivo. </>}
          Registra quem <b style={{ color: C.verde }}>vai jogar</b>; a presença oficial só entra com as estatísticas de
          combate. Vários prints acumulam — o último vence por nome.
        </div>
        {prog && <div style={{ color: C.mute, fontSize: 12, marginTop: 6 }}>{prog}</div>}
        {erro && <div style={{ color: C.vermelho, fontSize: 13, marginTop: 6 }}>⚠ {erro}</div>}

        {falhas.length > 0 && (
          <div style={aviso(C.amarelo)}>
            <b>⚠ {falhas.length} print(s) falharam</b> — os outros foram lidos; re-suba só estes:
            <ul style={{ margin: "5px 0 0", paddingLeft: 18 }}>
              {falhas.map((f, i) => <li key={i} style={{ color: C.mute }}><b style={{ color: C.texto }}>{f.nome}</b> — {f.erro}</li>)}
            </ul>
          </div>
        )}
        {conc && conc.correcoes.length > 0 && (
          <div style={aviso(C.verde)}>
            <b>✏ {conc.correcoes.length} nome(s) corrigido(s) por similaridade</b> — confira se bateu certo:
            <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", marginTop: 4 }}>
              {conc.correcoes.map((c, i) => <span key={i} style={{ color: C.mute }}>{c.de} → <b style={{ color: C.texto }}>{c.para}</b></span>)}
            </div>
          </div>
        )}
        {conc && conc.pendentes.length > 0 && (
          <div style={aviso(C.amarelo)}>
            <b>⚠ {conc.pendentes.length} nome(s) não bateram com ninguém</b> — leitura da IA pode estar errada, ou é gente de fora. Aponte o player:
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))", gap: 6, marginTop: 6 }}>
              {conc.pendentes.map((n) => (
                <div key={n} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: C.texto, minWidth: 92 }} title="como a visão leu">{n}</span>
                  <span style={{ color: C.mute }}>→</span>
                  <select defaultValue="" disabled={!canEdit} onChange={(e) => e.target.value && setManual((m) => ({ ...m, [chaveNome(n)]: e.target.value }))}
                    style={{ background: C.inputBg, color: C.texto, border: `1px solid ${C.border2}`, borderRadius: 7, padding: "3px 7px", fontSize: 12, fontFamily: "inherit", flex: 1 }}>
                    <option value="">escolher player…</option>
                    {opcoes.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ color: C.mute, fontSize: 12, margin: "10px 0", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "2px 10px" }}>
          {conc
            ? <span><b style={{ color: C.texto }}>{lidos?.length ?? 0}</b> nomes no print; <b style={{ color: C.texto }}>{conc.finais.size}</b> resolvidos
                {colunas.mudancas > 0
                  ? <> · <b style={{ color: C.amarelo }}>{colunas.mudancas}</b> mudança(s) em relação ao gravado</>
                  : <span style={{ color: C.verde }}> · igual ao que já está gravado</span>}
              </span>
            : <span>Mostrando a <b style={{ color: C.texto }}>presença já gravada</b>{canEdit ? " — cole um print pra conferir contra o jogo." : "."}</span>}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, borderLeft: `1px solid ${C.borderSoft}`, paddingLeft: 10 }}>
            <span style={{ color: C.verde, fontWeight: 700 }} title="confirmados / escalados, por guilda">Confirmados:</span>
            {guildas.map((g) => {
              const u = iconeUrl(g.icone);
              const escal = alvos.filter((a) => a.escalado && a.guilda === g.id).length;
              const conf = conc ? (conc.conta[g.tag] ?? 0) : alvos.filter((a) => a.confirmouIngame && a.guilda === g.id).length;
              return (
                <span key={g.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.texto }}>
                  {u ? <img src={u} alt="" width={14} height={14} style={{ borderRadius: 3 }} /> : <span>{g.icone || g.tag}</span>}
                  <b>{conf}</b><span style={{ color: C.mute }}>/{escal}</span>
                </span>
              );
            })}
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Col id="certo" titulo="✅ Certo" cor={C.verde} itens={colunas.certo} hint="Escalado e confirmado in-game" ctx={col} />
          {/**
            * QUEM FALTA APARECER vai SEPARADO POR GUILDA, uma caixa cada.
            *
            * Esta é a única coluna que vira trabalho: alguém tem que cutucar essa gente no Discord,
            * e quem cutuca é o oficial da guilda DELA. Misturadas, a lista obrigava a staff a
            * conferir nome por nome de quem era cada um antes de cobrar; separadas, cada oficial
            * copia a sua e pronto (o ⧉ copiar de cada caixa leva só os nomes dela).
            *
            * As outras duas continuam inteiras: "certo" não gera ação, e "veio sem estar escalado" é
            * decisão de quem monta a escalação, não da guilda de origem.
            */}
          {guildas.map((g) => (
            <Col key={g.id} id={`falta-${g.id}`} cor={C.amarelo} ctx={col}
              titulo={`⚠ Não apareceu · ${g.tag}`}
              itens={colunas.faltando.filter((i) => i.guilda === g.id)}
              hint="Escalado e ainda fora do jogo → cobrar na guilda, ou remanejar a PT" />
          ))}
          {/* sem guilda no cadastro: some quando não houver ninguém, pra não virar caixa fantasma */}
          {colunas.faltando.some((i) => !i.guilda || !guildas.some((g) => g.id === i.guilda)) && (
            <Col id="falta-sem" cor={C.amarelo} ctx={col} titulo="⚠ Não apareceu · sem guilda"
              itens={colunas.faltando.filter((i) => !i.guilda || !guildas.some((g) => g.id === i.guilda))}
              hint="Escalado, fora do jogo e sem guilda no cadastro — defina a guilda em /membros" />
          )}
          <Col id="fora" titulo="⛔ Veio sem estar escalado" cor={C.vermelho} itens={colunas.semVaga} hint="Confirmado fora da escalação → decidir se entra ou retira" ctx={col} />
        </div>
        <div style={{ color: C.mute, fontSize: 11, marginTop: 8 }}>
          {conc
            ? <><b style={{ color: C.verde }}>✚</b> entra e <b style={{ color: C.vermelho }}>✖</b> sai quando você gravar. Cruzamento por nome de família — se o nome no jogo diferir do nome no bot, aparece como divergência.</>
            : "Estado atual gravado. Nada muda até você ler um print ou clicar num nome abaixo."}
        </div>
      </div>

      <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
          <div style={{ color: C.verde, fontWeight: 700, fontSize: 14 }}>Situação gravada</div>
          <span style={{ color: C.mute, fontSize: 11.5 }}>
            {alvos.filter((a) => a.confirmouIngame).length} confirmado(s) · {alvos.filter((a) => a.escalado && !a.confirmouIngame).length} escalado(s) sem confirmar
          </span>
        </div>
        <div style={{ color: C.mute, fontSize: 11, marginBottom: 10 }}>{canEdit ? "Clique num nome pra ligar/desligar a confirmação na mão." : "Só staff edita."}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {alvos.map((a) => (
            <button key={a.chave} onClick={() => marcarUm(a.familia, !a.confirmouIngame)} disabled={!canEdit}
              style={{
                cursor: canEdit ? "pointer" : "default", fontFamily: "inherit",
                border: `1px solid ${a.confirmouIngame ? C.verde : a.escalado ? C.laranja : C.border2}`,
                background: a.confirmouIngame ? C.verdeTint : C.inputBg,
                borderRadius: 999, padding: "4px 11px", fontSize: 12.5, color: C.texto,
                display: "inline-flex", alignItems: "center", gap: 5,
              }}>
              <span style={{ color: a.confirmouIngame ? C.verde : C.borderSoft }}>{a.confirmouIngame ? "✅" : "◻"}</span>
              {a.familia}
            </button>
          ))}
          {!alvos.length && <span style={{ color: C.dim, fontSize: 12.5 }}>Ninguém marcou nesta chamada.</span>}
        </div>
      </div>
    </div>
  );
}

type Item = { label: string; familia: string; ligado: boolean; guilda: string | null };
type ColCtx = { canEdit: boolean; copiado: string; salvandoNome: string | null; onCopiar: (n: string[], id: string) => void; onToggle: (f: string, v: boolean) => void };

/**
 * Coluna da conferência. Fica FORA do componente de propósito: definida dentro, o React a trataria
 * como um tipo novo a cada render e remontaria tudo — o "✓ copiado" piscava e o hover se perdia.
 * Cada nome é clicável e grava NA HORA (uma linha por pessoa), sem depender do botão de gravar.
 */
function Col({ titulo, cor, itens, hint, id, ctx }: { titulo: string; cor: string; itens: Item[]; hint?: string; id: string; ctx: ColCtx }) {
  const { canEdit, copiado, salvandoNome, onCopiar, onToggle } = ctx;
  return (
    <div style={{ flex: "1 1 240px", minWidth: 240, border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ color: cor, fontWeight: 700, fontSize: 13.5 }}>{titulo} <span style={{ color: C.mute }}>({itens.length})</span></span>
        {itens.length > 0 && <button onClick={() => onCopiar(itens.map((i) => i.familia), id)} title="copiar nomes" style={{ background: "none", border: "none", color: copiado === id ? C.verde : C.mute, cursor: "pointer", fontSize: 12 }}>{copiado === id ? "✓ copiado" : "⧉ copiar"}</button>}
      </div>
      {hint && <div style={{ color: C.mute, fontSize: 11, marginBottom: 6 }}>{hint}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 8px" }}>
        {itens.length === 0 ? <span style={{ color: C.dim, fontSize: 12 }}>—</span>
          : itens.map((it) => (
            <button key={it.familia} disabled={!canEdit || salvandoNome === it.familia}
              onClick={() => onToggle(it.familia, !it.ligado)}
              title={canEdit ? (it.ligado ? "clique p/ desmarcar (grava na hora)" : "clique p/ marcar (grava na hora)") : undefined}
              style={{ background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 12.5, cursor: canEdit ? "pointer" : "default", color: salvandoNome === it.familia ? C.mute : C.texto, textDecoration: canEdit ? "underline dotted transparent" : "none" }}
              onMouseEnter={(e) => { if (canEdit) e.currentTarget.style.textDecoration = "underline dotted"; }}
              onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "underline dotted transparent"; }}>
              {it.label}
            </button>
          ))}
      </div>
    </div>
  );
}
