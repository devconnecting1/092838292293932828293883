-- Uma landing page no ar por assinatura, em todos os planos (decisão do dono,
-- 2026-09-16). Antes: Corretor 3, Imobiliária 15, Equipe 50, Rede ilimitado.
--
-- Os 9 modelos continuam disponíveis em qualquer plano e o cliente troca de
-- modelo quando quiser; o que é único é a página **publicada**. Não existe, e
-- não passa a existir, add-on de página extra.
--
-- `private.enforce_billing_landing_pages` já aplicava o limite contando só
-- `status = 'published'`, então nada além do número muda. Quem hoje tem mais de
-- uma página no ar **não é despublicado** — o gatilho só age na próxima
-- publicação. Nenhum dado de cliente é apagado.
--
-- Espelho de PLANS[*].limits.landing_pages em packages/core/src/billing/plans.ts.

update public.billing_accounts
set limits = limits || '{"landing_pages": 1}'::jsonb
where limits -> 'landing_pages' is distinct from to_jsonb(1);

-- Semente do teste grátis (limites do Equipe, TRIAL_LIMITS no core).
create or replace function private.billing_trial_defaults(out limits jsonb, out features text[])
language sql
stable
set search_path = ''
as $$
  select
    '{"users": 5, "landing_pages": 1, "owned_listings": 50, "photos_per_listing": 10, "pipelines": 10, "ai_conversations": 10}'::jsonb,
    array[
      'feature_properties', 'feature_condominiums', 'feature_listing_score',
      'feature_capture_public_form', 'feature_keys', 'feature_proposals', 'feature_clients',
      'feature_calendar_tasks', 'feature_leads_kanban', 'feature_multiple_pipelines',
      'feature_landing_pages', 'feature_portal_feed_vrsync', 'feature_team_roles_invites',
      'feature_tenant_subdomain', 'feature_data_export',
      'feature_assisted_migration'
    ]::text[];
$$;

revoke all on function private.billing_trial_defaults() from public, anon, authenticated;
