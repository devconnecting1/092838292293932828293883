-- =============================================================================
-- A régua de fotos deixa de ser GB e passa a ser "imóveis próprios"
-- =============================================================================
-- Decisão do dono em 2026-09-16. Motivo: GB não significa nada para um corretor
-- e não é o que custa; o que custa é imóvel com foto hospedada por nós. Imóvel
-- importado por XML/API aponta para a foto na origem (media.external_url, que o
-- mapper do feed já aceita) e não consome nada — por isso pode ser ilimitado.
--
-- limits.storage_gb  →  limits.owned_listings + limits.photos_per_listing
--   Corretor 50/15 · Imobiliária 200/20 · Equipe 600/25 · Rede 2.000/30
--
-- Espelho de LIMIT_KEYS e PLANS em packages/core/src/billing.

-- 1. Chaves aceitas no jsonb `limits` (validação de escrita da sincronização).
create or replace function private.billing_limits_ok(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_value) = 'object' then not exists (
      select 1
      from jsonb_each(p_value) as e
      where e.key not in (
              'users', 'landing_pages', 'owned_listings', 'photos_per_listing',
              'pipelines', 'ai_conversations', 'whatsapp_numbers',
              'rental_contracts', 'esign_docs', 'branches'
            )
         or jsonb_typeof(e.value) <> 'number'
         or (e.value #>> '{}') !~ '^(-1|[0-9]{1,9})$'
    )
    else false
  end;
$$;

revoke all on function private.billing_limits_ok(jsonb) from public, anon, authenticated;

-- 2. Teste grátis: limites do Equipe com IA reduzida (TRIAL_LIMITS no core).
--    `feature_custom_domain` sai da lista: virou add-on pago e só vem incluso
--    no plano Rede, então o teste não pode prometê-lo.
create or replace function private.billing_trial_defaults(out limits jsonb, out features text[])
language sql
stable
set search_path = ''
as $$
  select
    '{"users": 8, "landing_pages": 50, "owned_listings": 600, "photos_per_listing": 25, "pipelines": 10, "ai_conversations": 10}'::jsonb,
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

-- 3. Assinaturas existentes: troca a chave antiga pelas duas novas, por plano.
--    Nenhum outro limite, recurso ou dado da imobiliária é tocado.
update public.billing_accounts as b
set limits = (b.limits - 'storage_gb')
  || jsonb_build_object('owned_listings', p.owned, 'photos_per_listing', p.photos)
from (values
  ('corretor', 50, 15),
  ('imobiliaria', 200, 20),
  ('equipe', 600, 25),
  ('rede', 2000, 30)
) as p(plan_key, owned, photos)
where b.plan_key = p.plan_key;

-- O teste grátis segue o Equipe.
update public.billing_accounts
set limits = (limits - 'storage_gb')
  || '{"owned_listings": 600, "photos_per_listing": 25}'::jsonb
where plan_key = 'trial';

-- Sobrou alguma linha com a chave antiga (plano fora da tabela)? Ela sai, senão
-- a próxima sincronização é recusada por billing_limits_ok.
update public.billing_accounts
set limits = limits - 'storage_gb'
where limits ? 'storage_gb';

-- 4. Domínio próprio deixa de vir incluso fora do plano Rede (virou add-on).
update public.billing_accounts
set features = array_remove(features, 'feature_custom_domain')
where plan_key <> 'rede'
  and 'feature_custom_domain' = any(features);
