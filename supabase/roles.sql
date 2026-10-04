-- =============================================================================
-- Banco LOCAL com a mesma base do projeto na nuvem (só Supabase CLI local)
-- =============================================================================
-- O Supabase CLI roda este arquivo (nome fixo: supabase/roles.sql) em
-- `supabase db start` e `supabase db reset` LOCAIS, depois do schema inicial e
-- ANTES das migrações. Ele nunca é aplicado na nuvem. Existe para o CI do banco
-- (.github/workflows/banco.yml) aplicar as migrações no mesmo cenário da nuvem.
-- Conferido no projeto na nuvem em 17/09/2026 (pg_extension e pg_default_acl).

-- 1. pg_net: na nuvem foi ligado pelo painel (nenhuma migração o cria) e as
--    rotinas de rodízio de leads, lembretes e página de status chamam
--    net.http_post/net.http_get. No CLI local ele só vem ligado com
--    [experimental.webhooks].
create extension if not exists pg_net with schema extensions;

-- 2. Privilégios padrão do schema public: o projeto na nuvem foi criado com os
--    GRANTs padrão para anon, authenticated e service_role em tabelas, funções e
--    sequências novas criadas por postgres. O CLI passou a poder revogar esses
--    padrões no banco local (campo api.auto_expose_new_tables, que deixa de
--    existir em 30/10/2026). Aqui eles voltam, para os testes de grants verem o
--    mesmo que a nuvem; as migrações seguem revogando o que não deve ficar exposto.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
