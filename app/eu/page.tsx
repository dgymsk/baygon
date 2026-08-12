import { auth } from "@/auth";
import { listPlayers } from "@/lib/players";
import { statsEu, STAT_METRICAS } from "@/lib/stats";
import { sql } from "@/lib/db";
import { chaveNome } from "@/lib/nomes";
import { canEditNow } from "@/lib/requireAuth";
import EuHud from "./EuHud";

export const dynamic = "force-dynamic";
export const metadata = { title: "Minhas stats · BAYGON" };

export default async function EuPage({ searchParams }: { searchParams: Promise<{ de?: string }> }) {
  const session = await auth();
  const familia = (session as { familia?: string | null })?.familia ?? null;
  const discordId = (session as { discordId?: string | null })?.discordId ?? null;
  const user = session?.user;

  /**
   * QUEM É VOCÊ: o REGISTRO manda, o apelido do servidor é plano B.
   *
   * Antes a única forma era casar o apelido do Discord ("[M] Família") com o nome de família do
   * roster. Isso quebrava por qualquer motivo bobo — apelido sem a tag, acento diferente, alguém
   * que mudou o nick — e, pior, apontava pra pessoa ERRADA se dois apelidos colidissem: quem
   * pusesse o nome de família de outro veria as estatísticas de outro.
   *
   * Agora a jornada de registro grava `players.discord_id`, que é o snowflake do provedor e ninguém
   * troca. 137 dos 144 ativos já têm. O apelido continua como queda pros que faltam — tirar de vez
   * deixaria essa gente sem a própria tela até se registrar.
   *
   * A consulta é separada de propósito: `listPlayers()` vai inteira pro navegador na /membros, e o
   * Discord de cada membro não tem por que trafegar pra lá.
   */
  const players = await listPlayers();

  /**
   * STAFF VENDO O PERFIL DE OUTRA PESSOA (?de=Família).
   *
   * A tela toda já sabe montar o perfil de um jogador qualquer — o que estava chumbado era só QUEM.
   * Conversar sobre desempenho sem os dois lados olhando o mesmo painel é conversa de memória.
   *
   * O gate é `canEditNow()` no SERVIDOR e não a flag da sessão: quem não é staff pode digitar ?de=
   * na barra de endereço, e um gate de cliente não é gate. Sem permissão, o parâmetro é ignorado em
   * silêncio e a pessoa vê o próprio perfil — negar com erro só ensinaria que o parâmetro existe.
   */
  const canEdit = await canEditNow();
  const pedido = (await searchParams)?.de ?? null;
  const alvo = canEdit && pedido
    ? players.find((p) => chaveNome(p.nome_familia) === chaveNome(pedido)) ?? null
    : null;

  const porRegistro = discordId
    ? ((await sql`SELECT nome_familia FROM players WHERE discord_id = ${discordId} LIMIT 1`) as { nome_familia: string }[])[0]?.nome_familia ?? null
    : null;
  const eu = alvo ?? (porRegistro
    ? players.find((p) => p.nome_familia === porRegistro)
    : familia ? players.find((p) => chaveNome(p.nome_familia) === chaveNome(familia)) : undefined);
  const vendoOutro = alvo != null;

  if (!eu) {
    return (
      <div className="pg" style={{ minHeight: "100vh", background: "linear-gradient(180deg,#151515,#0d0d0d 62%)", color: "#f2f2f2", fontFamily: "'Saira',system-ui,sans-serif", padding: "40px 24px", display: "flex", justifyContent: "center" }}>
        <div style={{ maxWidth: 560, border: "1px solid rgba(166,166,166,0.16)", borderRadius: 16, background: "rgba(204,0,0,0.035)", padding: 28 }}>
          <style>{`@import url('https://fonts.googleapis.com/css2?family=Saira:wght@300;400;500;600&display=swap');`}</style>
          <h1 style={{ color: "#cc0000", fontSize: 20, marginBottom: 10 }}>Não encontrei seu personagem</h1>
          <p style={{ color: "rgba(242,242,242,0.55)", fontSize: 14, lineHeight: 1.6 }}>
            {/* a mensagem diz o caminho CURTO primeiro: registrar resolve de uma vez e pra sempre;
                arrumar o apelido é remendo que quebra de novo na próxima vez que alguém mexer nele */}
            <>
              Sua conta do Discord ainda não está ligada a nenhum jogador do roster. Faça o{" "}
              <b style={{ color: "#f2f2f2" }}>registro</b> no servidor (o comando <b style={{ color: "#f2f2f2" }}>/register</b>) — ele
              amarra seu Discord ao seu nome de família e esta tela passa a te achar sozinha.
              {familia
                ? <> Enquanto isso tentei pelo seu apelido, <b style={{ color: "#f2f2f2" }}>“{familia}”</b>, e não bateu com ninguém.</>
                : <> Seu apelido no servidor também não tem um nome de família pra eu tentar.</>}
              {" "}Se já se registrou e mesmo assim caiu aqui, fale com a staff.
            </>
          </p>
          <div style={{ marginTop: 16 }}><a href="/painel" style={{ color: "#cc0000", textDecoration: "none", fontSize: 13 }}>← Voltar ao painel</a></div>
        </div>
      </div>
    );
  }

  // o grupo não vai mais por parâmetro: cada war usa o papel daquela war (node war × siege)
  const meusGrupos = [...new Set([eu.grupo, eu.grupo_siege].filter((g): g is string => !!g))];
  const [w1, w3, w5, w10, wAll, gmRows] = await Promise.all([
    statsEu(eu.nome_familia, 1),
    statsEu(eu.nome_familia, 3),
    statsEu(eu.nome_familia, 5),
    statsEu(eu.nome_familia, 10),
    statsEu(eu.nome_familia, 999),
    // "avaliadas" tem que cobrir os DOIS papéis, senão a métrica é rotulada errada pra quem troca
    sql`SELECT DISTINCT metrica FROM grupos_metricas WHERE grupo = ANY(${meusGrupos}::text[]) AND metrica = ANY(${STAT_METRICAS}::text[])`,
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
      // o avatar é o de QUEM ESTÁ LOGADO; olhando o perfil de outro, ele mentiria sobre quem é
      avatar={vendoOutro ? null : user?.image ?? null}
      vendoOutro={vendoOutro}
      // lista pra staff pular de perfil sem voltar ao /membros. Só ativos: perfil de ex-membro
      // continua acessível pela URL, mas não polui um seletor de 220 nomes.
      elenco={canEdit ? players.filter((p) => p.ativo).map((p) => p.nome_familia).sort((a, b) => a.localeCompare(b, "pt-BR")) : []}
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
