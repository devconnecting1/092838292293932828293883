-- =============================================================================
-- Índices que faltavam em três chaves estrangeiras para auth.users
-- =============================================================================
-- Apontados pelo Performance Advisor (0001 unindexed_foreign_keys) depois das
-- migrações commissions e connected_accounts. Apagar um usuário faz o Postgres
-- procurar as linhas filhas pela coluna da FK (SET NULL para limpar, RESTRICT
-- para recusar); sem índice que comece por essa coluna, é varredura inteira.

-- FK updated_by (SET NULL): uma linha por imobiliária, mas toda FK tem índice.
create index if not exists commission_settings_updated_by_idx
  on public.commission_settings (updated_by);

-- FK user_id (SET NULL): commission_shares_user_idx e commission_shares_pending_idx
-- começam por organization_id e não servem. Os dois ficam (extrato e pendências
-- por imobiliária).
create index if not exists commission_shares_user_only_idx
  on public.commission_shares (user_id);

-- FK accepted_by (RESTRICT): tabela append-only, cresce sem parar.
create index if not exists connection_terms_acceptances_accepted_by_idx
  on public.connection_terms_acceptances (accepted_by);
