import { auth } from "@/auth";
import { listPlayers } from "@/lib/players";
import { statsEu } from "@/lib/stats";
import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import EuHud from "./EuHud";

export const dynamic = "force-dynamic";
export const metadata = { title: "Minhas stats · BAYGON" };

export default async function EuPage() {
  const session = await auth();
  const familia = (session as { familia?: string | null })?.familia ?? null;
  const user = session?.user;

  const players = await listPlayers();
  const eu = familia ? players.find((p) => chaveNome(p.nome_familia) === chaveNome(familia)) : undefined;

  if (!eu) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#0b170e,#08120b 62%)", color: "#e9f3e1", fontFamily: "'Saira',system-ui,sans-serif", padding: "40px 24px", display: "flex", justifyContent: "center" }}>
        <div style={{ maxWidth: 560, border: "1px solid rgba(163,230,53,0.11)", borderRadius: 16, background: "rgba(163,230,53,0.022)", padding: 28 }}>
          <style>{`@import url('https://fonts.googleapis.com/css2?family=Saira:wght@300;400;500;600&display=swap');`}</style>
          <h1 style={{ color: "#facc15", fontSize: 20, marginBottom: 10 }}>Não encontrei seu personagem</h1>
          <p style={{ color: "rgba(233,243,225,0.55)", fontSize: 14, lineHeight: 1.6 }}>
            {familia
              ? <>Procurei pela família <b style={{ color: "#e9f3e1" }}>“{familia}”</b> (do seu apelido no Discord) e não bateu com ninguém no roster. Confira se seu apelido no servidor está como <b style={{ color: "#e9f3e1" }}>[M] SuaFamília</b> (ou [R]) e relogue, ou fale com a staff.</>
              : <>Seu apelido no servidor do Discord não tem o nome de família. Ajuste pra <b style={{ color: "#e9f3e1" }}>[M] SuaFamília</b> e relogue.</>}
          </p>
          <div style={{ marginTop: 16 }}><a href="/painel" style={{ color: "#38bdf8", textDecoration: "none", fontSize: 13 }}>← Voltar ao painel</a></div>
        </div>
      </div>
    );
  }

  const [w1, w3, w5, w10, wAll, gmRows] = await Promise.all([
    statsEu(eu.nome_familia, eu.grupo, 1),
    statsEu(eu.nome_familia, eu.grupo, 3),
    statsEu(eu.nome_familia, eu.grupo, 5),
    statsEu(eu.nome_familia, eu.grupo, 10),
    statsEu(eu.nome_familia, eu.grupo, 999),
    sql`SELECT metrica FROM grupos_metricas WHERE grupo = ${eu.grupo}`,
  ]);
  const avaliadas = (gmRows as { metrica: string }[]).map((r) => r.metrica);
  const windows = [
    { key: "ultima", label: "Última war", stats: w1 },
    { key: "n3", label: "3 nodes", stats: w3 },
    { key: "n5", label: "5 nodes", stats: w5 },
    { key: "n10", label: "10 nodes", stats: w10 },
    { key: "todas", label: "Todas", stats: wAll },
  ];

  return (
    <EuHud
      nome={eu.nome_familia}
      avatar={user?.image ?? null}
      classe={eu.classe_bdo}
      tipo={eu.classe_tipo}
      grupo={eu.grupo}
      nWars={eu.n_wars}
      isCore={eu.is_core}
      windows={windows}
      avaliadas={avaliadas}
    />
  );
}
