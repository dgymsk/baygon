# Guild War Stats — BDO (contexto do projeto)

## Objetivo
App web pra uma guilda de Black Desert Online armazenar e visualizar estatísticas
de Node War. Fluxo: extrai os números do **print do resultado da war** → guarda no
banco → gera análises de performance (por player e da guilda) com evolução no tempo.

## Stack
- **Next.js** — front React + rotas de API serverless no mesmo projeto.
- **Vercel** — deploy automático a cada push no Git.
- **Neon Postgres** — banco, instalado via Vercel Marketplace (injeta `DATABASE_URL`).
  Driver: `@neondatabase/serverless` (precisa Node 19+). NÃO usar `@vercel/postgres` (deprecado).
- **Recharts** — gráficos.

## Arquivos já prontos neste repo
- `modelo_dados.sql` — schema completo do Postgres (rodar no Neon). Base + fato cru + derivados + seed.
- `painel_guerra_ranged.jsx` — preview do painel (radar "% do core" + ranking). Hoje com dados
  hardcoded; o objetivo é ligá-lo ao endpoint de leitura.
- `war_2026-06-05_completa.csv` — uma war real já extraída (28 players) pra semear e testar.

## Modelo de dados (resumo; detalhe em modelo_dados.sql)
- `players(nome_familia, grupo, is_core)` — `grupo` = classificação do bot da guilda (ex: Ranged),
  **não** é a classe do BDO. `is_core` marca o player de referência.
- `metricas(metrica, rotulo, direcao, universal)` — `direcao` ∈ {maior_melhor, menor_melhor};
  `universal` = TRUE quando faz sentido comparar contra a média da guilda inteira.
- `grupos_metricas(grupo, metrica, peso)` — quais métricas avaliam cada grupo.
- `wars`, `desempenho` — fato cru, formato longo, valores já normalizados.
- `benchmarks(war_id, populacao, grupo, metrica, media)` — as "médias"; `populacao` ∈
  {core_grupo, grupo, guilda}.
- `discrepancia` (nível player; o que o front lê) e `war_guilda` (boletim da guilda por war).

## Lógica de score (PARTE CRÍTICA — não errar)
- `% = valor / media_do_benchmark * 100`. 0 = nada, 100 = empatou com a régua, >100 = melhor.
- **Polaridade:** métricas `menor_melhor` (ex: `tempo_morto`) INVERTEM → `media / valor * 100`.
  Regra fixa: "mais % = sempre melhor".
- **3 lentes** (mesmo cálculo, população diferente): core do grupo (justo por papel),
  todos do grupo, guilda inteira.
- **Cuidado:** régua da guilda inteira só vale pras métricas `universal=TRUE`. Cura/canhão
  (`universal=FALSE`) não devem ser comparadas contra a guilda (a maioria tem 0 → a média mente).
- **Normalização:** "635.1k" → 635100, "6.7M" → 6700000, "09:56" → 596 (segundos).

## Ingestão
Fonte = print do resultado da Node War. Extração via modelo de visão (vision LLM) → JSON →
revisão humana das células de baixa confiança → grava em `desempenho`. Construir como
endpoint de upload. As colunas de canhão são esparsas (poucos players pontuam) — é normal.

## Plano de build (um passo por vez, esperando confirmação)
1. create-next-app (este projeto)
2. repositório no GitHub
3. importar no Vercel (primeiro deploy)
4. instalar Neon na aba Storage → `DATABASE_URL`; `vercel env pull .env.local`
5. rodar `modelo_dados.sql` + semear `war_2026-06-05_completa.csv`
6. módulo de conexão (`@neondatabase/serverless`)
7. endpoint de leitura (ex: `GET /api/wars/[id]/discrepancia`) + endpoint de upload/parser
8. ligar o painel ao endpoint (trocar os dados hardcoded)
9. deploy final
