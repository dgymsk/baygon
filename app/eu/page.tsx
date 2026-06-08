import Link from "next/link";
import { auth } from "@/auth";
import { listPlayers } from "@/lib/players";
import { statsEu } from "@/lib/stats";
import { chaveNome } from "@/lib/nomes";
import { C } from "@/lib/theme";

export const dynamic = "force-dynamic";
export const metadata = { title: "Minhas stats · BAYGON" };

const GUILD: Record<string, { label: string; icon: string }> = {
  MANI: { label: "Manicômio", icon: "/guilds/manicomio.png" },
  RESO: { label: "Resonance", icon: "/guilds/resonance.png" },
};
const ROTULO: Record<string, string> = {
  dano_em_player: "Dano PvP", dano_do_pino: "Dano no Pino", ccs: "CC", cura_aliados: "Cura aliados", tempo_morto: "Tempo morto",
};
const NODES_OPCOES = [3, 5, 10, 999];
const COR_CORE = "#f2c14e";   // C = média do core do grupo (âmbar)
const COR_CLASSE = "#5fb0ff"; // Cl = média da classe (azul)

function fmt(metrica: string, v: number | null): string {
  if (v == null) return "—";
  if (metrica === "tempo_morto") { const s = Math.max(0, Math.round(v)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "k";
  return String(Math.round(v));
}
function pct(raw: number | null, coreRaw: number | null, dir: string): number | null {
  if (raw == null || coreRaw == null || coreRaw === 0 || raw === 0) return null;
  return dir === "maior_melhor" ? (raw / coreRaw) * 100 : (coreRaw / raw) * 100;
}
const posBar = (v: number | null) => (v == null ? 0 : Math.max(0, Math.min(200, v)) / 2);

export default async function EuPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const { n: nRaw } = await searchParams;
  const parsedN = Math.trunc(Number(nRaw));
  const n = Number.isFinite(parsedN) && parsedN >= 1 ? Math.min(999, parsedN) : 5;
  const session = await auth();
  const familia = (session as { familia?: string | null })?.familia ?? null;
  const user = session?.user;

  const players = await listPlayers();
  const eu = familia ? players.find((p) => chaveNome(p.nome_familia) === chaveNome(familia)) : undefined;

  const wrap = (children: React.ReactNode) => (
    <div style={{ background: C.bgGlow, minHeight: "100vh", padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600;700&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>{children}</div>
    </div>
  );

  const header = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {user?.image
          ? <img src={user.image} alt="" width={48} height={48} style={{ borderRadius: "50%", border: `2px solid ${C.border2}` }} />
          : <img src="/mascot.png" alt="" width={44} height={44} />}
        <div>
          <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 24, letterSpacing: 1, margin: 0, color: C.amarelo }}>
            {eu?.nome_familia ?? user?.name ?? "Minhas stats"}
          </h1>
          {eu && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, color: C.mute, fontSize: 13, flexWrap: "wrap" }}>
              <img src={(GUILD[eu.guilda] ?? GUILD.MANI).icon} alt="" width={14} height={14} style={{ borderRadius: 3 }} />
              {eu.classe_bdo ?? "—"}{eu.classe_tipo ? ` · ${eu.classe_tipo}` : ""} · grupo <b style={{ color: C.texto }}>{eu.grupo}</b> · {eu.n_wars} wars{eu.is_core ? " · core" : ""}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <Link className="navlink" href="/painel">← Painel</Link>
        <Link className="navlink" href="/confirmados">Confirmados</Link>
        <Link className="navlink" href="/evolucao">Evolução</Link>
      </div>
    </div>
  );

  if (!eu) {
    return wrap(<>
      {header}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: 24, color: C.mute }}>
        <p style={{ margin: 0, color: C.vermelho }}>⚠ Não encontrei seu personagem.</p>
        <p style={{ fontSize: 13, marginBottom: 0 }}>
          {familia
            ? <>Procurei pela família <b style={{ color: C.texto }}>“{familia}”</b> (do seu apelido no Discord) e não bateu com ninguém no roster. Confira se seu apelido no servidor está como <b style={{ color: C.texto }}>[M] SuaFamília</b> (ou [R]) e relogue, ou fale com a staff.</>
            : <>Seu apelido no servidor do Discord não tem o nome de família. Ajuste pra <b style={{ color: C.texto }}>[M] SuaFamília</b> e relogue.</>}
        </p>
      </div>
    </>);
  }

  const stats = await statsEu(eu.nome_familia, eu.grupo, eu.classe_bdo, n);

  // retângulo (chip) acima da barra: letra colorida + rótulo + número bruto
  const Chip = ({ cor, letra, label, valor }: { cor: string; letra: string; label: string; valor: string }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, border: `1px solid ${cor}66`, background: `${cor}14`, borderRadius: 9, padding: "5px 11px", fontSize: 13 }}>
      <span style={{ minWidth: 18, height: 18, padding: "0 3px", borderRadius: 9, background: cor, color: "#06100b", fontWeight: 800, fontSize: 11, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{letra}</span>
      <span style={{ color: C.mute }}>{label}</span><b style={{ color: C.texto }}>{valor}</b>
    </span>
  );
  // balão branco com a letra, posicionado na barra
  const Balao = ({ pos, cor, letra }: { pos: number; cor: string; letra: string }) => (
    <div style={{ position: "absolute", left: `${pos}%`, top: "50%", transform: "translate(-50%,-50%)", minWidth: 18, height: 18, padding: "0 3px", borderRadius: 9, background: cor, border: "2px solid #fff", color: "#06100b", fontSize: 9.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2, boxShadow: "0 1px 4px rgba(0,0,0,.55)" }}>{letra}</div>
  );

  return wrap(<>
    {header}

    {/* seletor de nº de nodes */}
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
      <span style={{ color: C.mute, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" }}>Média das últimas</span>
      {NODES_OPCOES.map((k) => {
        const ativo = k === n;
        return (
          <Link key={k} href={`/eu?n=${k}`} style={{ textDecoration: "none", borderRadius: 999, border: `1px solid ${ativo ? C.verde : C.border2}`, background: ativo ? C.verdeTint : "transparent", color: ativo ? C.verde : C.mute, padding: "4px 12px", fontSize: 12.5, fontWeight: 600 }}>
            {k === 999 ? "todas" : `${k} nodes`}
          </Link>
        );
      })}
    </div>

    {/* legenda / orientação */}
    <div style={{ color: C.mute, fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
      Sua <b style={{ color: C.verde }}>barra</b> mostra o quão perto você está da régua, o <b style={{ color: COR_CORE }}>core</b> (= 100%).
      Balão <span style={{ color: COR_CORE, fontWeight: 800 }}>C</span> = média do core do seu grupo · <span style={{ color: COR_CLASSE, fontWeight: 800 }}>Cl</span> = média da sua classe (números brutos nos retângulos).
      À direita: seu <b style={{ color: C.texto }}>%</b> vs core e sua <b style={{ color: C.texto }}>média bruta</b>. Tudo nas últimas {n === 999 ? "wars" : `${n} wars`} que <b style={{ color: C.texto }}>você</b> jogou.
    </div>

    {/* métricas */}
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {stats.map((s) => {
        const meuPct = pct(s.minhaRaw, s.coreRaw, s.direcao);
        const classePct = pct(s.classeRaw, s.coreRaw, s.direcao);
        const corCor = meuPct == null ? C.mute : meuPct >= 100 ? C.verde : C.vermelho;
        return (
          <div key={s.metrica} style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.surface, padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 9 }}>
              <div style={{ color: C.texto, fontWeight: 700, fontSize: 14.5 }}>{ROTULO[s.metrica] ?? s.metrica}{s.direcao === "menor_melhor" ? <span style={{ color: C.mute, fontSize: 11, fontWeight: 400 }}> ↓ menos é melhor</span> : null}</div>
              <div style={{ textAlign: "right" }}>
                <span style={{ color: corCor, fontWeight: 800, fontSize: 19 }}>{meuPct == null ? "—" : `${Math.round(meuPct)}%`}</span>
                <span style={{ color: C.mute, fontSize: 12.5, marginLeft: 7 }}>{fmt(s.metrica, s.minhaRaw)}</span>
              </div>
            </div>
            {/* dois retângulos: core e classe (números brutos) */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <Chip cor={COR_CORE} letra="C" label="core" valor={fmt(s.metrica, s.coreRaw)} />
              <Chip cor={COR_CLASSE} letra="Cl" label="classe" valor={fmt(s.metrica, s.classeRaw)} />
            </div>
            {/* barra com balões brancos C / Cl */}
            <div style={{ position: "relative", height: 22 }}>
              <div style={{ position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)", height: 14, borderRadius: 7, background: C.inputBg, border: `1px solid ${C.border}` }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${posBar(meuPct)}%`, background: corCor, opacity: 0.5, borderRadius: 7 }} />
              </div>
              <Balao pos={posBar(100)} cor={COR_CORE} letra="C" />
              {classePct != null && <Balao pos={posBar(classePct)} cor={COR_CLASSE} letra="Cl" />}
            </div>
          </div>
        );
      })}
    </div>

    <p style={{ color: C.mute, fontSize: 11.5, marginTop: 12 }}>
      Régua = média do <b style={{ color: COR_CORE }}>core</b> do seu grupo (se não houver core, média do grupo). 100% = empatou; acima = melhor (barra com teto 200%, o nº real fica no canto). Tempo morto invertido. Core, classe e você medidos nas <b style={{ color: C.texto }}>mesmas</b> {n === 999 ? "wars" : `${n} wars`} que você participou.
    </p>
  </>);
}
