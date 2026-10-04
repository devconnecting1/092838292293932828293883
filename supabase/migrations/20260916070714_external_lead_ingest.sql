-- Entrada de leads das origens externas (o caminho de volta dos portais).
--
--  1. Enums lead_integration_provider, lead_integration_status e lead_delivery_status
--  2. Segredo lead_ingest_server_key no Vault (env LEAD_INGEST_SERVER_KEY)
--  3. public.lead_integrations: a conta de terceiro que a imobiliária conectou.
--     A credencial do CLIENTE fica cifrada no Vault (vault.secrets), nunca em
--     coluna de texto; a tabela guarda só o id do segredo. O endereço do
--     webhook do Canal Pro é protegido por um token aleatório gerado AQUI,
--     no mesmo molde do `feed_token` do VRSync.
--  4. public.lead_integration_deliveries: uma linha por entrega recebida, com o
--     que virou lead e o que foi recusado (e por quê). A chave única
--     (organization_id, provider, external_event_id) é a idempotência das
--     reentregas (a Meta repete por até 36 h; o Grupo OLX, 3 vezes + 14 dias).
--  5. RPCs do servidor (chave do Vault, nunca service_role):
--     ingest_webhook_lead, register_lead_delivery, ingest_external_lead,
--     fail_lead_delivery, claim_lead_deliveries, list_lead_integrations_for_poll,
--     save_lead_integration_state, record_lead_integration_test e
--     read_lead_integration_secret
--  6. RPCs da sessão (papel dono/gerente): enable_lead_webhook,
--     connect_lead_integration, disconnect_lead_integration e
--     get_lead_integrations_overview
--
-- O lead gravado aqui passa pelos mesmos gatilhos de sempre: leads_apply_roulette
-- (rodízio, quando ligado), leads_before_write (normalização e prazo) e
-- leads_log_events (histórico). Nada de caminho paralelo.

-- -----------------------------------------------------------------------------
-- 1. Enums e utilitário de data
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t where t.typname = 'lead_integration_provider') then
    create type public.lead_integration_provider as enum ('canal_pro', 'meta_lead_ads');
  end if;

  if not exists (select 1 from pg_type t where t.typname = 'lead_integration_status') then
    create type public.lead_integration_status as enum ('disconnected', 'connected', 'error');
  end if;

  if not exists (select 1 from pg_type t where t.typname = 'lead_delivery_status') then
    create type public.lead_delivery_status as enum (
      'pending', 'accepted', 'duplicate', 'rejected', 'failed', 'ignored'
    );
  end if;
end;
$$;

-- Data informada por uma origem externa: texto hostil vira timestamptz ou null.
create or replace function private.try_timestamptz(value text)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
begin
  return value::timestamptz;
exception when others then
  return null;
end;
$$;

revoke all on function private.try_timestamptz(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Chave do servidor (Vault)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets s where s.name = 'lead_ingest_server_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'lead_ingest_server_key',
      'Chave do servidor Next para as RPCs de entrada de leads externos (env LEAD_INGEST_SERVER_KEY).'
    );
  end if;
end;
$$;

create or replace function private.lead_ingest_server_key_ok(p_server_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from vault.decrypted_secrets ds
    where ds.name = 'lead_ingest_server_key'
      and p_server_key is not null
      and extensions.digest(p_server_key, 'sha256') = extensions.digest(ds.decrypted_secret, 'sha256')
  );
$$;

revoke all on function private.lead_ingest_server_key_ok(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Integrações conectadas
-- -----------------------------------------------------------------------------
create table if not exists public.lead_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider public.lead_integration_provider not null,
  status public.lead_integration_status not null default 'disconnected',
  -- Identificador da conta do cliente na origem: Page ID da Meta. É por ele que
  -- a entrega do webhook da Meta encontra a imobiliária.
  external_account_id text
    constraint lead_integrations_account_format
      check (external_account_id ~ '^[A-Za-z0-9._:-]{1,120}$'),
  -- Segredo da URL do webhook do Canal Pro. O fluxo "Receber leads no CRM" do
  -- Canal Pro só pede uma URL: não há assinatura nem token deles. Quem protege
  -- é este token aleatório (24 bytes do gen_random_bytes), igual ao feed_token
  -- do VRSync. URL previsível = qualquer um injeta lead falso no funil alheio.
  webhook_token text
    constraint lead_integrations_webhook_token_format check (webhook_token ~ '^[a-f0-9]{48}$'),
  -- Como a conta aparece na tela (nome da página, nome do anunciante).
  account_label text check (char_length(account_label) <= 120),
  -- Configuração NÃO secreta (nunca credencial): rótulos e ids de formulário.
  config jsonb not null default '{}'::jsonb
    constraint lead_integrations_config_format
      check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 4096),
  -- Ponteiro para o segredo do cliente em vault.secrets. A credencial em si
  -- nunca aparece nesta tabela nem em nenhuma coluna de texto.
  secret_id uuid,
  -- Onde a leitura periódica parou, quando houver: { "since": "..." }.
  poll_cursor jsonb not null default '{}'::jsonb
    constraint lead_integrations_cursor_format
      check (jsonb_typeof(poll_cursor) = 'object' and octet_length(poll_cursor::text) <= 2048),
  connected_at timestamptz,
  connected_by uuid references auth.users (id) on delete set null,
  -- Última entrega recebida (aceita ou não).
  last_event_at timestamptz,
  -- Última conversa bem-sucedida com a origem.
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text check (char_length(last_error) <= 300),
  last_test_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_integrations_organization_provider_key unique (organization_id, provider),
  -- Conectado exige um caminho de entrega: a conta na origem (Meta) ou o
  -- endereço com token (Canal Pro).
  constraint lead_integrations_connected_needs_route
    check (status = 'disconnected' or external_account_id is not null or webhook_token is not null)
);

comment on table public.lead_integrations is
  'Conta de terceiro conectada pela imobiliária para receber leads (Canal Pro do Grupo OLX e Meta Lead Ads). A conta é sempre do cliente: nós nunca intermediamos o custo de uso dela. A credencial fica cifrada no Vault; aqui só o id do segredo.';
comment on column public.lead_integrations.secret_id is
  'Id em vault.secrets do token do cliente. Lido só por read_lead_integration_secret (chave do servidor). Fora do grant de SELECT do app.';
comment on column public.lead_integrations.webhook_token is
  'Segredo do endereço /api/webhooks/grupo-olx/[token]. Fora do grant de SELECT: sai só por get_lead_integrations_overview e enable_lead_webhook (dono/gerente).';

create index if not exists lead_integrations_organization_idx
  on public.lead_integrations (organization_id);
create index if not exists lead_integrations_connected_by_idx
  on public.lead_integrations (connected_by);
-- Uma conta da origem pertence a uma imobiliária só: sem isso, uma entrega
-- poderia cair no funil errado.
create unique index if not exists lead_integrations_provider_account_key
  on public.lead_integrations (provider, external_account_id)
  where external_account_id is not null;
create unique index if not exists lead_integrations_webhook_token_key
  on public.lead_integrations (webhook_token)
  where webhook_token is not null;
-- Fila da leitura periódica.
create index if not exists lead_integrations_poll_idx
  on public.lead_integrations (provider, status, last_success_at);

drop trigger if exists lead_integrations_set_updated_at on public.lead_integrations;
create trigger lead_integrations_set_updated_at
  before update on public.lead_integrations
  for each row execute function private.set_updated_at();

drop trigger if exists lead_integrations_lock_organization_id on public.lead_integrations;
create trigger lead_integrations_lock_organization_id
  before update on public.lead_integrations
  for each row execute function private.lock_organization_id();

alter table public.lead_integrations enable row level security;

-- -----------------------------------------------------------------------------
-- 4. Entregas recebidas
-- -----------------------------------------------------------------------------
create table if not exists public.lead_integration_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider public.lead_integration_provider not null,
  -- Id do evento na origem (leadgen_id da Meta, originLeadId do Grupo OLX).
  external_event_id text not null
    check (char_length(external_event_id) between 1 and 200),
  status public.lead_delivery_status not null default 'pending',
  -- Código estável (ver packages/core/src/leads/ingest.ts); a tela traduz.
  reason text check (char_length(reason) <= 60),
  -- Complemento curto e sem dado sensível (ex.: "HTTP 401").
  detail text check (char_length(detail) <= 300),
  -- Site em que a pessoa preencheu: zapimoveis, vivareal, olx, facebook…
  origin text check (char_length(origin) <= 40),
  -- ListingID publicado no feed VRSync (= properties.code), quando informado.
  listing_code text check (char_length(listing_code) <= 50),
  -- Nome do contato, para a imobiliária reconhecer a entrega recusada.
  contact_name text check (char_length(contact_name) <= 120),
  lead_id uuid,
  attempts smallint not null default 0 check (attempts between 0 and 50),
  next_attempt_at timestamptz,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint lead_integration_deliveries_event_key
    unique (organization_id, provider, external_event_id),
  constraint lead_integration_deliveries_lead_fkey
    foreign key (organization_id, lead_id)
    references public.leads (organization_id, id) on delete set null (lead_id)
);

comment on table public.lead_integration_deliveries is
  'Uma linha por entrega recebida de uma origem externa. A chave única (organization_id, provider, external_event_id) é a idempotência: a origem pode reenviar a mesma entrega sem criar um segundo lead. Guarda o resultado e o motivo, nunca o payload cru.';

create index if not exists lead_integration_deliveries_organization_received_idx
  on public.lead_integration_deliveries (organization_id, received_at desc);
create index if not exists lead_integration_deliveries_lead_idx
  on public.lead_integration_deliveries (organization_id, lead_id);
-- Fila de reprocessamento (o webhook da Meta guarda só o id do lead).
create index if not exists lead_integration_deliveries_pending_idx
  on public.lead_integration_deliveries (next_attempt_at)
  where status in ('pending', 'failed');
-- Expurgo por idade.
create index if not exists lead_integration_deliveries_received_idx
  on public.lead_integration_deliveries (received_at);

alter table public.lead_integration_deliveries enable row level security;

-- -----------------------------------------------------------------------------
-- 5. RLS e grants (leitura pela gestão; escrita só pelas RPCs)
-- -----------------------------------------------------------------------------
drop policy if exists "lead_integrations: dono e gerente leem" on public.lead_integrations;
create policy "lead_integrations: dono e gerente leem"
  on public.lead_integrations for select to authenticated
  using ((select private.has_role(organization_id, '{owner,manager}')));

drop policy if exists "lead_integration_deliveries: dono e gerente leem"
  on public.lead_integration_deliveries;
create policy "lead_integration_deliveries: dono e gerente leem"
  on public.lead_integration_deliveries for select to authenticated
  using ((select private.has_role(organization_id, '{owner,manager}')));

revoke all on public.lead_integrations from anon;
revoke all on public.lead_integration_deliveries from anon;
revoke insert, update, delete, truncate, trigger, references
  on public.lead_integrations from authenticated;
revoke insert, update, delete, truncate, trigger, references
  on public.lead_integration_deliveries from authenticated;

-- secret_id, webhook_token e poll_cursor ficam FORA do SELECT do app: dois são
-- segredos e o terceiro é estado interno. O endereço do webhook sai só pela
-- RPC do painel. Coluna nova precisa entrar aqui para o app enxergar.
grant select (
  id, organization_id, provider, status, external_account_id, account_label, config,
  connected_at, connected_by, last_event_at, last_success_at, last_error_at, last_error,
  last_test_at, created_at, updated_at
) on public.lead_integrations to authenticated;
grant select on public.lead_integration_deliveries to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Conectar, desconectar e ver (sessão, dono ou gerente)
-- -----------------------------------------------------------------------------

-- Canal Pro: a imobiliária não tem credencial para colar — quem cola somos nós,
-- do lado dela, no painel do Canal Pro. Esta função devolve (e, com p_rotate,
-- troca) o token do endereço. Trocar invalida o endereço anterior na hora: é o
-- que salva quando a URL vaza num print de suporte.
create or replace function public.enable_lead_webhook(
  p_organization_id uuid,
  p_provider text,
  p_rotate boolean default false,
  p_account_label text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.lead_integration_provider;
  v_token text;
begin
  if not (select private.has_role(p_organization_id, '{owner,manager}')) then
    raise exception 'Seu papel nesta imobiliária não permite conectar integrações.'
      using errcode = '42501';
  end if;

  begin
    v_provider := p_provider::public.lead_integration_provider;
  exception when others then
    raise exception 'Integração desconhecida.' using errcode = '22023';
  end;

  if v_provider <> 'canal_pro' then
    raise exception 'Esta integração não usa endereço de webhook.' using errcode = '22023';
  end if;

  select li.webhook_token into v_token
  from public.lead_integrations li
  where li.organization_id = p_organization_id
    and li.provider = v_provider;

  if v_token is null or p_rotate then
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
  end if;

  insert into public.lead_integrations as t (
    organization_id, provider, status, webhook_token, account_label,
    connected_at, connected_by, last_error, last_error_at
  )
  values (
    p_organization_id, v_provider, 'connected', v_token,
    nullif(btrim(coalesce(p_account_label, '')), ''),
    now(), (select auth.uid()), null, null
  )
  on conflict (organization_id, provider) do update
  set status = 'connected',
      webhook_token = excluded.webhook_token,
      account_label = coalesce(excluded.account_label, t.account_label),
      connected_at = coalesce(t.connected_at, now()),
      connected_by = (select auth.uid()),
      last_error = null,
      last_error_at = null;

  return v_token;
end;
$$;

comment on function public.enable_lead_webhook(uuid, text, boolean, text) is
  'Liga o recebimento de leads do Canal Pro e devolve o token do endereço. Com p_rotate, gera um novo e derruba o anterior na hora. Exige dono ou gerente.';

revoke all on function public.enable_lead_webhook(uuid, text, boolean, text) from public, anon;
grant execute on function public.enable_lead_webhook(uuid, text, boolean, text) to authenticated;

-- Meta Lead Ads: a credencial (Page access token de longa duração) entra pelo
-- Vault e sai do alcance do app na mesma transação. Reconectar troca o segredo
-- existente em vez de criar outro.
create or replace function public.connect_lead_integration(
  p_organization_id uuid,
  p_provider text,
  p_external_account_id text,
  p_credential text,
  p_account_label text default null,
  p_config jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.lead_integration_provider;
  v_account text := nullif(btrim(coalesce(p_external_account_id, '')), '');
  v_credential text := nullif(btrim(coalesce(p_credential, '')), '');
  v_label text := nullif(btrim(coalesce(p_account_label, '')), '');
  v_config jsonb := coalesce(p_config, '{}'::jsonb);
  v_secret_id uuid;
  v_existing_secret uuid;
  v_owner uuid;
begin
  if not (select private.has_role(p_organization_id, '{owner,manager}')) then
    raise exception 'Seu papel nesta imobiliária não permite conectar integrações.'
      using errcode = '42501';
  end if;

  begin
    v_provider := p_provider::public.lead_integration_provider;
  exception when others then
    raise exception 'Integração desconhecida.' using errcode = '22023';
  end;

  if v_account is null or v_account !~ '^[A-Za-z0-9._:-]{1,120}$' then
    raise exception 'Informe o identificador da conta na origem.' using errcode = '22023';
  end if;

  if v_credential is null
     or char_length(v_credential) not between 8 and 4096
     or v_credential ~ '[[:space:][:cntrl:]]' then
    raise exception 'Cole a credencial da sua conta (sem espaços).' using errcode = '22023';
  end if;

  if jsonb_typeof(v_config) <> 'object' or octet_length(v_config::text) > 4096 then
    raise exception 'Configuração inválida.' using errcode = '22023';
  end if;

  -- A mesma conta da origem não pode servir a duas imobiliárias.
  select li.organization_id into v_owner
  from public.lead_integrations li
  where li.provider = v_provider
    and li.external_account_id = v_account
    and li.organization_id <> p_organization_id
  limit 1;

  if v_owner is not null then
    raise exception 'Esta conta já está conectada em outra imobiliária.' using errcode = '23505';
  end if;

  select li.secret_id into v_existing_secret
  from public.lead_integrations li
  where li.organization_id = p_organization_id
    and li.provider = v_provider;

  if v_existing_secret is not null
     and exists (select 1 from vault.secrets s where s.id = v_existing_secret) then
    perform vault.update_secret(v_existing_secret, v_credential);
    v_secret_id := v_existing_secret;
  else
    v_secret_id := vault.create_secret(
      v_credential,
      'lead_integration:' || p_organization_id::text || ':' || v_provider::text || ':'
        || encode(extensions.gen_random_bytes(8), 'hex'),
      'Credencial da conta do cliente para a entrada de leads. Só sai do Vault pela RPC read_lead_integration_secret.'
    );
  end if;

  insert into public.lead_integrations (
    organization_id, provider, status, external_account_id, account_label, config,
    secret_id, poll_cursor, connected_at, connected_by, last_error, last_error_at
  )
  values (
    p_organization_id, v_provider, 'connected', v_account, v_label, v_config,
    v_secret_id, '{}'::jsonb, now(), (select auth.uid()), null, null
  )
  on conflict (organization_id, provider) do update
  set status = 'connected',
      external_account_id = excluded.external_account_id,
      account_label = excluded.account_label,
      config = excluded.config,
      secret_id = excluded.secret_id,
      connected_at = now(),
      connected_by = (select auth.uid()),
      last_error = null,
      last_error_at = null;
end;
$$;

comment on function public.connect_lead_integration(uuid, text, text, text, text, jsonb) is
  'Liga (ou religa) a conta da própria imobiliária numa origem de leads. Exige dono ou gerente. A credencial vai direto para o Vault: nem esta função nem a tabela devolvem o valor.';

revoke all on function public.connect_lead_integration(uuid, text, text, text, text, jsonb)
  from public, anon;
grant execute on function public.connect_lead_integration(uuid, text, text, text, text, jsonb)
  to authenticated;

create or replace function public.disconnect_lead_integration(
  p_organization_id uuid,
  p_provider text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.lead_integration_provider;
  v_secret_id uuid;
begin
  if not (select private.has_role(p_organization_id, '{owner,manager}')) then
    raise exception 'Seu papel nesta imobiliária não permite desconectar integrações.'
      using errcode = '42501';
  end if;

  begin
    v_provider := p_provider::public.lead_integration_provider;
  exception when others then
    raise exception 'Integração desconhecida.' using errcode = '22023';
  end;

  update public.lead_integrations li
  set status = 'disconnected',
      secret_id = null,
      webhook_token = null,
      poll_cursor = '{}'::jsonb,
      external_account_id = null,
      connected_at = null,
      last_error = null,
      last_error_at = null
  where li.organization_id = p_organization_id
    and li.provider = v_provider
  returning li.secret_id into v_secret_id;

  -- A credencial do cliente é apagada de verdade: desconectar tem que devolver
  -- o controle da conta a quem é dono dela.
  if v_secret_id is not null then
    delete from vault.secrets s where s.id = v_secret_id;
  end if;
end;
$$;

revoke all on function public.disconnect_lead_integration(uuid, text) from public, anon;
grant execute on function public.disconnect_lead_integration(uuid, text) to authenticated;

-- Painel da tela /configuracoes/integracoes: as integrações (com o endereço do
-- webhook), as últimas entregas e as contagens dos últimos 30 dias, numa
-- consulta só.
create or replace function public.get_lead_integrations_overview(
  p_organization_id uuid,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  if not (select private.has_role(p_organization_id, '{owner,manager}')) then
    raise exception 'Seu papel nesta imobiliária não permite ver as integrações.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'integrations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'provider', li.provider,
          'status', li.status,
          'external_account_id', li.external_account_id,
          'account_label', li.account_label,
          'webhook_token', li.webhook_token,
          'has_credential', li.secret_id is not null,
          'config', li.config,
          'connected_at', li.connected_at,
          'last_event_at', li.last_event_at,
          'last_success_at', li.last_success_at,
          'last_error_at', li.last_error_at,
          'last_error', li.last_error,
          'last_test_at', li.last_test_at
        )
        order by li.provider
      )
      from public.lead_integrations li
      where li.organization_id = p_organization_id
    ), '[]'::jsonb),
    'deliveries', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.received_at desc)
      from (
        select
          del.id,
          del.provider,
          del.status,
          del.reason,
          del.detail,
          del.origin,
          del.listing_code,
          del.contact_name,
          del.lead_id,
          del.occurred_at,
          del.received_at
        from public.lead_integration_deliveries del
        where del.organization_id = p_organization_id
        order by del.received_at desc
        limit v_limit
      ) d
    ), '[]'::jsonb),
    'totals', coalesce((
      select jsonb_agg(
        jsonb_build_object('provider', t.provider, 'status', t.status, 'total', t.total)
      )
      from (
        select del.provider::text as provider, del.status::text as status, count(*) as total
        from public.lead_integration_deliveries del
        where del.organization_id = p_organization_id
          and del.received_at > now() - interval '30 days'
        group by 1, 2
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_lead_integrations_overview(uuid, integer) from public, anon;
grant execute on function public.get_lead_integrations_overview(uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Gravação da entrega (núcleo compartilhado)
-- -----------------------------------------------------------------------------

-- Fecha (ou cria) a linha da entrega com o resultado.
create or replace function private.settle_lead_delivery(
  p_organization_id uuid,
  p_provider public.lead_integration_provider,
  p_event text,
  p_status public.lead_delivery_status,
  p_reason text,
  p_detail text,
  p_origin text,
  p_listing text,
  p_contact_name text,
  p_lead_id uuid,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lead_integration_deliveries as del (
    organization_id, provider, external_event_id, status, reason, detail, origin,
    listing_code, contact_name, lead_id, occurred_at, attempts, next_attempt_at, settled_at
  )
  values (
    p_organization_id, p_provider, p_event, p_status, p_reason, p_detail, p_origin,
    p_listing, p_contact_name, p_lead_id, p_occurred_at, 1, null, now()
  )
  on conflict (organization_id, provider, external_event_id) do update
  set status = excluded.status,
      reason = excluded.reason,
      detail = excluded.detail,
      origin = coalesce(excluded.origin, del.origin),
      listing_code = coalesce(excluded.listing_code, del.listing_code),
      contact_name = coalesce(excluded.contact_name, del.contact_name),
      lead_id = coalesce(excluded.lead_id, del.lead_id),
      occurred_at = coalesce(excluded.occurred_at, del.occurred_at),
      attempts = least(del.attempts + 1, 50),
      next_attempt_at = null,
      settled_at = now();

  update public.lead_integrations li
  set last_event_at = now(),
      last_success_at = now(),
      last_error = null,
      last_error_at = null,
      status = case when li.status = 'error' then 'connected'::public.lead_integration_status
                    else li.status end
  where li.organization_id = p_organization_id
    and li.provider = p_provider;

  -- Expurgo em lotes: o histórico da tela é operacional, não arquivo morto.
  delete from public.lead_integration_deliveries old
  where old.id in (
    select d.id
    from public.lead_integration_deliveries d
    where d.received_at < now() - interval '180 days'
    order by d.received_at
    limit 200
    for update skip locked
  );

  return jsonb_build_object('status', p_status, 'reason', p_reason, 'lead_id', p_lead_id);
end;
$$;

revoke all on function private.settle_lead_delivery(
  uuid, public.lead_integration_provider, text, public.lead_delivery_status, text, text, text,
  text, text, uuid, timestamptz
) from public, anon, authenticated;

-- Grava o lead que chegou de fora. Chamada pelos dois caminhos públicos.
-- p_payload: { event_id, name, email, phone, message, interest, listing_code,
--              origin, occurred_at, utm }
-- Devolve { status, reason, lead_id }:
--   accepted  = virou lead (e entrou no rodízio, se ligado)
--   duplicate = entrega repetida, ou a mesma pessoa já entrou nas últimas 24 h
--   rejected  = faltou nome ou contato (o motivo fica na entrega)
create or replace function private.ingest_external_lead_row(
  p_organization_id uuid,
  p_provider public.lead_integration_provider,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_name text;
  v_email text;
  v_phone text;
  v_message text;
  v_interest text;
  v_listing text;
  v_origin text;
  v_occurred timestamptz;
  v_utm jsonb := '{}'::jsonb;
  v_source public.lead_source;
  v_property uuid;
  v_lead uuid;
  v_existing uuid;
  v_reason text;
  v_hash text;
  v_event_uuid uuid;
begin
  v_source := case when p_provider = 'meta_lead_ads' then 'social'::public.lead_source
                   else 'portal'::public.lead_source end;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 16384 then
    raise exception 'Dados da entrega inválidos.' using errcode = '22023';
  end if;

  v_event := nullif(btrim(coalesce(p_payload ->> 'event_id', '')), '');

  if v_event is null or char_length(v_event) > 200 then
    raise exception 'Entrega sem identificador.' using errcode = '22023';
  end if;

  v_name := left(btrim(coalesce(p_payload ->> 'name', '')), 120);
  v_email := nullif(lower(btrim(coalesce(p_payload ->> 'email', ''))), '');
  v_phone := nullif(regexp_replace(coalesce(p_payload ->> 'phone', ''), '[^0-9]', '', 'g'), '');
  v_message := nullif(left(btrim(coalesce(p_payload ->> 'message', '')), 2000), '');
  v_interest := nullif(lower(btrim(coalesce(p_payload ->> 'interest', ''))), '');
  v_listing := nullif(left(btrim(coalesce(p_payload ->> 'listing_code', '')), 50), '');
  v_origin := nullif(left(btrim(coalesce(p_payload ->> 'origin', '')), 40), '');
  v_occurred := private.try_timestamptz(p_payload ->> 'occurred_at');

  if v_email is not null and (
    char_length(v_email) > 254
    or v_email !~ '^[a-z0-9._+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
    or position('..' in v_email) > 0
  ) then
    v_email := null;
  end if;

  if v_phone is not null and v_phone !~ '^[0-9]{10,13}$' then
    v_phone := null;
  end if;

  if v_interest is not null and v_interest not in ('buy', 'rent', 'invest', 'sell', 'info') then
    v_interest := null;
  end if;

  if jsonb_typeof(p_payload -> 'utm') = 'object' then
    select coalesce(jsonb_object_agg(e.key, left(btrim(e.value #>> '{}'), 150)), '{}'::jsonb)
      into v_utm
    from jsonb_each(p_payload -> 'utm') as e
    where e.key in ('source', 'medium', 'campaign', 'content', 'term')
      and jsonb_typeof(e.value) in ('string', 'number')
      and btrim(e.value #>> '{}') <> '';
  end if;

  if char_length(v_name) < 2 then
    v_reason := 'sem_nome';
  elsif v_email is null and v_phone is null then
    v_reason := 'sem_contato';
  end if;

  -- Serializa as entregas da mesma imobiliária: a deduplicação e a
  -- idempotência valem mesmo com dois webhooks chegando ao mesmo tempo.
  perform pg_advisory_xact_lock(
    hashtextextended('ingest_external_lead:' || p_organization_id::text, 0)
  );

  if v_reason is not null then
    return private.settle_lead_delivery(
      p_organization_id, p_provider, v_event, 'rejected', v_reason, null,
      v_origin, v_listing, nullif(v_name, ''), null, v_occurred
    );
  end if;

  -- 1) Entrega já processada antes (a origem reenviou).
  select del.lead_id into v_existing
  from public.lead_integration_deliveries del
  where del.organization_id = p_organization_id
    and del.provider = p_provider
    and del.external_event_id = v_event
    and del.status in ('accepted', 'duplicate');

  if found then
    return jsonb_build_object(
      'status', 'duplicate', 'reason', 'entrega_repetida', 'lead_id', v_existing
    );
  end if;

  -- 2) Mesma pessoa entrou há pouco (mesma regra de lead_duplicate_flags:
  --    últimos 11 dígitos do telefone OU e-mail em minúsculas).
  select l.id into v_existing
  from public.leads l
  where l.organization_id = p_organization_id
    and l.created_at > now() - interval '24 hours'
    and (
      (v_phone is not null and right(l.phone, 11) = right(v_phone, 11))
      or (v_email is not null and lower(l.email) = v_email)
    )
  order by l.created_at desc
  limit 1;

  if v_existing is not null then
    return private.settle_lead_delivery(
      p_organization_id, p_provider, v_event, 'duplicate', 'mesma_pessoa', null,
      v_origin, v_listing, v_name, v_existing, v_occurred
    );
  end if;

  -- Anúncio: o ListingID que publicamos no feed VRSync é properties.code.
  if v_listing is not null then
    select p.id into v_property
    from public.properties p
    where p.organization_id = p_organization_id
      and upper(p.code) = upper(v_listing)
    limit 1;
  end if;

  -- event_id determinístico: mesmo que a entrega saia daquela tabela, o índice
  -- único (organization_id, event_id) de leads impede um segundo lead.
  v_hash := encode(extensions.digest(p_provider::text || ':' || v_event, 'sha256'), 'hex');
  v_event_uuid := (
    substr(v_hash, 1, 8) || '-' || substr(v_hash, 9, 4) || '-' || substr(v_hash, 13, 4)
    || '-' || substr(v_hash, 17, 4) || '-' || substr(v_hash, 21, 12)
  )::uuid;

  insert into public.leads (
    organization_id, name, email, phone, message, interest, source, property_id,
    stage, assigned_to, utm, event_id, consent_at
  )
  values (
    p_organization_id, v_name, v_email, v_phone, v_message, v_interest, v_source, v_property,
    'new', null, v_utm, v_event_uuid, coalesce(v_occurred, now())
  )
  on conflict (organization_id, event_id) where event_id is not null do nothing
  returning id into v_lead;

  if v_lead is null then
    select l.id into v_lead
    from public.leads l
    where l.organization_id = p_organization_id and l.event_id = v_event_uuid;

    return private.settle_lead_delivery(
      p_organization_id, p_provider, v_event, 'duplicate', 'entrega_repetida', null,
      v_origin, v_listing, v_name, v_lead, v_occurred
    );
  end if;

  return private.settle_lead_delivery(
    p_organization_id, p_provider, v_event, 'accepted', null, null,
    v_origin, v_listing, v_name, v_lead, v_occurred
  );
end;
$$;

revoke all on function private.ingest_external_lead_row(
  uuid, public.lead_integration_provider, jsonb
) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. RPCs do servidor (chave do Vault)
-- -----------------------------------------------------------------------------

-- Caminho do Canal Pro: a imobiliária é achada pelo token do endereço. Token
-- errado, ausente ou revogado devolve sempre a mesma coisa, sem revelar se a
-- imobiliária existe (igual a get_portal_feed).
create or replace function public.ingest_webhook_lead(
  p_server_key text,
  p_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_provider public.lead_integration_provider;
  v_recent bigint;
begin
  if not private.lead_ingest_server_key_ok(p_server_key) then
    raise exception 'Não autorizado.' using errcode = '42501';
  end if;

  if p_token is null or p_token !~ '^[a-f0-9]{48}$' then
    return jsonb_build_object('status', 'unknown_account');
  end if;

  select li.organization_id, li.provider into v_org, v_provider
  from public.lead_integrations li
  where li.webhook_token = p_token
    and li.status = 'connected';

  if v_org is null then
    return jsonb_build_object('status', 'unknown_account');
  end if;

  -- Sem assinatura da origem, o único freio é este: o endereço aceita no
  -- máximo 240 entregas por minuto por imobiliária.
  select count(*) into v_recent
  from public.lead_integration_deliveries del
  where del.organization_id = v_org
    and del.received_at > now() - interval '1 minute';

  if v_recent >= 240 then
    raise exception 'Muitas entregas em pouco tempo.' using errcode = '54000';
  end if;

  return private.ingest_external_lead_row(v_org, v_provider, p_payload);
end;
$$;

comment on function public.ingest_webhook_lead(text, text, jsonb) is
  'Entrada do webhook do Canal Pro. A imobiliária vem do token secreto da URL (o fluxo "Receber leads no CRM" do Canal Pro não assina a requisição). Exige a chave do servidor.';

revoke all on function public.ingest_webhook_lead(text, text, jsonb) from public, authenticated;
grant execute on function public.ingest_webhook_lead(text, text, jsonb) to anon;

-- Lê a credencial do cliente para falar com a origem (Graph API). Só o servidor
-- Next, com LEAD_INGEST_SERVER_KEY. Nunca exposta ao navegador nem a uma sessão.
create or replace function public.read_lead_integration_secret(
  p_server_key text,
  p_organization_id uuid,
  p_provider text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_value text;
begin
  if not private.lead_ingest_server_key_ok(p_server_key) then
    raise exception 'Não autorizado.' using errcode = '42501';
  end if;

  select li.secret_id into v_secret_id
  from public.lead_integrations li
  where li.organization_id = p_organization_id
    and li.provider = p_provider::public.lead_integration_provider
    and li.status in ('connected', 'error');

  if v_secret_id is null then
    return null;
  end if;

  select ds.decrypted_secret into v_value
  from vault.decrypted_secrets ds
  where ds.id = v_secret_id;

  return v_value;
end;
$$;

comment on function public.read_lead_integration_secret(text, uuid, text) is
  'Devolve a credencial do cliente guardada no Vault. Exige a chave do servidor (lead_ingest_server_key): sem ela, 42501. Nunca chamada com sessão de usuário.';

revoke all on function public.read_lead_integration_secret(text, uuid, text)
  from public, authenticated;
grant execute on function public.read_lead_integration_secret(text, uuid, text) to anon;

-- Registra a chegada de uma entrega antes de buscar os dados na origem (é o
-- que o webhook da Meta faz: o evento traz só o id do lead).
create or replace function public.register_lead_delivery(
  p_server_key text,
  p_provider text,
  p_external_account_id text,
  p_external_event_id text,
  p_occurred_at timestamptz default null,
  p_origin text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.lead_integration_provider;
  v_org uuid;
  v_status public.lead_delivery_status;
  v_event text := nullif(btrim(coalesce(p_external_event_id, '')), '');
  v_account text := nullif(btrim(coalesce(p_external_account_id, '')), '');
begin
  if not private.lead_ingest_server_key_ok(p_server_key) then
    raise exception 'Não autorizado.' using errcode = '42501';
  end if;

  v_provider := p_provider::public.lead_integration_provider;

  if v_event is null or char_length(v_event) > 200 or v_account is null then
    raise exception 'Entrega inválida.' using errcode = '22023';
  end if;

  select li.organization_id into v_org
  from public.lead_integrations li
  where li.provider = v_provider
    and li.external_account_id = v_account
    and li.status = 'connected';

  if v_org is null then
    return jsonb_build_object('status', 'unknown_account');
  end if;

  insert into public.lead_integration_deliveries (
    organization_id, provider, external_event_id, status, origin, occurred_at, next_attempt_at
  )
  values (
    v_org, v_provider, v_event, 'pending',
    nullif(left(btrim(coalesce(p_origin, '')), 40), ''), p_occurred_at, now()
  )
  on conflict (organization_id, provider, external_event_id) do nothing;

  if found then
    update public.lead_integrations li
    set last_event_at = now()
    where li.organization_id = v_org and li.provider = v_provider;

    return jsonb_build_object('status', 'pending', 'organization_id', v_org, 'known', false);
  end if;

  select del.status into v_status
  from public.lead_integration_deliveries del
  where del.organization_id = v_org
    and del.provider = v_provider
    and del.external_event_id = v_event;

  return jsonb_build_object('status', v_status, 'organization_id', v_org, 'known', true);
end;
$$;

revoke all on function public.register_lead_delivery(text, text, text, text, timestamptz, text)
  from public, authenticated;
grant execute on function public.register_lead_delivery(text, text, text, text, timestamptz, text)
  to anon;

-- Caminho da Meta: a imobiliária já foi achada por register_lead_delivery.
create or replace function public.ingest_external_lead(
  p_server_key text,
  p_organization_id uuid,
  p_provider text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.lead_integration_provider;
begin
  if not private.lead_ingest_server_key_ok(p_server_key) then
    raise exception 'Não autorizado.' using errcode = '42501';
  end if;

  v_provider := p_provider::public.lead_integration_provider;

  if not exists (
    select 1 from public.lead_integrations li
    where li.organization_id = p_organization_id and li.provider = v_provider
  ) then
    raise exception 'Integração não encontrada.' using errcode = 'P0002';
  end if;

  return private.ingest_external_lead_row(p_organization_id, v_provider, p_payload);
end;
$$;

revoke all on function public.ingest_external_lead(text, uuid, text, jsonb)
  from public, authenticated;
grant execute on function public.ingest_external_lead(text, uuid, text, jsonb) to anon;

-- A origem não respondeu (ou recusou a credencial). Guarda o motivo e agenda a
-- próxima tentativa com espera crescente; na 6ª, desiste.
create or replace function public.fail_lead_delivery(
  p_server_key text,
  p_organization_id uuid,
  p_provider text,
  p_external_event_id text,
  p_reason text,
  p_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.lead_integration_provider;
  v_attempts smallint;
  v_status public.lead_delivery_status;
begin
  if not private.lead_ingest_server_key_ok(p_server_key) then
    raise exception 'Não autorizado.' using errcode = '42501';
  end if;

  v_provider := p_provider::public.lead_integration_provider;

  update public.lead_integration_deliveries del
  set attempts = least(del.attempts + 1, 50),
      reason = left(coalesce(p_reason, 'origem_indisponivel'), 60),
      detail = nullif(left(coalesce(p_detail, ''), 300), ''),
      status = case when del.attempts + 1 >= 6 then 'rejected'::public.lead_delivery_status
                    else 'failed'::public.lead_delivery_status end,
      next_attempt_at = case when del.attempts + 1 >= 6 then null
                             else now() + make_interval(mins => (del.attempts + 1) * 5) end,
      settled_at = case when del.attempts + 1 >= 6 then now() else null end
  where del.organization_id = p_organization_id
    and del.provider = v_provider
    and del.external_event_id = nullif(btrim(coalesce(p_external_event_id, '')), '')
  returning del.attempts, del.status into v_attempts, v_status;

  if v_attempts is null then
    return jsonb_build_object('status', 'unknown');
  end if;

  update public.lead_integrations li
  set last_error = left(coalesce(nullif(btrim(coalesce(p_detail, '')), ''), p_reason, 'erro'), 300),
      last_error_at = now(),
      status = case when p_reason = 'credencial_recusada'
                    then 'error'::public.lead_integration_status
                    else li.status end
  where li.organization_id = p_organization_id
    and li.provider = v_provider;

  return jsonb_build_object('status', v_status, 'attempts', v_attempts);
end;
$$;

revoke all on function public.fail_lead_delivery(text, uuid, text, text, text, text)
  from public, authenticated;
grant execute on function public.fail_lead_delivery(text, uuid, text, text, text, text) to anon;

-- Entregas que ainda precisam dos dados da origem (o webhook da Meta guarda só
-- o id). Reserva o lote empurrando next_attempt_at, para duas execuções não
-- trabalharem em cima da mesma entrega.
create or replace function public.claim_lead_deliveries(
  p_server_key text,
  p_limit integer default 25
)
returns table (
  organization_id uuid,
  provider text,
  external_account_id text,
  external_event_id text,
  attempts smallint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  if not private.lead_ingest_server_key_ok(p_server_key) then
    raise exception 'Não autorizado.' using errcode = '42501';
  end if;

  return query
  with picked as (
    select del.id
    from public.lead_integration_deliveries del
    where del.status in ('pending', 'failed')
      and coalesce(del.next_attempt_at, del.received_at) <= now()
    order by coalesce(del.next_attempt_at, del.received_at)
    limit v_limit
    for update skip locked
  ),
  claimed as (
    update public.lead_integration_deliveries d
    set next_attempt_at = now() + interval '5 minutes'
    from picked
    where d.id = picked.id
    returning d.organization_id as org_id, d.provider as prov,
              d.external_event_id as event_id, d.attempts as tries
  )
  select c.org_id, c.prov::text, li.external_account_id, c.event_id, c.tries
  from claimed c
  join public.lead_integrations li
    on li.organization_id = c.org_id
   and li.provider = c.prov
   and li.status = 'connected';
end;
$$;

revoke all on function public.claim_lead_deliveries(text, integer) from public, authenticated;
grant execute on function public.claim_lead_deliveries(text, integer) to anon;

-- Integrações que uma leitura periódica precisaria visitar. Nenhuma origem usa
-- polling hoje (Canal Pro e Meta são push); fica pronta para a próxima que usar.
create or replace function public.list_lead_integrations_for_poll(
  p_server_key text,
  p_provider text,
  p_limit integer default 50
)
returns table (
  organization_id uuid,
  external_account_id text,
  poll_cursor jsonb,
  last_success_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if not private.lead_ingest_server_key_ok(p_server_key) then
    raise exception 'Não autorizado.' using errcode = '42501';
  end if;

  return query
  select li.organization_id, li.external_account_id, li.poll_cursor, li.last_success_at
  from public.lead_integrations li
  where li.provider = p_provider::public.lead_integration_provider
    and li.status = 'connected'
    and li.external_account_id is not null
  order by li.last_success_at nulls first
  limit v_limit;
end;
$$;

revoke all on function public.list_lead_integrations_for_poll(text, text, integer)
  from public, authenticated;
grant execute on function public.list_lead_integrations_for_poll(text, text, integer) to anon;

-- Resultado de uma rodada de conversa com a origem (ou de um teste de conexão).
create or replace function public.save_lead_integration_state(
  p_server_key text,
  p_organization_id uuid,
  p_provider text,
  p_cursor jsonb default null,
  p_error text default null,
  p_credential_rejected boolean default false,
  p_tested boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.lead_integration_provider;
  v_cursor jsonb := p_cursor;
begin
  if not private.lead_ingest_server_key_ok(p_server_key) then
    raise exception 'Não autorizado.' using errcode = '42501';
  end if;

  v_provider := p_provider::public.lead_integration_provider;

  if v_cursor is not null
     and (jsonb_typeof(v_cursor) <> 'object' or octet_length(v_cursor::text) > 2048) then
    v_cursor := null;
  end if;

  update public.lead_integrations li
  set poll_cursor = coalesce(v_cursor, li.poll_cursor),
      last_success_at = case when p_error is null then now() else li.last_success_at end,
      last_error = case when p_error is null then null else left(p_error, 300) end,
      last_error_at = case when p_error is null then null else now() end,
      last_test_at = case when p_tested then now() else li.last_test_at end,
      status = case
        when p_credential_rejected then 'error'::public.lead_integration_status
        when p_error is null and li.status = 'error'
          then 'connected'::public.lead_integration_status
        else li.status
      end
  where li.organization_id = p_organization_id
    and li.provider = v_provider;
end;
$$;

revoke all on function public.save_lead_integration_state(
  text, uuid, text, jsonb, text, boolean, boolean
) from public, authenticated;
grant execute on function public.save_lead_integration_state(
  text, uuid, text, jsonb, text, boolean, boolean
) to anon;

-- Entrega de teste (botão "Testar conexão"): aparece no histórico da tela sem
-- criar lead nenhum. Guarda no máximo 5 testes por integração.
create or replace function public.record_lead_integration_test(
  p_server_key text,
  p_organization_id uuid,
  p_provider text,
  p_detail text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.lead_integration_provider;
begin
  if not private.lead_ingest_server_key_ok(p_server_key) then
    raise exception 'Não autorizado.' using errcode = '42501';
  end if;

  v_provider := p_provider::public.lead_integration_provider;

  insert into public.lead_integration_deliveries (
    organization_id, provider, external_event_id, status, reason, detail, settled_at
  )
  values (
    p_organization_id, v_provider,
    'teste:' || encode(extensions.gen_random_bytes(8), 'hex'),
    'ignored', 'teste_de_conexao', nullif(left(coalesce(p_detail, ''), 300), ''), now()
  );

  delete from public.lead_integration_deliveries del
  where del.id in (
    select d.id
    from public.lead_integration_deliveries d
    where d.organization_id = p_organization_id
      and d.provider = v_provider
      and d.reason = 'teste_de_conexao'
    order by d.received_at desc
    offset 5
  );
end;
$$;

revoke all on function public.record_lead_integration_test(text, uuid, text, text)
  from public, authenticated;
grant execute on function public.record_lead_integration_test(text, uuid, text, text) to anon;
