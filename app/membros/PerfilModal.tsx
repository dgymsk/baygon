"use client";

import { useEffect, useState } from "react";
import { C } from "@/lib/theme";
import type { PlayerRow } from "@/lib/players";
import type { PerfilPlayer } from "@/lib/perfilPlayer";

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

export default function PerfilModal({ row, onClose }: { row: PlayerRow; onClose: () => void }) {
  const [perfil, setPerfil] = useState<PerfilPlayer | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
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
