import Link from "next/link";
import { auth } from "@/auth";
import { listPlayers } from "@/lib/players";
import { mediasMembros } from "@/lib/stats";
import { chaveNome } from "@/lib/nomes";
import { C } from "@/lib/theme";

export const dynamic = "force-dynamic";
export const metadata = { title: "Minhas stats · BAYGON" };

const GUILD: Record<string, { label: string; icon: string }> = {
  MANI: { label: "Manicômio", icon: "/guilds/manicomio.png" },
  RESO: { label: "Resonance", icon: "/guilds/resonance.png" },
};
const METRICAS = [
  { key: "dano_em_player", rotulo: "Dano PvP" },
  { key: "dano_do_pino", rotulo: "Dano no Pino" },
  { key: "ccs", rotulo: "CC" },
  { key: "cura_aliados", rotulo: "Cura aliados" },
  { key: "tempo_morto", rotulo: "Tempo morto" },
];
const NODES_OPCOES = [3, 5, 10, 999];

export default async function EuPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const { n: nRaw } = await searchParams;
  const n = Math.max(1, Math.min(999, Number(nRaw) || 5));
  const session = await auth();
  const familia = (session as { familia?: string | null })?.familia ?? null;
  const user = session?.user;

  const [players, medias] = await Promise.all([listPlayers(), mediasMembros(n)]);
  const eu = familia ? players.find((p) => chaveNome(p.nome_familia) === chaveNome(familia)) : undefined;

  const wrap = (children: React.ReactNode) => (
    <div style={{ background: C.bgGlow, minHeight: "100vh", padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600;700&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>
      <div style={{ maxWidth: 920, margin: "0 auto" }}>{children}</div>
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

  // média do grupo (média dos % dos membros ativos do mesmo grupo que têm dados)
  const doGrupo = players.filter((p) => p.grupo === eu.grupo && p.ativo && medias[p.nome_familia]);
  const grupoMedia = (key: string): number | null => {
    const vals = doGrupo.map((p) => medias[p.nome_familia]?.[key]).filter((v): v is number => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const minhas = medias[eu.nome_familia] ?? {};
  const cor = (v: number | null | undefined) => (v == null ? C.mute : v >= 100 ? C.verde : C.vermelho);
  const pos = (v: number | null | undefined) => Math.max(0, Math.min(200, v ?? 0)) / 2; // 0..100% da barra (teto 200)

  return wrap(<>
    {header}

    {/* seletor de nº de nodes */}
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
      <span style={{ color: C.mute, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" }}>Média das últimas</span>
      {NODES_OPCOES.map((k) => {
        const ativo = k === n || (k === 999 && n === 999);
        return (
          <Link key={k} href={`/eu?n=${k}`} style={{ textDecoration: "none", borderRadius: 999, border: `1px solid ${ativo ? C.verde : C.border2}`, background: ativo ? C.verdeTint : "transparent", color: ativo ? C.verde : C.mute, padding: "4px 12px", fontSize: 12.5, fontWeight: 600 }}>
            {k === 999 ? "todas" : `${k} nodes`}
          </Link>
        );
      })}
    </div>

    {/* métricas: minha média vs média do grupo */}
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.surface, padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, color: C.mute, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
        <span>Discrepância vs régua (core/grupo)</span>
        <span>você ▰ · grupo ▏ · régua 100%</span>
      </div>
      {METRICAS.map((m) => {
        const meu = minhas[m.key];
        const grp = grupoMedia(m.key);
        return (
          <div key={m.key} style={{ display: "grid", gridTemplateColumns: "130px 1fr 64px", alignItems: "center", gap: 12, padding: "8px 0", borderTop: `1px solid ${C.border}` }}>
            <div style={{ color: C.texto, fontSize: 13 }}>{m.rotulo}</div>
            <div style={{ position: "relative", height: 14, borderRadius: 7, background: C.inputBg, border: `1px solid ${C.border}` }}>
              {/* régua 100% */}
              <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: C.borderSoft }} />
              {/* minha barra */}
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pos(meu)}%`, background: cor(meu), opacity: 0.55, borderRadius: 7 }} />
              {/* marcador do grupo */}
              {grp != null && <div style={{ position: "absolute", left: `${pos(grp)}%`, top: -3, bottom: -3, width: 2, background: C.amarelo }} title={`grupo ${Math.round(grp)}%`} />}
            </div>
            <div style={{ textAlign: "right", fontSize: 13 }}>
              <b style={{ color: cor(meu) }}>{meu == null ? "—" : `${Math.round(meu)}%`}</b>
              <div style={{ color: C.mute, fontSize: 10.5 }}>grupo {grp == null ? "—" : `${Math.round(grp)}%`}</div>
            </div>
          </div>
        );
      })}
    </div>

    <p style={{ color: C.mute, fontSize: 11.5, marginTop: 12 }}>
      % vs a régua do <b style={{ color: C.texto }}>core</b> do seu grupo naquela war (ou média do grupo, se não houver core). 100% = empatou com a régua; acima = melhor (teto 200%). Tempo morto invertido (menos = melhor). Média das últimas {n === 999 ? "wars" : `${n} participações`}.
    </p>
  </>);
}
