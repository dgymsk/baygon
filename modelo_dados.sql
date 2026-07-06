-- =====================================================================
--  GUILD WAR STATS — modelo de dados (PostgreSQL / Neon)
--  3 lentes (core do grupo, grupo, guilda) + 2 níveis (player, guilda) + tempo
-- =====================================================================

-- ============ BASE (dimensões + config) ============

CREATE TABLE players (
  nome_familia TEXT PRIMARY KEY,
  grupo        TEXT    NOT NULL,                 -- classificação do BOT (Ranged, etc.) — NÃO é classe do BDO
  is_core      BOOLEAN NOT NULL DEFAULT FALSE,   -- sua marcação de "core"
  classe_bdo   TEXT,                             -- classe do BDO (ex: Guerreiro)
  classe_tipo  TEXT,                             -- especialização: Despertar/Sucessão/Ascensão/Talento
  guilda       TEXT    NOT NULL DEFAULT 'MANI' CHECK (guilda IN ('MANI','RESO')),  -- guilda da aliança
  pt_preferida TEXT,                             -- PT preferida de nodewar (1/2/defesa/ungabunga) — base do board
  ativo        BOOLEAN NOT NULL DEFAULT TRUE,    -- FALSE = ex-membro (aba "membros antigos")
  saida_tipo   TEXT CHECK (saida_tipo IS NULL OR saida_tipo IN ('Saiu','Kikado')),  -- motivo da saída
  saida_data   DATE                              -- quando virou ex-membro
);

-- Catálogo de métricas. A DIREÇÃO mora aqui (é propriedade da métrica, não do grupo).
-- 'universal' = TRUE quando faz sentido comparar contra a guilda inteira.
--  (cura/canhão = FALSE: a maioria tem 0, a média da guilda mentiria.)
CREATE TABLE metricas (
  metrica   TEXT PRIMARY KEY,
  rotulo    TEXT NOT NULL,
  direcao   TEXT NOT NULL CHECK (direcao IN ('maior_melhor','menor_melhor')),
  universal BOOLEAN NOT NULL DEFAULT FALSE
);

-- Quais métricas cada grupo é avaliado (+ peso opcional para um score agregado futuro).
CREATE TABLE grupos_metricas (
  grupo   TEXT    NOT NULL,
  metrica TEXT    NOT NULL REFERENCES metricas(metrica),
  peso    NUMERIC NOT NULL DEFAULT 1,
  PRIMARY KEY (grupo, metrica)
);

-- Vagas que não passam pelo bot (Apollo), por guilda da aliança.
-- hidden = nº de vagas reservadas; texto = nomes que ocupam vaga fora do bot (1 por linha).
CREATE TABLE IF NOT EXISTS vagas_config (
  guilda TEXT PRIMARY KEY CHECK (guilda IN ('MANI','RESO')),
  hidden INT  NOT NULL DEFAULT 0,
  texto  TEXT NOT NULL DEFAULT ''
);
INSERT INTO vagas_config (guilda) VALUES ('MANI'), ('RESO') ON CONFLICT DO NOTHING;

-- Status "Participar" in-game lido por visão (acumula entre prints; o mais recente
-- vence). Atrelado à mensagem do bot (war_key) p/ auto-reset quando troca a war.
CREATE TABLE IF NOT EXISTS participar_scan (
  chave      TEXT PRIMARY KEY,   -- chaveNome(familia)
  familia    TEXT NOT NULL,      -- nome de exibição
  participar BOOLEAN NOT NULL,
  atualizado TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS participar_meta (
  id            INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  war_key       TEXT,
  pos_liberacao BOOLEAN NOT NULL DEFAULT FALSE  -- 20:30: vagas liberadas → conta "roubo de vaga"
);
INSERT INTO participar_meta (id, war_key) VALUES (1, NULL) ON CONFLICT DO NOTHING;

-- Substituições manuais: staff tira alguém do grupo do bot (tipo='remover') e
-- CONFIRMA quem sobe da espera da mesma pt (tipo='subir'). Replace-all; atrelado
-- à war_key p/ auto-reset quando troca a war.
CREATE TABLE IF NOT EXISTS remocao_scan (
  chave      TEXT PRIMARY KEY,   -- chaveNome(familia)
  familia    TEXT NOT NULL,      -- nome de exibição
  tipo       TEXT NOT NULL DEFAULT 'remover',  -- 'remover' | 'subir'
  atualizado TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS remocao_meta (
  id      INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  war_key TEXT
);
INSERT INTO remocao_meta (id, war_key) VALUES (1, NULL) ON CONFLICT DO NOTHING;

-- Composição de PTs (squads): por membro, em qual PT está (1/2/defesa/ungabunga)
-- e se é líder (coroa). Replace-all; atrelado à war_key p/ auto-reset.
CREATE TABLE IF NOT EXISTS pt_scan (
  chave      TEXT PRIMARY KEY,   -- chaveNome(familia)
  familia    TEXT NOT NULL,      -- nome de exibição
  pt         TEXT,               -- '1' | '2' | 'defesa' | 'ungabunga' | NULL
  lider      BOOLEAN NOT NULL DEFAULT FALSE,
  atualizado TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pt_meta (
  id           INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  war_key      TEXT,
  modo         TEXT NOT NULL DEFAULT 'nodewar',       -- legado (a fonte da verdade é pt_config.modo)
  siege_pts    INT  NOT NULL DEFAULT 3,               -- legado
  siege_extras TEXT NOT NULL DEFAULT 'Flanco,Defesa', -- legado
  pt_config    TEXT  -- JSON: {modo, nodewar:{num,extras[]}, siege:{num,extras[]}}; extras = {id,nome,icone}
);
INSERT INTO pt_meta (id, war_key) VALUES (1, NULL) ON CONFLICT DO NOTHING;

-- ============ BOT DE PARTICIPAÇÃO PRÓPRIO (área /participacao, isolada) ============
-- Bot com botões Can/Cant. war_key = id da mensagem postada. Ver scripts/migrate_participacao.mjs.
CREATE TABLE IF NOT EXISTS participacao_config (       -- singleton JSON: canais/textos/agenda por tipo
  id     INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config TEXT  -- JSON: { nodewar:{channelId,titulo,mensagem,pingRoleId,agenda}, siege:{...} }
);
INSERT INTO participacao_config (id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS participacao_post (         -- cada mensagem postada = uma rodada
  message_id TEXT PRIMARY KEY,
  tipo       TEXT NOT NULL,                            -- 'nodewar' | 'siege'
  channel_id TEXT NOT NULL,
  titulo     TEXT,
  criado     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_participacao_post_tipo ON participacao_post (tipo, criado DESC);
CREATE TABLE IF NOT EXISTS participacao_resp (         -- 1 resposta por Discord user por rodada (upsert)
  war_key    TEXT NOT NULL,                            -- = participacao_post.message_id
  user_id    TEXT NOT NULL,                            -- Discord user.id
  username   TEXT NOT NULL,                            -- nick no servidor (auditoria)
  familia    TEXT,                                     -- nome canonizado (casarNome)
  chave      TEXT,                                     -- chaveNome(familia) p/ casar com players
  tipo       TEXT NOT NULL,
  resposta   TEXT NOT NULL CHECK (resposta IN ('can','cant')),
  atualizado TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (war_key, user_id)
);
CREATE INDEX IF NOT EXISTS ix_participacao_resp_warkey ON participacao_resp (war_key);
-- Grupos do bot de participação (staff pré-atribui). Ver scripts/migrate_participacao_grupos.mjs.
CREATE TABLE IF NOT EXISTS participacao_grupo (       -- catálogo de grupos por tipo (reusável)
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo       TEXT NOT NULL,                            -- 'nodewar' | 'siege'
  nome       TEXT NOT NULL,
  emoji      TEXT,                                     -- unicode ou '<:nome:id>'
  limite_max INT,                                      -- NULL = sem limite (capacidade planejada)
  ordem      INT NOT NULL DEFAULT 0,
  ativo      BOOLEAN NOT NULL DEFAULT TRUE,
  criado     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_participacao_grupo_tipo ON participacao_grupo (tipo, ordem);
CREATE TABLE IF NOT EXISTS participacao_membro (      -- atribuição fixa jogador→grupo (1 por tipo)
  tipo     TEXT NOT NULL,
  chave    TEXT NOT NULL,                              -- chaveNome(familia)
  familia  TEXT NOT NULL,
  grupo_id BIGINT NOT NULL REFERENCES participacao_grupo(id) ON DELETE CASCADE,
  PRIMARY KEY (tipo, chave)
);
CREATE INDEX IF NOT EXISTS ix_participacao_membro_grupo ON participacao_membro (grupo_id);

-- ============ FATO CRU (a extração dos prints) ============

CREATE TABLE wars (
  war_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  data       DATE NOT NULL,
  territorio TEXT,
  resultado  TEXT,   -- valor livre: derrota/vitoria e tambem colocacoes reais (PARTICIPACAO, VITORIA, QUARTO, SEGUNDO, QUINTO+...)
  tier       INT
);

-- Formato LONGO: 1 linha por (war, player, métrica), valor JÁ normalizado
-- (635.1k -> 635100, 6.7M -> 6700000, 09:56 -> 596 segundos).
-- Vantagem: benchmark e discrepância caem como GROUP BY genérico,
-- e adicionar uma métrica nova nunca mexe no schema.
CREATE TABLE desempenho (
  war_id       BIGINT NOT NULL REFERENCES wars(war_id),
  nome_familia TEXT   NOT NULL REFERENCES players(nome_familia),
  metrica      TEXT   NOT NULL REFERENCES metricas(metrica),
  valor        DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (war_id, nome_familia, metrica)
);

-- ============ DERIVADO (calculado do cru + config) ============

-- "As várias médias" — a generalização: (população, métrica) -> média.
-- populacao: 'core_grupo' | 'grupo' | 'guilda'
-- grupo recebe '(guilda)' quando populacao = 'guilda'.
CREATE TABLE benchmarks (
  war_id    BIGINT NOT NULL REFERENCES wars(war_id),
  populacao TEXT   NOT NULL,
  grupo     TEXT   NOT NULL,
  metrica   TEXT   NOT NULL REFERENCES metricas(metrica),
  media     DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (war_id, populacao, grupo, metrica)
);

-- Nível PLAYER — o que o front lê (radar / ranking). % já com polaridade aplicada.
CREATE TABLE discrepancia (
  war_id       BIGINT NOT NULL REFERENCES wars(war_id),
  nome_familia TEXT   NOT NULL REFERENCES players(nome_familia),
  grupo        TEXT   NOT NULL,
  metrica      TEXT   NOT NULL,
  populacao    TEXT   NOT NULL,              -- contra qual régua
  valor        DOUBLE PRECISION NOT NULL,
  media        DOUBLE PRECISION NOT NULL,
  pct          DOUBLE PRECISION NOT NULL,    -- 100 = empatou; >100 = melhor
  PRIMARY KEY (war_id, nome_familia, metrica, populacao)
);

-- Nível GUILDA — o "boletim" da guerra inteira.
CREATE TABLE war_guilda (
  war_id          BIGINT PRIMARY KEY REFERENCES wars(war_id),
  n_participantes INT,
  total_kills     BIGINT,
  total_mortes    BIGINT,
  total_dano_pino DOUBLE PRECISION,
  total_cura      DOUBLE PRECISION,
  pct_medio       DOUBLE PRECISION,   -- média da % (vs core do grupo) de todos
  pct_acima_core  DOUBLE PRECISION    -- fração dos membros com pct >= 100
);

-- =====================================================================
--  SEED da config (as métricas reais do print + o Ranged de exemplo)
-- =====================================================================
INSERT INTO metricas (metrica, rotulo, direcao, universal) VALUES
  ('kills',               'Kills',              'maior_melhor', TRUE),
  ('mortes',              'Mortes',             'menor_melhor', TRUE),
  ('sequencia',           'Sequência',          'maior_melhor', TRUE),
  ('dano_em_player',      'Dano PvP',           'maior_melhor', TRUE),
  ('dano_recebido',       'Dano Recebido',      'maior_melhor', TRUE),  -- direção depende do papel (tank absorve)
  ('ccs',                 'CCs',                'maior_melhor', TRUE),
  ('cura_propria',        'Cura Própria',       'maior_melhor', FALSE),
  ('cura_aliados',        'Cura Aliados',       'maior_melhor', FALSE), -- NÃO universal (o pega-ratão da média da guilda)
  ('dano_do_pino',        'Dano Pino',          'maior_melhor', TRUE),
  ('acerto_canhao',       'Acerto Canhão',      'maior_melhor', FALSE),
  ('estruturas_canhao',   'Estruturas (canhão)','maior_melhor', FALSE),
  ('distancia_canhao',    'Distância Canhão',   'maior_melhor', FALSE),
  ('armadilha_disparos',  'Armadilhas',         'maior_melhor', FALSE),
  ('tempo_morto',         'Tempo Morto',        'menor_melhor', TRUE),
  ('tempo_sobrevivencia', 'Tempo Vivo',         'maior_melhor', TRUE);

INSERT INTO grupos_metricas (grupo, metrica) VALUES
  ('Ranged', 'dano_em_player'),
  ('Ranged', 'dano_do_pino'),
  ('Ranged', 'tempo_morto');

-- =====================================================================
--  EXEMPLO do cálculo (mostra que "as três lentes" são só o GROUP BY
--  com uma população diferente). Roda depois de popular 'desempenho'.
-- =====================================================================

-- 1) régua do CORE de cada grupo
-- INSERT INTO benchmarks (war_id, populacao, grupo, metrica, media)
-- SELECT d.war_id, 'core_grupo', p.grupo, d.metrica, AVG(d.valor)
-- FROM desempenho d
-- JOIN players p USING (nome_familia)
-- JOIN grupos_metricas gm ON gm.grupo = p.grupo AND gm.metrica = d.metrica
-- WHERE p.is_core
-- GROUP BY d.war_id, p.grupo, d.metrica;

-- 2) régua da GUILDA inteira (só métricas universais)
-- INSERT INTO benchmarks (war_id, populacao, grupo, metrica, media)
-- SELECT d.war_id, 'guilda', '(guilda)', d.metrica, AVG(d.valor)
-- FROM desempenho d
-- JOIN metricas m USING (metrica)
-- WHERE m.universal
-- GROUP BY d.war_id, d.metrica;

-- 3) discrepância do player vs uma régua, com polaridade
-- pct = CASE m.direcao
--         WHEN 'maior_melhor' THEN d.valor / b.media * 100
--         ELSE b.media / d.valor * 100        -- menos é melhor -> inverte
--       END
