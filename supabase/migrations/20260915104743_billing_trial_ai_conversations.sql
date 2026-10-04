-- =============================================================================
-- Teste grátis com 10 conversas de IA (antes 20)
-- =============================================================================
-- Redefine private.billing_trial_defaults com a mesma assinatura, os mesmos
-- recursos e os demais limites do plano equipe (TRIAL_LIMITS no core).
-- Vale só para imobiliárias criadas daqui em diante: as linhas já existentes
-- em public.billing_accounts não são alteradas (mudam pela sincronização).
create or replace function private.billing_trial_defaults(out limits jsonb, out features text[])
language sql
stable
set search_path = ''
as $$
  select
    '{"users": 8, "landing_pages": 50, "storage_gb": 100, "pipelines": 10, "ai_conversations": 10}'::jsonb,
    array[
      'feature_properties', 'feature_condominiums', 'feature_listing_score',
      'feature_capture_public_form', 'feature_keys', 'feature_proposals', 'feature_clients',
      'feature_calendar_tasks', 'feature_leads_kanban', 'feature_multiple_pipelines',
      'feature_landing_pages', 'feature_portal_feed_vrsync', 'feature_team_roles_invites',
      'feature_tenant_subdomain', 'feature_custom_domain', 'feature_data_export',
      'feature_assisted_migration'
    ]::text[];
$$;

revoke all on function private.billing_trial_defaults() from public, anon, authenticated;
