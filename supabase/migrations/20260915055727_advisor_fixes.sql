-- =============================================================================
-- 1100 - Correções apontadas pelo Supabase Advisor
-- =============================================================================

-- private.organization_counters: o advisor aponta "RLS disabled".
-- A tabela não tem grants para anon/authenticated e o schema private não é
-- exposto na API, mas habilitamos RLS (sem políticas) como defesa em
-- profundidade. O único acesso é private.next_counter(), security definer
-- do dono da tabela (postgres), que não é afetado pelo RLS.
alter table private.organization_counters enable row level security;
revoke all on table private.organization_counters from anon, authenticated;

-- Observação para migrações futuras: os privilégios padrão do Supabase no
-- schema public concedem a anon/authenticated acesso a TODA tabela e EXECUTE a
-- TODA função nova. Tabelas novas precisam de RLS habilitado e funções
-- security definer precisam de "revoke execute ... from public, anon" explícito.
