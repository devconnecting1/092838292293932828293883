-- Cotas finais de imóveis próprios, definidas pelo dono em 2026-09-16, logo
-- depois da migração 20260916040507 (que trocou a régua de GB por imóveis):
--
--   Corretor 5 · Imobiliária 20 · Equipe 50 · Rede 150
--   Fotos por imóvel: 10 em TODOS os planos
--   Tamanho máximo por foto: 7 MB em todos (constante do produto, não é limite
--   de plano — fica em LISTING_PHOTO_MAX_BYTES no core e em MAX_IMAGE_BYTES no app)
--
-- Com estes números, 1.000 clientes no limite máximo ocupam ~46 GB: cabe
-- inteiro nos 100 GB inclusos do Supabase Pro, sem um centavo de excedente.
--
-- Espelho de PLANS[*].limits em packages/core/src/billing/plans.ts.

update public.billing_accounts as b
set limits = b.limits
  || jsonb_build_object('owned_listings', p.owned, 'photos_per_listing', p.photos)
from (values
  ('corretor', 5, 10),
  ('imobiliaria', 20, 10),
  ('equipe', 50, 10),
  ('rede', 150, 10)
) as p(plan_key, owned, photos)
where b.plan_key = p.plan_key;

-- O teste grátis segue o Equipe.
update public.billing_accounts
set limits = limits || '{"owned_listings": 50, "photos_per_listing": 10}'::jsonb
where plan_key = 'trial';

-- Mesmos números na semente do teste grátis (TRIAL_LIMITS no core).
create or replace function private.billing_trial_defaults(out limits jsonb, out features text[])
language sql
stable
set search_path = ''
as $$
  select
    '{"users": 8, "landing_pages": 50, "owned_listings": 50, "photos_per_listing": 10, "pipelines": 10, "ai_conversations": 10}'::jsonb,
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
