-- Adicional "+10 imóveis com foto" (pacotes com quantidade na assinatura).
--
-- O servidor lê a quantidade de pacotes nos itens da assinatura da Stripe
-- (lookup_key addon_owned_listings_{monthly|yearly}) e grava:
--   · owned_listing_packs: quantidade contratada (nova coluna);
--   · addon_keys: ['owned_listings'] quando há pacote;
--   · limits.owned_listings: limite do plano + 10 por pacote (mesmo padrão de
--     limits.users = incluídos + extras). Os gatilhos de limite
--     (private.enforce_billing_owned_listings, ..._status) e a fila de fotos da
--     importação leem private.billing_limit(org, 'owned_listings'), então já
--     consideram os pacotes sem duplicar o tamanho do pacote no SQL.

alter table public.billing_accounts
  add column owned_listing_packs integer not null default 0
    constraint billing_accounts_owned_listing_packs_check
      check (owned_listing_packs between 0 and 1000);

-- Membros já leem seats, addon_keys e limits (grant por coluna): o mesmo para os pacotes.
grant select (owned_listing_packs) on public.billing_accounts to authenticated;

comment on column public.billing_accounts.owned_listing_packs is
  'Pacotes do adicional "+10 imóveis com foto" contratados na assinatura da Stripe (quantidade do item addon_owned_listings_*). O limite somado fica em limits.owned_listings, gravado pelo servidor; só sync_billing_account escreve.';

create or replace function public.sync_billing_account(
  p_server_key text default null::text,
  p_organization_id uuid default null::uuid,
  p_payload jsonb default null::jsonb
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_allowed constant text[] := array[
    'stripe_customer_id', 'stripe_subscription_id', 'plan_key', 'billing_interval', 'status',
    'seats', 'owned_listing_packs', 'addon_keys', 'limits', 'features', 'current_period_end',
    'cancel_at_period_end'
  ];
  v_plans constant text[] := array['trial', 'corretor', 'imobiliaria', 'equipe', 'rede'];
  v_statuses constant text[] := array[
    'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'
  ];
  v_field text;
  v_value jsonb;
  v_customer text;
  v_keys text[];
  v_ts timestamptz;
  v_limits jsonb;
  v_features text[];
  v_row public.billing_accounts%rowtype;
begin
  if not private.billing_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 16384 then
    raise exception 'Payload inválido: envie um objeto JSON de até 16 KB.' using errcode = '22023';
  end if;

  select k.name into v_field
  from jsonb_object_keys(p_payload) as k (name)
  where not (k.name = any (v_allowed))
  order by k.name
  limit 1;

  if v_field is not null then
    raise exception 'Campo desconhecido: %.', v_field using errcode = '22023', detail = v_field;
  end if;

  v_value := p_payload -> 'stripe_customer_id';
  if v_value is null
     or jsonb_typeof(v_value) <> 'string'
     or (v_value #>> '{}') !~ '^cus_[A-Za-z0-9]{1,250}$' then
    perform private.billing_invalid_field('stripe_customer_id');
  end if;
  v_customer := v_value #>> '{}';

  if p_organization_id is null
     or not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception 'Imobiliária não encontrada.' using errcode = 'P0002';
  end if;

  select b.* into v_row
  from public.billing_accounts b
  where b.organization_id = p_organization_id
  for update;

  if not found then
    select d.limits, d.features into v_limits, v_features
    from private.billing_trial_defaults() as d;

    v_row.organization_id := p_organization_id;
    v_row.plan_key := 'trial';
    v_row.status := 'trialing';
    v_row.seats := private.billing_seats_from_limits(v_limits);
    v_row.owned_listing_packs := 0;
    v_row.addon_keys := '{}';
    v_row.limits := v_limits;
    v_row.features := v_features;
    v_row.trial_ends_at := now() + interval '14 days';
    v_row.cancel_at_period_end := false;
  end if;

  if v_row.stripe_customer_id is not null and v_row.stripe_customer_id <> v_customer then
    raise exception 'billing_customer_divergente' using errcode = 'P0001';
  end if;
  v_row.stripe_customer_id := v_customer;

  if p_payload ? 'stripe_subscription_id' then
    v_value := p_payload -> 'stripe_subscription_id';
    if jsonb_typeof(v_value) = 'null' then
      v_row.stripe_subscription_id := null;
    elsif jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') ~ '^sub_[A-Za-z0-9]{1,250}$' then
      v_row.stripe_subscription_id := v_value #>> '{}';
    else
      perform private.billing_invalid_field('stripe_subscription_id');
    end if;
  end if;

  v_value := p_payload -> 'plan_key';
  if v_value is not null and jsonb_typeof(v_value) <> 'null' then
    if jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') = any (v_plans) then
      v_row.plan_key := v_value #>> '{}';
    else
      perform private.billing_invalid_field('plan_key');
    end if;
  end if;

  if p_payload ? 'billing_interval' then
    v_value := p_payload -> 'billing_interval';
    if jsonb_typeof(v_value) = 'null' then
      v_row.billing_interval := null;
    elsif jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') in ('month', 'year') then
      v_row.billing_interval := v_value #>> '{}';
    else
      perform private.billing_invalid_field('billing_interval');
    end if;
  end if;

  v_value := p_payload -> 'status';
  if v_value is not null and jsonb_typeof(v_value) <> 'null' then
    if jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') = any (v_statuses) then
      v_row.status := v_value #>> '{}';
    else
      perform private.billing_invalid_field('status');
    end if;
  end if;

  v_value := p_payload -> 'seats';
  if v_value is not null and jsonb_typeof(v_value) <> 'null' then
    if jsonb_typeof(v_value) = 'number'
       and (v_value #>> '{}') ~ '^[0-9]{1,5}$'
       and (v_value #>> '{}')::integer between 1 and 10000 then
      v_row.seats := (v_value #>> '{}')::integer;
    else
      perform private.billing_invalid_field('seats');
    end if;
  end if;

  -- Pacotes do adicional de imóveis: inteiro de 0 a 1000. Ausente mantém o atual.
  v_value := p_payload -> 'owned_listing_packs';
  if v_value is not null and jsonb_typeof(v_value) <> 'null' then
    if jsonb_typeof(v_value) = 'number'
       and (v_value #>> '{}') ~ '^[0-9]{1,4}$'
       and (v_value #>> '{}')::integer between 0 and 1000 then
      v_row.owned_listing_packs := (v_value #>> '{}')::integer;
    else
      perform private.billing_invalid_field('owned_listing_packs');
    end if;
  end if;

  v_value := p_payload -> 'addon_keys';
  if v_value is not null and jsonb_typeof(v_value) <> 'null' then
    v_keys := private.billing_jsonb_keys(v_value, 50, '^[a-z][a-z0-9_]{0,59}$');
    if v_keys is null then
      perform private.billing_invalid_field('addon_keys');
    end if;
    v_row.addon_keys := v_keys;
  end if;

  v_value := p_payload -> 'features';
  if v_value is not null and jsonb_typeof(v_value) <> 'null' then
    v_keys := private.billing_jsonb_keys(v_value, 100, '^feature_[a-z0-9_]{1,60}$');
    if v_keys is null then
      perform private.billing_invalid_field('features');
    end if;
    v_row.features := v_keys;
  end if;

  v_value := p_payload -> 'limits';
  if v_value is not null and jsonb_typeof(v_value) <> 'null' then
    if not private.billing_limits_ok(v_value) then
      perform private.billing_invalid_field('limits');
    end if;
    v_row.limits := v_value;
  end if;

  if p_payload ? 'current_period_end' then
    v_value := p_payload -> 'current_period_end';
    if jsonb_typeof(v_value) = 'null' then
      v_row.current_period_end := null;
    else
      v_ts := private.billing_jsonb_timestamptz(v_value);
      if v_ts is null then
        perform private.billing_invalid_field('current_period_end');
      end if;
      v_row.current_period_end := v_ts;
    end if;
  end if;

  v_value := p_payload -> 'cancel_at_period_end';
  if v_value is not null and jsonb_typeof(v_value) <> 'null' then
    if jsonb_typeof(v_value) = 'boolean' then
      v_row.cancel_at_period_end := (v_value #>> '{}')::boolean;
    else
      perform private.billing_invalid_field('cancel_at_period_end');
    end if;
  end if;

  insert into public.billing_accounts as b (
    organization_id, stripe_customer_id, stripe_subscription_id, plan_key, billing_interval,
    status, seats, owned_listing_packs, addon_keys, limits, features, trial_ends_at,
    current_period_end, cancel_at_period_end, synced_at
  )
  values (
    v_row.organization_id, v_row.stripe_customer_id, v_row.stripe_subscription_id, v_row.plan_key,
    v_row.billing_interval, v_row.status, v_row.seats, v_row.owned_listing_packs, v_row.addon_keys,
    v_row.limits, v_row.features, v_row.trial_ends_at, v_row.current_period_end,
    v_row.cancel_at_period_end, now()
  )
  on conflict (organization_id) do update
  set stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id,
      plan_key = excluded.plan_key,
      billing_interval = excluded.billing_interval,
      status = excluded.status,
      seats = excluded.seats,
      owned_listing_packs = excluded.owned_listing_packs,
      addon_keys = excluded.addon_keys,
      limits = excluded.limits,
      features = excluded.features,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      synced_at = excluded.synced_at;
end;
$function$;

comment on function public.sync_billing_account(text, uuid, jsonb) is
  'Upsert idempotente do resumo de billing (webhook da Stripe e ações de assinatura), só com BILLING_SERVER_KEY. Aceita owned_listing_packs (0 a 1000) e limits já somados pelo servidor (users com extras, owned_listings com 10 por pacote).';

create or replace function public.get_billing_overview(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_row public.billing_accounts%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null or not private.is_member(p_organization_id) then
    raise exception 'Você não tem acesso a esta imobiliária.' using errcode = '42501';
  end if;

  select b.* into v_row
  from public.billing_accounts b
  where b.organization_id = p_organization_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'organization_id', v_row.organization_id,
    'state', case
      when v_row.platform_blocked_at is not null then 'read_only'
      else private.billing_state_at(v_row.status, v_row.plan_key, v_row.trial_ends_at, v_row.current_period_end, now())
    end,
    'status', v_row.status,
    'plan_key', v_row.plan_key,
    'billing_interval', v_row.billing_interval,
    'seats', v_row.seats,
    'owned_listing_packs', v_row.owned_listing_packs,
    'addon_keys', to_jsonb(v_row.addon_keys),
    'limits', v_row.limits,
    'features', to_jsonb(v_row.features),
    'usage', jsonb_build_object(
      'users', private.billing_seats_in_use(p_organization_id),
      'landing_pages', (
        select count(*)::integer
        from public.landing_pages lp
        where lp.organization_id = p_organization_id
          and lp.status = 'published'
      ),
      'active_properties', (
        select count(*)::integer
        from public.properties p
        where p.organization_id = p_organization_id
          and p.status = 'active'
      )
    ),
    'trial_ends_at', v_row.trial_ends_at,
    'current_period_end', v_row.current_period_end,
    'cancel_at_period_end', v_row.cancel_at_period_end,
    'has_subscription', v_row.stripe_subscription_id is not null,
    'platform_blocked', v_row.platform_blocked_at is not null,
    'synced_at', v_row.synced_at
  );
end;
$function$;
