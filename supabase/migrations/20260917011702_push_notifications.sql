-- =============================================================================
-- Avisos no celular (Web Push com VAPID)
-- =============================================================================
-- 1. public.push_subscriptions: uma linha por aparelho (endpoint) do usuário.
--    Cada um lê e remove só as suas; endpoint e chaves não saem para o app
--    (SELECT por coluna) e só o servidor, com NOTIFICATION_SERVER_KEY, os lê.
-- 2. private.lead_notifications.push_sent_at: marca o push de cada aviso da
--    fila, para o reenvio do e-mail (nova tentativa) não repetir o push.
-- 3. RPCs da sessão: register_push_subscription, sync_push_subscription e
--    unregister_push_subscription.
-- 4. RPCs do servidor (chave publishable + NOTIFICATION_SERVER_KEY):
--    claim_lead_notification_pushes e settle_push_deliveries.

-- -----------------------------------------------------------------------------
-- 1. Inscrições de push
-- -----------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Modo subdomínio: o aparelho foi ligado no endereço de uma imobiliária e só
  -- recebe os avisos dela (o clique abre o mesmo endereço). Host único: null,
  -- recebe os avisos de todas as imobiliárias do usuário.
  organization_id uuid references public.organizations (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_secret text not null,
  device_label text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_delivered_at timestamptz,
  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_endpoint_check
    check (endpoint ~ '^https://[^[:space:]]+$' and char_length(endpoint) <= 1024),
  constraint push_subscriptions_p256dh_check
    check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  constraint push_subscriptions_auth_secret_check
    check (auth_secret ~ '^[A-Za-z0-9_-]{16,32}$'),
  constraint push_subscriptions_device_label_check
    check (device_label is null or char_length(device_label) between 1 and 60)
);

create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);
create index push_subscriptions_organization_id_idx on public.push_subscriptions (organization_id);

comment on table public.push_subscriptions is
  'Aparelhos com avisos no celular (Web Push) ligados. Uma linha por endpoint; cada usuário lê e remove só as suas. Endpoint e chaves só saem pelas RPCs do servidor (NOTIFICATION_SERVER_KEY).';
comment on column public.push_subscriptions.organization_id is
  'Modo subdomínio: só recebe os avisos desta imobiliária. Null (host único): recebe os avisos de todas as imobiliárias do usuário.';
comment on column public.push_subscriptions.endpoint is
  'URL do serviço de push do navegador (capacidade secreta). Nunca vai para log nem para o app.';
comment on column public.push_subscriptions.p256dh is
  'Chave pública do aparelho (base64url, sem padding) para cifrar a mensagem.';
comment on column public.push_subscriptions.auth_secret is
  'Segredo de autenticação do aparelho (base64url, sem padding).';
comment on column public.push_subscriptions.device_label is
  'Rótulo curto do aparelho (ex.: "Chrome no Android"), derivado do navegador; nunca o user-agent completo.';
comment on column public.push_subscriptions.last_delivered_at is
  'Último aviso de lead aceito pelo serviço de push.';

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions: cada um lê as suas"
  on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "push_subscriptions: cada um remove as suas"
  on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- Escrita só pelas funções abaixo (sem policy de INSERT/UPDATE).
revoke all on public.push_subscriptions from public, anon, authenticated;
-- SELECT por coluna: endpoint, p256dh e auth_secret ficam de fora.
grant select (
  id, user_id, organization_id, device_label, created_at, last_seen_at, last_delivered_at
) on public.push_subscriptions to authenticated;
grant delete on public.push_subscriptions to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Marca de push por aviso da fila
-- -----------------------------------------------------------------------------
alter table private.lead_notifications
  add column if not exists push_sent_at timestamptz;

comment on column private.lead_notifications.push_sent_at is
  'Quando o push deste aviso foi reservado para envio (uma vez por aviso, mesmo que o e-mail volte para a fila).';

-- -----------------------------------------------------------------------------
-- 3. RPCs da sessão
-- -----------------------------------------------------------------------------
create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_device_label text default null,
  p_organization_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_label text := nullif(left(btrim(coalesce(p_device_label, '')), 60), '');
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_organization_id is not null and not exists (
    select 1
    from public.memberships m
    where m.organization_id = p_organization_id
      and m.user_id = v_user
      and m.active
  ) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  -- O endpoint é do navegador: se outra pessoa usou este aparelho antes, ele
  -- passa para quem ligou os avisos agora (e deixa de avisar a anterior).
  insert into public.push_subscriptions as s (
    user_id, organization_id, endpoint, p256dh, auth_secret, device_label
  )
  values (v_user, p_organization_id, p_endpoint, p_p256dh, p_auth, v_label)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        organization_id = excluded.organization_id,
        p256dh = excluded.p256dh,
        auth_secret = excluded.auth_secret,
        device_label = excluded.device_label,
        created_at = case when s.user_id = excluded.user_id then s.created_at else now() end,
        last_seen_at = now(),
        last_delivered_at = case when s.user_id = excluded.user_id then s.last_delivered_at end
  returning s.id into v_id;

  -- Teto de 10 aparelhos por usuário: sai o visto há mais tempo.
  delete from public.push_subscriptions s
  where s.id in (
    select x.id
    from public.push_subscriptions x
    where x.user_id = v_user
    order by x.last_seen_at desc, x.created_at desc
    offset 10
  );

  return v_id;
end;
$$;

comment on function public.register_push_subscription(text, text, text, text, uuid) is
  'Sessão: liga os avisos no aparelho atual (upsert pelo endpoint; o aparelho passa para o usuário logado). Com imobiliária, exige membership ativa. Mantém até 10 aparelhos por usuário.';

create or replace function public.sync_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  update public.push_subscriptions s
  set p256dh = p_p256dh,
      auth_secret = p_auth,
      last_seen_at = now()
  where s.endpoint = p_endpoint
    and s.user_id = v_user
  returning s.id into v_id;

  return v_id;
end;
$$;

comment on function public.sync_push_subscription(text, text, text) is
  'Sessão: confere se o aparelho atual está ligado para o usuário logado e atualiza as chaves. Devolve o id ou null (nunca cria nem toma o aparelho de outra pessoa).';

create or replace function public.unregister_push_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  delete from public.push_subscriptions s
  where s.endpoint = p_endpoint
    and s.user_id = v_user;

  return found;
end;
$$;

comment on function public.unregister_push_subscription(text) is
  'Sessão: desliga os avisos no aparelho atual (só se o endpoint for do usuário logado).';

revoke all on function public.register_push_subscription(text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.sync_push_subscription(text, text, text) from public, anon, authenticated;
revoke all on function public.unregister_push_subscription(text) from public, anon, authenticated;
grant execute on function public.register_push_subscription(text, text, text, text, uuid) to authenticated;
grant execute on function public.sync_push_subscription(text, text, text) to authenticated;
grant execute on function public.unregister_push_subscription(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. RPCs do servidor (NOTIFICATION_SERVER_KEY)
-- -----------------------------------------------------------------------------
create or replace function public.claim_lead_notification_pushes(
  p_server_key text,
  p_notification_ids uuid[]
)
returns table (
  notification_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth_secret text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.check_notification_server_key(p_server_key);

  if coalesce(cardinality(p_notification_ids), 0) = 0 then
    return;
  end if;

  if cardinality(p_notification_ids) > 200 then
    raise exception 'Lote acima de 200 avisos.' using errcode = '22023';
  end if;

  return query
  with marcados as (
    update private.lead_notifications n
    set push_sent_at = now()
    where n.id = any (p_notification_ids)
      and n.push_sent_at is null
      and n.created_at > now() - interval '1 day'
    returning n.id, n.user_id, n.organization_id
  )
  select m.id, s.id, s.endpoint, s.p256dh, s.auth_secret
  from marcados m
  join public.memberships ms
    on ms.organization_id = m.organization_id
   and ms.user_id = m.user_id
   and ms.active
  join public.push_subscriptions s
    on s.user_id = m.user_id
   and (s.organization_id is null or s.organization_id = m.organization_id);
end;
$$;

comment on function public.claim_lead_notification_pushes(text, uuid[]) is
  'Servidor Next (chave publishable + NOTIFICATION_SERVER_KEY): marca o push dos avisos (uma vez por aviso) e devolve os aparelhos do destinatário com membership ativa. Aviso já marcado não volta: o reenvio do e-mail não repete o push.';

create or replace function public.settle_push_deliveries(
  p_server_key text,
  p_delivered uuid[] default '{}'::uuid[],
  p_gone uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivered integer := 0;
  v_removed integer := 0;
begin
  perform private.check_notification_server_key(p_server_key);

  update public.push_subscriptions s
  set last_delivered_at = now()
  where s.id = any (coalesce(p_delivered, '{}'::uuid[]));
  get diagnostics v_delivered = row_count;

  delete from public.push_subscriptions s
  where s.id = any (coalesce(p_gone, '{}'::uuid[]));
  get diagnostics v_removed = row_count;

  return jsonb_build_object('delivered', v_delivered, 'removed', v_removed);
end;
$$;

comment on function public.settle_push_deliveries(text, uuid[], uuid[]) is
  'Servidor Next: registra os pushes aceitos e remove os aparelhos com inscrição expirada (404/410 do serviço de push).';

revoke all on function public.claim_lead_notification_pushes(text, uuid[]) from public, anon, authenticated;
revoke all on function public.settle_push_deliveries(text, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.claim_lead_notification_pushes(text, uuid[]) to anon;
grant execute on function public.settle_push_deliveries(text, uuid[], uuid[]) to anon;
