-- Extensões gratuitas que servem a algo que JÁ existe no projeto.
-- Critério deliberado: só entra extensão com uso concreto hoje. Extensão
-- instalada "por precaução" é superfície a mais para manter, migrar e auditar.
--
-- Já instaladas antes desta migração: pgcrypto, pg_cron, pg_net, uuid-ossp,
-- pgmq, pg_stat_statements, unaccent, pg_trgm, supabase_vault, plpgsql.

-- -----------------------------------------------------------------------------
-- btree_gin — índice GIN que combina texto com coluna escalar
-- -----------------------------------------------------------------------------
-- A busca de imóveis (private.property_search_text + properties_search_idx, da
-- migração 20260916035807) é GIN de trigrama, e o mesmo SELECT ainda filtra por
-- organization_id, status, purpose, type e faixa de preço. Sem btree_gin, um
-- índice GIN não aceita essas colunas escalares: o Postgres usa o índice do
-- texto e depois descarta linha por linha. Com btree_gin passa a ser possível
-- um GIN composto que resolve o predicado inteiro.
--
-- A extensão só HABILITA a possibilidade; nenhum índice novo é criado aqui de
-- propósito. O banco está vazio e o advisor já aponta `unused_index` nos que
-- existem — índice especulativo antes de ter tráfego custa escrita e não paga
-- leitura. Medir com dado real e então decidir.
create extension if not exists btree_gin with schema extensions;

-- -----------------------------------------------------------------------------
-- hypopg + index_advisor — decidir índice com medida em vez de palpite
-- -----------------------------------------------------------------------------
-- hypopg cria índices HIPOTÉTICOS (só no catálogo da sessão, sem escrever dado)
-- e o index_advisor da Supabase usa isso para dizer, para uma consulta concreta,
-- qual índice mudaria o plano e quanto. Com ~50 tabelas e RLS em todas, isso
-- vale mais que intuição.
--
-- Custo em produção: zero. Nenhuma das duas roda sozinha — só respondem quando
-- alguém as chama de propósito numa sessão de análise.
create extension if not exists hypopg with schema extensions;
create extension if not exists index_advisor with schema extensions;
