-- =============================================================================
-- 3000 - Contas conectadas (a imobiliária conecta a conta DELA)
-- =============================================================================
-- Regra do dono, não negociável: nós cobramos só o software. A conta no
-- fornecedor é do cliente, o fornecedor fatura o cliente, e nós nunca entramos
-- no meio do custo. Este módulo é a fundação genérica desse arranjo — o
-- WhatsApp é o primeiro provedor, não o único.
--
-- Três decisões que estão gravadas no schema, não em documentação:
--
--   1. A CREDENCIAL NUNCA FICA EM COLUNA DE TEXTO. A tabela guarda só o id do
--      segredo no Vault (`credential_secret_id`), e essa coluna não entra no
--      grant de SELECT: nem com sessão de dono ela sai pela API. O token em
--      claro só é devolvido por uma RPC que exige a chave do servidor.
--   2. UMA CONTA DO FORNECEDOR POR IMOBILIÁRIA, E NUNCA COMPARTILHADA. Há
--      `unique (organization_id, provider)` e, globalmente,
--      `unique (provider, external_account_id)` e
--      `unique (provider, external_owner_id)`. No WhatsApp isso significa: um
--      portfólio empresarial e uma WABA por imobiliária, nunca um guarda-chuva
--      nosso. Os limites de envio da Meta são calculados por portfólio e os
--      Tech Provider Terms §2.1 nos tornam solidariamente responsáveis pela
--      conduta de cada cliente: guarda-chuva único faria um cliente disparando
--      lista comprada travar o canal de todos e nos expor ao desligamento.
--   3. TRÊS INTERRUPTORES SEPARADOS, porque juntá-los faz a tela mentir:
--      `status` (o que o fornecedor diz), `enabled` (a imobiliária desligou) e
--      `blocked_at` (nós suspendemos; o cliente vê e não desfaz).
--
--  1. Enums
--  2. private.webhook_events (idempotência genérica de entrega repetida)
--  3. public.connection_terms_acceptances (prova do aceite dos termos)
--  4. public.connected_accounts
--  5. public.connection_events (quem ligou, quem desligou, quando)
--  6. Segredo `connections_server_key` no Vault
--  7. Helpers private
--  8. RPCs com sessão (aceitar termos, ligar/desligar, desconectar)
--  9. RPCs do servidor (conectar, ler credencial, registrar erro, suspender)
-- 10. Grants
--
-- Espelho de packages/core/src/connections/: ao incluir provedor no enum,
-- inclua em CONNECTION_PROVIDER_KEYS e vice-versa.

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------

create type public.connection_provider as enum (
  'whatsapp',
  'instagram',
  'facebook_page',
  'facebook_lead_ads',
  'email_forwarding',
  'telegram'
);

create type public.connection_status as enum ('pending', 'connected', 'error', 'revoked');

create type public.connection_event_action as enum (
  'connected',
  'reconnected',
  'enabled',
  'disabled',
  'blocked',
  'unblocked',
  'terms_accepted',
  'disconnected',
  'error'
);

-- -----------------------------------------------------------------------------
-- 2. private.webhook_events — entrega repetida é normal, efeito repetido não
-- -----------------------------------------------------------------------------
-- Todo fornecedor reentrega webhook quando não recebe 200 a tempo. A chave é
-- do evento (id da entrega, ou hash do que o torna único), nunca do corpo
-- inteiro: o mesmo evento pode chegar com corpo serializado de forma diferente.

create table private.webhook_events (
  provider text not null
    constraint webhook_events_provider_check check (char_length(provider) between 1 and 40),
  event_key text not null
    constraint webhook_events_event_key_check check (char_length(event_key) between 1 and 200),
  payload_sha256 text
    constraint webhook_events_payload_sha256_format check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  primary key (provider, event_key)
);

create index webhook_events_received_at_idx on private.webhook_events (received_at);

alter table private.webhook_events enable row level security;
revoke all on table private.webhook_events from public, anon, authenticated;

comment on table private.webhook_events is
  'Eventos de webhook já processados, por provedor. Só o servidor grava (RPC record_webhook_event). Registros com mais de 7 dias são apagados pela própria RPC, em lote.';

-- -----------------------------------------------------------------------------
-- 3. public.connection_terms_acceptances — a prova do aceite
-- -----------------------------------------------------------------------------
-- Os "Meta Business Messaging and Meta Business Agent Technology Provider
-- Terms" (facebook.com/legal/BM-tech-provider-terms), §2.1, exigem que nenhum
-- cliente use a plataforma antes de aceitar os termos da Meta. A Meta apresenta
-- os termos dela dentro do popup do Embedded Signup, mas NÃO expõe endpoint
-- para consultar esse aceite depois. A evidência auditável, portanto, é a
-- nossa: o texto exibido, a versão, quem aceitou, quando e de onde.
--
-- Tabela APPEND-ONLY: sem política de UPDATE e sem política de DELETE. Aceite
-- não se edita.

create table public.connection_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider public.connection_provider not null,
  terms_key text not null
    constraint connection_terms_acceptances_key_format check (terms_key ~ '^[a-z0-9_]{3,60}$'),
  terms_version text not null
    constraint connection_terms_acceptances_version_check
      check (char_length(terms_version) between 1 and 40),
  terms_url text not null
    constraint connection_terms_acceptances_url_check
      check (terms_url ~* '^https://' and char_length(terms_url) <= 500),
  -- O que a pessoa leu, literal. Guardar a URL não basta: a página muda sem avisar.
  displayed_text text not null
    constraint connection_terms_acceptances_text_check
      check (char_length(displayed_text) between 40 and 8000),
  displayed_text_sha256 text not null
    constraint connection_terms_acceptances_sha_format
      check (displayed_text_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_by uuid not null references auth.users (id) on delete restrict,
  accepted_at timestamptz not null default now(),
  -- Hash do IP (nunca o IP) e user agent truncado: contexto sem dado pessoal cru.
  ip_hash text
    constraint connection_terms_acceptances_ip_hash_format check (ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent text
    constraint connection_terms_acceptances_user_agent_check check (char_length(user_agent) <= 300),
  -- Identificadores devolvidos pelo fornecedor na sessão de conexão
  -- (no WhatsApp: waba_id, business_id, evento do Embedded Signup).
  provider_evidence jsonb not null default '{}'::jsonb
    constraint connection_terms_acceptances_evidence_check
      check (jsonb_typeof(provider_evidence) = 'object'
        and octet_length(provider_evidence::text) <= 4096),
  created_at timestamptz not null default now(),
  constraint connection_terms_acceptances_organization_id_id_key unique (organization_id, id)
);

create index connection_terms_acceptances_lookup_idx
  on public.connection_terms_acceptances (organization_id, provider, accepted_at desc);

alter table public.connection_terms_acceptances enable row level security;

create policy "connection_terms_acceptances: gestão lê"
  on public.connection_terms_acceptances for select to authenticated
  using (private.has_role(organization_id, '{owner,manager,finance}'));

comment on table public.connection_terms_acceptances is
  'Prova de que a imobiliária aceitou os termos do fornecedor antes de conectar (Tech Provider Terms §2.1 no caso da Meta). Append-only: sem UPDATE e sem DELETE. Escrita só pela RPC accept_connection_terms.';

-- -----------------------------------------------------------------------------
-- 4. public.connected_accounts
-- -----------------------------------------------------------------------------

create table public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider public.connection_provider not null,
  status public.connection_status not null default 'pending',
  -- Interruptor da imobiliária: desliga sem apagar nada.
  enabled boolean not null default true,
  -- Interruptor da plataforma: sobrevivência nossa. Só a RPC do servidor mexe.
  blocked_at timestamptz,
  blocked_reason text
    constraint connected_accounts_blocked_reason_check check (char_length(blocked_reason) <= 300),
  -- Conta no fornecedor (no WhatsApp: a WABA).
  external_account_id text not null
    constraint connected_accounts_external_account_id_check
      check (external_account_id ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  -- Dono da conta no fornecedor (no WhatsApp: o portfólio empresarial).
  external_owner_id text
    constraint connected_accounts_external_owner_id_check
      check (external_owner_id ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  display_name text
    constraint connected_accounts_display_name_check check (char_length(display_name) <= 200),
  handle text constraint connected_accounts_handle_check check (char_length(handle) <= 200),
  scopes text[] not null default '{}'
    constraint connected_accounts_scopes_check check (array_length(scopes, 1) is null or array_length(scopes, 1) <= 20),
  -- SÓ o id do segredo no Vault. O token nunca fica aqui, nem em log.
  credential_secret_id uuid,
  credential_expires_at timestamptz,
  last_error_code text
    constraint connected_accounts_last_error_code_check check (char_length(last_error_code) <= 40),
  -- Texto cru do fornecedor: fica fora do grant de SELECT de propósito.
  last_error_message text
    constraint connected_accounts_last_error_message_check check (char_length(last_error_message) <= 500),
  last_error_at timestamptz,
  last_synced_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
    constraint connected_accounts_metadata_check
      check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 4096),
  terms_acceptance_id uuid,
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connected_accounts_organization_provider_key unique (organization_id, provider),
  constraint connected_accounts_organization_id_id_key unique (organization_id, id),
  constraint connected_accounts_terms_fkey foreign key (organization_id, terms_acceptance_id)
    references public.connection_terms_acceptances (organization_id, id) on delete restrict
);

-- A mesma conta do fornecedor NUNCA em duas imobiliárias: é isto que impede o
-- portfólio guarda-chuva e o sequestro de uma WABA já conectada.
create unique index connected_accounts_provider_account_key
  on public.connected_accounts (provider, external_account_id);

create unique index connected_accounts_provider_owner_key
  on public.connected_accounts (provider, external_owner_id)
  where external_owner_id is not null;

create index connected_accounts_organization_idx
  on public.connected_accounts (organization_id, provider);

create index connected_accounts_connected_by_idx
  on public.connected_accounts (connected_by)
  where connected_by is not null;

create index connected_accounts_terms_idx
  on public.connected_accounts (organization_id, terms_acceptance_id)
  where terms_acceptance_id is not null;

create trigger connected_accounts_set_updated_at
  before update on public.connected_accounts
  for each row execute function private.set_updated_at();
create trigger connected_accounts_lock_organization_id
  before update on public.connected_accounts
  for each row execute function private.lock_organization_id();
create trigger connected_accounts_audit
  after insert or update or delete on public.connected_accounts
  for each row execute function private.audit_row_change();

alter table public.connected_accounts enable row level security;

create policy "connected_accounts: membros leem"
  on public.connected_accounts for select to authenticated
  using (private.is_member(organization_id));

comment on table public.connected_accounts is
  'Contas de terceiros que a imobiliária conectou (a conta é dela; o fornecedor fatura ela). Uma por provedor por imobiliária, e a mesma conta do fornecedor nunca em duas imobiliárias. Escrita só pelas RPCs; a credencial fica no Vault.';
comment on column public.connected_accounts.credential_secret_id is
  'Id do segredo no Vault. A coluna fica FORA do grant de SELECT: o token não sai pela API nem para o dono.';
comment on column public.connected_accounts.enabled is
  'Interruptor da imobiliária (set_connection_enabled). Desligado: não envia nem recebe, mas nada é apagado.';
comment on column public.connected_accounts.blocked_at is
  'Interruptor da plataforma (set_connection_platform_block, chave do servidor). O cliente vê o bloqueio e não consegue desfazê-lo.';

-- -----------------------------------------------------------------------------
-- 5. public.connection_events — quem ligou e quem desligou
-- -----------------------------------------------------------------------------

create table public.connection_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  connected_account_id uuid,
  provider public.connection_provider not null,
  action public.connection_event_action not null,
  actor_id uuid references auth.users (id) on delete set null,
  reason text constraint connection_events_reason_check check (char_length(reason) <= 300),
  details jsonb not null default '{}'::jsonb
    constraint connection_events_details_check
      check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 2048),
  created_at timestamptz not null default now(),
  constraint connection_events_account_fkey foreign key (organization_id, connected_account_id)
    references public.connected_accounts (organization_id, id) on delete set null (connected_account_id)
);

create index connection_events_organization_idx
  on public.connection_events (organization_id, created_at desc);
create index connection_events_account_idx
  on public.connection_events (organization_id, connected_account_id, created_at desc)
  where connected_account_id is not null;
create index connection_events_actor_idx
  on public.connection_events (actor_id)
  where actor_id is not null;

alter table public.connection_events enable row level security;

create policy "connection_events: gestão lê"
  on public.connection_events for select to authenticated
  using (private.has_role(organization_id, '{owner,manager,finance}'));

comment on table public.connection_events is
  'Histórico append-only de quem conectou, ligou, desligou ou desconectou cada conta de terceiro. Sem UPDATE e sem DELETE; escrita só pelas RPCs.';

-- -----------------------------------------------------------------------------
-- 6. Segredo `connections_server_key` no Vault
-- -----------------------------------------------------------------------------
-- Gerado aqui; o valor não fica no arquivo da migração.

do $$
begin
  if not exists (select 1 from vault.secrets s where s.name = 'connections_server_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'connections_server_key',
      'Chave do servidor Next para as RPCs sem sessão de contas conectadas e do WhatsApp (env CONNECTIONS_SERVER_KEY).'
    );
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Helpers private
-- -----------------------------------------------------------------------------

create or replace function private.connections_server_key_ok(p_server_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from vault.decrypted_secrets ds
    where ds.name = 'connections_server_key'
      and p_server_key is not null
      and extensions.digest(p_server_key, 'sha256') = extensions.digest(ds.decrypted_secret, 'sha256')
  );
$$;

comment on function private.connections_server_key_ok(text) is
  'Valida a chave do servidor das RPCs de contas conectadas. Compara digest dos dois lados, nunca texto.';

-- Metadados vindos do servidor: objeto pequeno e sem nada que cheire a segredo.
-- Se um dia alguém passar o token aqui por engano, o banco recusa.
create or replace function private.connection_metadata_ok(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is null
    or (
      jsonb_typeof(p_value) = 'object'
      and octet_length(p_value::text) <= 4096
      and (select count(*) from jsonb_object_keys(p_value)) <= 20
      and not exists (
        select 1
        from jsonb_object_keys(p_value) k
        where lower(k) ~ '(token|secret|password|senha|credential|api_key|apikey|access_key|private_key|pin)'
      )
    );
$$;

comment on function private.connection_metadata_ok(jsonb) is
  'Metadados de conta conectada: objeto, <= 4 KB, <= 20 chaves e nenhuma chave com cara de segredo.';

-- Consumo do nonce, no molde de submit_capture_request: a mesma tabela
-- private.capture_request_nonces serve a todas as RPCs sem sessão. Um nonce
-- usado em qualquer uma delas não serve em nenhuma outra.
create or replace function private.consume_server_nonce(p_nonce text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_nonce is null
     or char_length(p_nonce) not between 16 and 512
     or p_nonce !~ '^[[:graph:]]+$' then
    return false;
  end if;

  insert into private.capture_request_nonces (nonce_hash)
  values (encode(extensions.digest(p_nonce, 'sha256'), 'hex'))
  on conflict (nonce_hash) do nothing;

  if not found then
    return false;
  end if;

  -- Limpeza em lote, sem esperar travas.
  delete from private.capture_request_nonces n
  where n.nonce_hash in (
    select c.nonce_hash
    from private.capture_request_nonces c
    where c.created_at < now() - interval '12 hours'
    order by c.created_at
    limit 1000
    for update skip locked
  );

  return true;
end;
$$;

comment on function private.consume_server_nonce(text) is
  'Antirreplay das RPCs sem sessão: grava o sha-256 do nonce e devolve false se já tinha sido usado.';

create or replace function private.connection_event(
  p_organization_id uuid,
  p_connected_account_id uuid,
  p_provider public.connection_provider,
  p_action public.connection_event_action,
  p_actor_id uuid,
  p_reason text,
  p_details jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.connection_events
    (organization_id, connected_account_id, provider, action, actor_id, reason, details)
  values (
    p_organization_id,
    p_connected_account_id,
    p_provider,
    p_action,
    p_actor_id,
    left(nullif(btrim(coalesce(p_reason, '')), ''), 300),
    coalesce(p_details, '{}'::jsonb)
  );
$$;

-- Estado de uma conexão para quem vai enviar: envia só se conectada, ligada e
-- não bloqueada por nós. RECEBER nunca depende disto.
create or replace function private.connection_can_send(p_connected_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.connected_accounts ca
    where ca.id = p_connected_account_id
      and ca.status = 'connected'
      and ca.enabled
      and ca.blocked_at is null
  );
$$;

comment on function private.connection_can_send(uuid) is
  'Verdadeiro só quando a conexão está conectada, ligada pela imobiliária e sem bloqueio da plataforma.';

-- -----------------------------------------------------------------------------
-- 8. RPCs com sessão
-- -----------------------------------------------------------------------------
-- Erros: 42501 sem sessão, sem acesso ou sem papel; 22023 campo inválido;
--        P0002 conexão não encontrada.

create or replace function public.accept_connection_terms(
  p_organization_id uuid,
  p_provider public.connection_provider,
  p_terms_key text,
  p_terms_version text,
  p_terms_url text,
  p_displayed_text text,
  p_ip_hash text default null,
  p_user_agent text default null,
  p_provider_evidence jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
  v_text text := btrim(coalesce(p_displayed_text, ''));
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null
     or not private.has_role(p_organization_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'Só o dono ou o gerente pode aceitar os termos do fornecedor.'
      using errcode = '42501';
  end if;

  if char_length(v_text) not between 40 and 8000 then
    perform private.billing_invalid_field('p_displayed_text');
  end if;

  if p_terms_key is null or p_terms_key !~ '^[a-z0-9_]{3,60}$' then
    perform private.billing_invalid_field('p_terms_key');
  end if;

  if p_terms_url is null or p_terms_url !~* '^https://' or char_length(p_terms_url) > 500 then
    perform private.billing_invalid_field('p_terms_url');
  end if;

  if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$' then
    perform private.billing_invalid_field('p_ip_hash');
  end if;

  insert into public.connection_terms_acceptances (
    organization_id, provider, terms_key, terms_version, terms_url,
    displayed_text, displayed_text_sha256, accepted_by, ip_hash, user_agent, provider_evidence
  )
  values (
    p_organization_id,
    p_provider,
    p_terms_key,
    left(btrim(coalesce(p_terms_version, '')), 40),
    p_terms_url,
    v_text,
    encode(extensions.digest(v_text, 'sha256'), 'hex'),
    v_user,
    p_ip_hash,
    left(nullif(btrim(coalesce(p_user_agent, '')), ''), 300),
    case
      when p_provider_evidence is null or jsonb_typeof(p_provider_evidence) <> 'object'
        then '{}'::jsonb
      when octet_length(p_provider_evidence::text) > 4096 then '{}'::jsonb
      else p_provider_evidence
    end
  )
  returning id into v_id;

  perform private.connection_event(
    p_organization_id, null, p_provider, 'terms_accepted', v_user, null,
    jsonb_build_object('terms_key', p_terms_key, 'terms_version', p_terms_version)
  );

  return v_id;
end;
$$;

comment on function public.accept_connection_terms(uuid, public.connection_provider, text, text, text, text, text, text, jsonb) is
  'Grava a prova de aceite dos termos do fornecedor (texto exibido, versão, quem e quando) e devolve o id, exigido depois por connect_connection_account.';

create or replace function public.set_connection_enabled(
  p_connected_account_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_row public.connected_accounts;
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  select * into v_row from public.connected_accounts where id = p_connected_account_id;

  if v_row.id is null then
    raise exception 'Conexão não encontrada.' using errcode = 'P0002';
  end if;

  if not private.has_role(v_row.organization_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'Só o dono ou o gerente pode ligar e desligar uma conexão.'
      using errcode = '42501';
  end if;

  if p_enabled and v_row.blocked_at is not null then
    raise exception 'Esta conexão está suspensa pela plataforma e não pode ser religada aqui.'
      using errcode = '42501';
  end if;

  if coalesce(p_enabled, true) is not distinct from v_row.enabled then
    return jsonb_build_object('enabled', v_row.enabled, 'changed', false);
  end if;

  update public.connected_accounts
  set enabled = coalesce(p_enabled, true)
  where id = p_connected_account_id;

  perform private.connection_event(
    v_row.organization_id, v_row.id, v_row.provider,
    case when p_enabled then 'enabled' else 'disabled' end,
    v_user, null, '{}'::jsonb
  );

  return jsonb_build_object('enabled', coalesce(p_enabled, true), 'changed', true);
end;
$$;

comment on function public.set_connection_enabled(uuid, boolean) is
  'Interruptor da imobiliária: liga/desliga a conexão sem apagar nada. Recusa religar o que a plataforma suspendeu.';

create or replace function public.disconnect_connection(p_connected_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_row public.connected_accounts;
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  select * into v_row from public.connected_accounts where id = p_connected_account_id;

  if v_row.id is null then
    raise exception 'Conexão não encontrada.' using errcode = 'P0002';
  end if;

  if not private.has_role(v_row.organization_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'Só o dono ou o gerente pode desconectar uma conta.' using errcode = '42501';
  end if;

  -- O segredo some na hora; o histórico da conversa não.
  if v_row.credential_secret_id is not null then
    delete from vault.secrets s where s.id = v_row.credential_secret_id;
  end if;

  update public.connected_accounts
  set status = 'revoked',
      enabled = false,
      credential_secret_id = null,
      credential_expires_at = null,
      last_error_code = null,
      last_error_message = null
  where id = p_connected_account_id;

  perform private.connection_event(
    v_row.organization_id, v_row.id, v_row.provider, 'disconnected', v_user, null, '{}'::jsonb
  );

  return jsonb_build_object('status', 'revoked');
end;
$$;

comment on function public.disconnect_connection(uuid) is
  'Revoga a conexão e apaga o segredo do Vault. O histórico de conversas e mensagens permanece.';

-- -----------------------------------------------------------------------------
-- 9. RPCs do servidor (sem sessão, chave do Vault)
-- -----------------------------------------------------------------------------
-- Todos os parâmetros têm default null de propósito: chamada incompleta recebe
-- o mesmo erro genérico de chave inválida, sem indicar o motivo.

create or replace function public.connect_connection_account(
  p_server_key text default null,
  p_nonce text default null,
  p_organization_id uuid default null,
  p_provider public.connection_provider default null,
  p_external_account_id text default null,
  p_external_owner_id text default null,
  p_display_name text default null,
  p_handle text default null,
  p_scopes text[] default null,
  p_token text default null,
  p_token_expires_at timestamptz default null,
  p_metadata jsonb default null,
  p_connected_by uuid default null,
  p_terms_acceptance_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.connected_accounts;
  v_secret_id uuid;
  v_secret_name text;
  v_existing uuid;
  v_action public.connection_event_action;
begin
  if not private.connections_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_organization_id is null or p_provider is null or p_token is null then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_external_account_id is null or p_external_account_id !~ '^[A-Za-z0-9_.:-]{1,80}$' then
    perform private.billing_invalid_field('p_external_account_id');
  end if;

  if p_external_owner_id is not null and p_external_owner_id !~ '^[A-Za-z0-9_.:-]{1,80}$' then
    perform private.billing_invalid_field('p_external_owner_id');
  end if;

  if char_length(p_token) not between 8 and 4096 then
    perform private.billing_invalid_field('p_token');
  end if;

  if not private.connection_metadata_ok(p_metadata) then
    perform private.billing_invalid_field('p_metadata');
  end if;

  -- Aceite dos termos: exigência dos Tech Provider Terms §2.1. Sem prova
  -- recente, do mesmo provedor e da mesma imobiliária, não conecta.
  if p_terms_acceptance_id is null or not exists (
    select 1
    from public.connection_terms_acceptances t
    where t.id = p_terms_acceptance_id
      and t.organization_id = p_organization_id
      and t.provider = p_provider
      and t.accepted_at > now() - interval '2 hours'
  ) then
    raise exception 'aceite_dos_termos_ausente' using errcode = 'P0001';
  end if;

  -- Antirreplay: conectar é irreversível do lado do fornecedor.
  if not private.consume_server_nonce(p_nonce) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  -- Serializa a imobiliária: dois retornos simultâneos do signup não criam
  -- duas contas.
  perform pg_advisory_xact_lock(
    hashtextextended('connect_connection_account:' || p_organization_id::text, 0)
  );

  -- A mesma conta do fornecedor em OUTRA imobiliária é recusada com mensagem
  -- estável: é o que impede o portfólio guarda-chuva e o sequestro de conta.
  select ca.organization_id into v_existing
  from public.connected_accounts ca
  where ca.provider = p_provider
    and (
      ca.external_account_id = p_external_account_id
      or (p_external_owner_id is not null and ca.external_owner_id = p_external_owner_id)
    )
  limit 1;

  if v_existing is not null and v_existing <> p_organization_id then
    raise exception 'conta_ja_conectada_em_outra_imobiliaria' using errcode = 'P0001';
  end if;

  select * into v_row
  from public.connected_accounts ca
  where ca.organization_id = p_organization_id and ca.provider = p_provider
  for update;

  v_secret_name := 'connection:' || p_provider::text || ':' || p_organization_id::text;

  if v_row.id is null then
    v_action := 'connected';
  else
    v_action := 'reconnected';
    if v_row.credential_secret_id is not null then
      delete from vault.secrets s where s.id = v_row.credential_secret_id;
    end if;
  end if;

  -- O nome do segredo é único por imobiliária e provedor; se sobrou algum de
  -- uma conexão anterior, ele sai antes.
  delete from vault.secrets s where s.name = v_secret_name;
  v_secret_id := vault.create_secret(
    p_token,
    v_secret_name,
    'Credencial da conta conectada (nunca em coluna de texto, nunca em log).'
  );

  if v_row.id is null then
    insert into public.connected_accounts (
      organization_id, provider, status, enabled, external_account_id, external_owner_id,
      display_name, handle, scopes, credential_secret_id, credential_expires_at,
      metadata, terms_acceptance_id, connected_by, connected_at
    )
    values (
      p_organization_id, p_provider, 'connected', true, p_external_account_id, p_external_owner_id,
      left(nullif(btrim(coalesce(p_display_name, '')), ''), 200),
      left(nullif(btrim(coalesce(p_handle, '')), ''), 200),
      coalesce(p_scopes, '{}'), v_secret_id, p_token_expires_at,
      coalesce(p_metadata, '{}'::jsonb), p_terms_acceptance_id, p_connected_by, now()
    )
    returning * into v_row;
  else
    update public.connected_accounts
    set status = 'connected',
        enabled = case when blocked_at is null then true else false end,
        external_account_id = p_external_account_id,
        external_owner_id = p_external_owner_id,
        display_name = left(nullif(btrim(coalesce(p_display_name, '')), ''), 200),
        handle = left(nullif(btrim(coalesce(p_handle, '')), ''), 200),
        scopes = coalesce(p_scopes, '{}'),
        credential_secret_id = v_secret_id,
        credential_expires_at = p_token_expires_at,
        metadata = coalesce(p_metadata, '{}'::jsonb),
        terms_acceptance_id = p_terms_acceptance_id,
        connected_by = coalesce(p_connected_by, connected_by),
        connected_at = now(),
        last_error_code = null,
        last_error_message = null,
        last_error_at = null
    where id = v_row.id
    returning * into v_row;
  end if;

  perform private.connection_event(
    p_organization_id, v_row.id, p_provider, v_action, p_connected_by, null,
    jsonb_build_object('external_account_id', p_external_account_id)
  );

  return jsonb_build_object(
    'connected_account_id', v_row.id,
    'status', v_row.status,
    'enabled', v_row.enabled,
    'blocked', v_row.blocked_at is not null
  );
end;
$$;

comment on function public.connect_connection_account(text, text, uuid, public.connection_provider, text, text, text, text, text[], text, timestamptz, jsonb, uuid, uuid) is
  'Grava a conta conectada e a credencial no Vault. Exige chave do servidor, nonce e prova de aceite dos termos com menos de 2 horas. Recusa conta já conectada em outra imobiliária (P0001 conta_ja_conectada_em_outra_imobiliaria).';

create or replace function public.get_connection_credential(
  p_server_key text default null,
  p_connected_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.connected_accounts;
  v_token text;
begin
  if not private.connections_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select * into v_row from public.connected_accounts where id = p_connected_account_id;

  if v_row.id is null or v_row.credential_secret_id is null then
    raise exception 'Conexão não encontrada.' using errcode = 'P0002';
  end if;

  select ds.decrypted_secret into v_token
  from vault.decrypted_secrets ds
  where ds.id = v_row.credential_secret_id;

  if v_token is null then
    raise exception 'Conexão não encontrada.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'token', v_token,
    'organization_id', v_row.organization_id,
    'provider', v_row.provider,
    'external_account_id', v_row.external_account_id,
    'status', v_row.status,
    'can_send', v_row.status = 'connected' and v_row.enabled and v_row.blocked_at is null,
    'expires_at', v_row.credential_expires_at
  );
end;
$$;

comment on function public.get_connection_credential(text, uuid) is
  'Devolve a credencial em claro SÓ para o servidor (chave do Vault). Nenhuma sessão de usuário consegue chamá-la com sucesso.';

create or replace function public.record_connection_error(
  p_server_key text default null,
  p_connected_account_id uuid default null,
  p_code text default null,
  p_message text default null,
  p_revoked boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.connected_accounts;
begin
  if not private.connections_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select * into v_row from public.connected_accounts where id = p_connected_account_id;

  if v_row.id is null then
    return;
  end if;

  update public.connected_accounts
  set status = case when coalesce(p_revoked, false) then 'revoked'::public.connection_status
                    else 'error'::public.connection_status end,
      last_error_code = left(nullif(btrim(coalesce(p_code, '')), ''), 40),
      last_error_message = left(nullif(btrim(coalesce(p_message, '')), ''), 500),
      last_error_at = now()
  where id = p_connected_account_id;

  perform private.connection_event(
    v_row.organization_id, v_row.id, v_row.provider, 'error', null,
    left(nullif(btrim(coalesce(p_code, '')), ''), 300), '{}'::jsonb
  );
end;
$$;

create or replace function public.set_connection_platform_block(
  p_server_key text default null,
  p_connected_account_id uuid default null,
  p_blocked boolean default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.connected_accounts;
begin
  if not private.connections_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select * into v_row from public.connected_accounts where id = p_connected_account_id;

  if v_row.id is null then
    raise exception 'Conexão não encontrada.' using errcode = 'P0002';
  end if;

  update public.connected_accounts
  set blocked_at = case when p_blocked then now() else null end,
      blocked_reason = case when p_blocked
        then left(nullif(btrim(coalesce(p_reason, '')), ''), 300) else null end,
      enabled = case when p_blocked then false else enabled end
  where id = p_connected_account_id;

  perform private.connection_event(
    v_row.organization_id, v_row.id, v_row.provider,
    case when p_blocked then 'blocked' else 'unblocked' end,
    null, left(nullif(btrim(coalesce(p_reason, '')), ''), 300), '{}'::jsonb
  );

  return jsonb_build_object('blocked', coalesce(p_blocked, false));
end;
$$;

comment on function public.set_connection_platform_block(text, uuid, boolean, text) is
  'Interruptor da plataforma. Bloquear desliga a conexão e o cliente não consegue religar; só o servidor desfaz.';

create or replace function public.record_webhook_event(
  p_server_key text default null,
  p_provider text default null,
  p_event_key text default null,
  p_payload_sha256 text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fresh boolean := false;
begin
  if not private.connections_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_provider is null or char_length(p_provider) not between 1 and 40
     or p_event_key is null or char_length(p_event_key) not between 1 and 200 then
    perform private.billing_invalid_field('p_event_key');
  end if;

  insert into private.webhook_events (provider, event_key, payload_sha256)
  values (
    p_provider,
    p_event_key,
    case when p_payload_sha256 ~ '^[0-9a-f]{64}$' then p_payload_sha256 else null end
  )
  on conflict (provider, event_key) do nothing;

  v_fresh := found;

  delete from private.webhook_events w
  where (w.provider, w.event_key) in (
    select e.provider, e.event_key
    from private.webhook_events e
    where e.received_at < now() - interval '7 days'
    order by e.received_at
    limit 1000
    for update skip locked
  );

  return v_fresh;
end;
$$;

comment on function public.record_webhook_event(text, text, text, text) is
  'Idempotência: devolve true na primeira vez que o evento chega e false em toda reentrega. Entrega repetida é normal; efeito repetido não.';

-- -----------------------------------------------------------------------------
-- 10. Grants
-- -----------------------------------------------------------------------------

revoke all on public.connected_accounts from public, anon, authenticated;
-- SELECT por coluna: credential_secret_id e last_error_message ficam de fora.
-- `select *` falha de propósito — o app lista as colunas.
grant select (
  id, organization_id, provider, status, enabled, blocked_at, blocked_reason,
  external_account_id, external_owner_id, display_name, handle, scopes,
  credential_expires_at, last_error_code, last_error_at, last_synced_at,
  metadata, terms_acceptance_id, connected_by, connected_at, created_at, updated_at
) on public.connected_accounts to authenticated;

revoke all on public.connection_events from public, anon, authenticated;
grant select on public.connection_events to authenticated;

revoke all on public.connection_terms_acceptances from public, anon, authenticated;
grant select on public.connection_terms_acceptances to authenticated;

revoke all on function private.connections_server_key_ok(text) from public, anon, authenticated;
revoke all on function private.connection_metadata_ok(jsonb) from public, anon, authenticated;
revoke all on function private.consume_server_nonce(text) from public, anon, authenticated;
revoke all on function private.connection_event(uuid, uuid, public.connection_provider, public.connection_event_action, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function private.connection_can_send(uuid) from public, anon, authenticated;

revoke all on function public.accept_connection_terms(uuid, public.connection_provider, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.accept_connection_terms(uuid, public.connection_provider, text, text, text, text, text, text, jsonb) to authenticated;

revoke all on function public.set_connection_enabled(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_connection_enabled(uuid, boolean) to authenticated;

revoke all on function public.disconnect_connection(uuid) from public, anon, authenticated;
grant execute on function public.disconnect_connection(uuid) to authenticated;

-- RPCs do servidor: o Next chama com a chave publishable e sem sessão, ou seja,
-- no papel `anon`. `authenticated` nunca precisa delas.
revoke all on function public.connect_connection_account(text, text, uuid, public.connection_provider, text, text, text, text, text[], text, timestamptz, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.connect_connection_account(text, text, uuid, public.connection_provider, text, text, text, text, text[], text, timestamptz, jsonb, uuid, uuid) to anon;

revoke all on function public.get_connection_credential(text, uuid) from public, anon, authenticated;
grant execute on function public.get_connection_credential(text, uuid) to anon;

revoke all on function public.record_connection_error(text, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_connection_error(text, uuid, text, text, boolean) to anon;

revoke all on function public.set_connection_platform_block(text, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_connection_platform_block(text, uuid, boolean, text) to anon;

revoke all on function public.record_webhook_event(text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_webhook_event(text, text, text, text) to anon;
