-- Usuários inclusos e domínio próprio, decisões do dono em 2026-09-16:
--
--   Equipe 8 → 5 usuários inclusos · Rede 20 → 10 (Corretor 1 e Imobiliária 3 seguem)
--   Assento extra passa a subir com o plano: 49 / 59 / 69 / 79 por mês
--   `feature_custom_domain` sai do catálogo: toda imobiliária usa o subdomínio
--   incluso da nossa plataforma, e não há domínio próprio para vender
--
-- Espelho de PLANS[*].usersIncluded e FEATURE_KEYS em packages/core/src/billing.

-- 1. Semente do teste grátis (limites do Equipe, TRIAL_LIMITS no core).
create or replace function private.billing_trial_defaults(out limits jsonb, out features text[])
language sql
stable
set search_path = ''
as $$
  select
    '{"users": 5, "landing_pages": 50, "owned_listings": 50, "photos_per_listing": 10, "pipelines": 10, "ai_conversations": 10}'::jsonb,
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

-- 2. Assinaturas existentes.
--
-- `limits.users` NÃO é o número incluso: é incluso + assentos extras comprados.
-- Por isso a condição casa com o valor antigo exato — quem comprou assento fica
-- de fora e continua com o que pagou, até a próxima sincronização com a Stripe
-- recalcular a partir do catálogo novo.
update public.billing_accounts
set limits = limits || '{"users": 5}'::jsonb
where plan_key = 'equipe'
  and limits -> 'users' = to_jsonb(8);

update public.billing_accounts
set limits = limits || '{"users": 10}'::jsonb
where plan_key = 'rede'
  and limits -> 'users' = to_jsonb(20);

update public.billing_accounts
set limits = limits || '{"users": 5}'::jsonb
where plan_key = 'trial'
  and limits -> 'users' = to_jsonb(8);

-- 3. Domínio próprio sai de todas as assinaturas (na 20260916040507 ele tinha
--    saído só fora do Rede, quando ainda era add-on pago).
update public.billing_accounts
set features = array_remove(features, 'feature_custom_domain')
where 'feature_custom_domain' = any(features);
