-- =============================================================================
-- Proposta apresentável: link público, PDF e registro de leitura
-- =============================================================================
-- Hoje a proposta só existe dentro do CRM: o corretor copia os números para o
-- Word ou manda print no WhatsApp. Esta migração dá ao módulo o que falta para
-- entregar a proposta ao cliente como documento:
--
--  1. proposals: unique (organization_id, id) para a chave composta do share
--  2. proposal_shares: token do link público, validade e registro de leitura
--  3. private.proposal_document: payload único da proposta (fonte do PDF no
--     servidor e da página pública); mascara o CPF/CNPJ do cliente na versão
--     pública
--  4. get_proposal_document: payload para a equipe (membro da imobiliária)
--  5. share_proposal / revoke_proposal_share: cria, renova e revoga o link
--  6. get_shared_proposal: leitura pública por token. Devolve null para token
--     errado, inexistente ou vencido, sem distinguir os casos — mesmo padrão
--     de get_portal_feed (feed dos portais)
--  7. register_shared_proposal_view: data e hora da abertura pelo cliente
--
-- O link público NÃO é bloqueado no modo somente leitura da assinatura: a
-- proposta já foi entregue ao cliente. Criar ou renovar o link é escrita e
-- respeita o modo leitura, como o resto do CRM.

-- -----------------------------------------------------------------------------
-- 1. Chave composta em proposals (padrão das demais tabelas do schema)
-- -----------------------------------------------------------------------------
alter table public.proposals
  add constraint proposals_organization_id_id_key unique (organization_id, id);

-- -----------------------------------------------------------------------------
-- 2. proposal_shares (1 por proposta)
-- -----------------------------------------------------------------------------
-- token nulo = link revogado. A linha continua para preservar o histórico de
-- leitura ("o cliente abriu em ...") depois de revogar ou vencer.
create table public.proposal_shares (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  proposal_id uuid not null,
  token text
    constraint proposal_shares_token_format check (token ~ '^[0-9a-f]{48}$')
    constraint proposal_shares_token_key unique,
  expires_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer not null default 0 check (view_count >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proposal_shares_pkey primary key (organization_id, proposal_id),
  constraint proposal_shares_proposal_fkey foreign key (organization_id, proposal_id)
    references public.proposals (organization_id, id) on delete cascade,
  -- Token sem validade (ou o contrário) deixaria o link sem prazo: os dois
  -- andam juntos.
  constraint proposal_shares_token_expiry check (
    (token is null and expires_at is null) or (token is not null and expires_at is not null)
  )
);
create index proposal_shares_created_by_idx on public.proposal_shares (created_by);

create trigger proposal_shares_set_updated_at
  before update on public.proposal_shares
  for each row execute function private.set_updated_at();
create trigger proposal_shares_lock_organization_id
  before update on public.proposal_shares
  for each row execute function private.lock_organization_id();

alter table public.proposal_shares enable row level security;

-- Quem lê a proposta lê o link dela (mesma política de select de proposals).
-- Escrita só pelas funções abaixo: nenhum grant de insert/update/delete.
create policy "proposal_shares: membros leem"
  on public.proposal_shares for select to authenticated
  using ((select private.is_member(organization_id)));

revoke all on public.proposal_shares from anon;
revoke insert, update, delete, truncate, trigger, references
  on public.proposal_shares from authenticated;
grant select on public.proposal_shares to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Payload da proposta
-- -----------------------------------------------------------------------------
-- CPF/CNPJ do cliente na versão pública: só os dígitos do meio, como na
-- Receita ("***.456.789-**"). O link pode ser repassado adiante; o documento
-- completo fica no PDF gerado dentro do CRM.
create or replace function private.mask_client_document(p_kind public.client_kind, p_document text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_document is null then null
    when p_kind = 'pf' and p_document ~ '^[0-9]{11}$'
      then '***.' || substr(p_document, 4, 3) || '.' || substr(p_document, 7, 3) || '-**'
    when p_kind = 'pj' and char_length(p_document) = 14
      then '**.' || substr(p_document, 3, 3) || '.' || substr(p_document, 6, 3)
           || '/' || substr(p_document, 9, 4) || '-**'
    else null
  end;
$$;

revoke all on function private.mask_client_document(public.client_kind, text) from public, anon, authenticated;

-- Fonte única do documento da proposta: o PDF do CRM, o PDF público e a página
-- pública saem todos daqui. `p_public` mascara o documento do cliente.
create or replace function private.proposal_document(p_proposal_id uuid, p_public boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'proposal', jsonb_build_object(
      'id', pr.id,
      'status', pr.status,
      'purpose', pr.purpose,
      'amount', pr.amount,
      'payment_terms', pr.payment_terms,
      'conditions', pr.conditions,
      'valid_until', pr.valid_until,
      'decided_at', pr.decided_at,
      'created_at', pr.created_at
    ),
    'organization', jsonb_build_object(
      'slug', o.slug,
      'name', o.name,
      'legal_name', o.legal_name,
      'cnpj', o.cnpj,
      'creci', o.creci,
      'phone', o.phone,
      'email', o.email,
      'city', o.city,
      'state', o.state,
      'brand', o.brand
    ),
    'property', case when p.id is null then null else jsonb_build_object(
      'code', p.code,
      'title', p.title,
      'type', p.type,
      'usage', p.usage,
      'postal_code', p.postal_code,
      'street', p.street,
      'street_number', p.street_number,
      'complement', p.complement,
      'neighborhood', p.neighborhood,
      'city', p.city,
      'state', p.state,
      'condominium_name', cd.name,
      'bedrooms', p.bedrooms,
      'suites', p.suites,
      'bathrooms', p.bathrooms,
      'parking_spaces', p.parking_spaces,
      'living_area', p.living_area,
      'lot_area', p.lot_area,
      'sale_price', p.sale_price,
      'rent_price', p.rent_price,
      'condo_fee', p.condo_fee,
      'iptu_yearly', p.iptu_yearly
    ) end,
    'client', case when c.id is null then null else jsonb_build_object(
      'name', c.name,
      'kind', c.kind,
      'document', case
        when p_public then private.mask_client_document(c.kind, c.document)
        else c.document
      end,
      'email', c.email,
      'phone', coalesce(c.phone, c.whatsapp)
    ) end,
    'broker', case when b.id is null then null else jsonb_build_object(
      'name', coalesce(nullif(btrim(b.full_name), ''), b.email),
      'creci_number', b.creci_number,
      'creci_state', b.creci_state,
      'phone', b.phone,
      'email', b.email
    ) end,
    'share', case when s.proposal_id is null then null else jsonb_build_object(
      'expires_at', s.expires_at,
      'first_viewed_at', s.first_viewed_at,
      'last_viewed_at', s.last_viewed_at,
      'view_count', s.view_count
    ) end,
    'generated_at', now()
  )
  from public.proposals pr
  join public.organizations o on o.id = pr.organization_id
  left join public.properties p
    on p.organization_id = pr.organization_id and p.id = pr.property_id
  left join public.condominiums cd
    on cd.organization_id = p.organization_id and cd.id = p.condominium_id
  left join public.clients c
    on c.organization_id = pr.organization_id and c.id = pr.client_id
  left join public.profiles b on b.id = pr.broker_id
  left join public.proposal_shares s
    on s.organization_id = pr.organization_id and s.proposal_id = pr.id
  where pr.id = p_proposal_id;
$$;

revoke all on function private.proposal_document(uuid, boolean) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Payload para a equipe (gera o PDF dentro do CRM)
-- -----------------------------------------------------------------------------
-- null para proposta inexistente ou de outra imobiliária, sem distinguir.
create or replace function public.get_proposal_document(p_proposal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if (select auth.uid()) is null or p_proposal_id is null then
    return null;
  end if;

  select pr.organization_id into v_org
  from public.proposals pr
  where pr.id = p_proposal_id;

  if v_org is null or not private.is_member(v_org) then
    return null;
  end if;

  return private.proposal_document(p_proposal_id, false);
end;
$$;

revoke all on function public.get_proposal_document(uuid) from public, anon;
grant execute on function public.get_proposal_document(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Criar, renovar e revogar o link público
-- -----------------------------------------------------------------------------
-- Quem pode alterar a proposta pode compartilhá-la (mesma regra da política de
-- update): quem edita o imóvel, ou o corretor da proposta.
create or replace function private.can_share_proposal(p_proposal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.can_edit_property(pr.property_id)
      or (
        private.has_role(pr.organization_id, '{broker,capturer}')
        and pr.broker_id = (select auth.uid())
      )
    from public.proposals pr
    where pr.id = p_proposal_id
  ), false);
$$;

revoke all on function private.can_share_proposal(uuid) from public, anon, authenticated;

-- p_days: validade do link em dias (1 a 180). p_rotate troca o token e derruba
-- o endereço antigo. O histórico de leitura é preservado.
create or replace function public.share_proposal(
  p_proposal_id uuid,
  p_days integer default 30,
  p_rotate boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_slug text;
  v_days integer;
  v_token text;
  v_expires timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  select pr.organization_id into v_org
  from public.proposals pr
  where pr.id = p_proposal_id;

  if v_org is null then
    raise exception 'Proposta não encontrada. Recarregue a página.' using errcode = 'P0001';
  end if;

  if not private.can_share_proposal(p_proposal_id) then
    raise exception 'Só o corretor da proposta ou quem edita o imóvel pode gerar o link.'
      using errcode = '42501';
  end if;

  -- Mesmo bloqueio das demais escritas do CRM (trigger a0_billing_writable).
  if private.billing_state(v_org) = 'read_only' then
    raise exception 'assinatura_somente_leitura' using errcode = 'P0001';
  end if;

  v_days := least(greatest(coalesce(p_days, 30), 1), 180);

  insert into public.proposal_shares as s (
    organization_id, proposal_id, token, expires_at, created_by
  )
  values (
    v_org,
    p_proposal_id,
    encode(extensions.gen_random_bytes(24), 'hex'),
    now() + make_interval(days => v_days),
    (select auth.uid())
  )
  on conflict on constraint proposal_shares_pkey do update
  set token = case
        when coalesce(p_rotate, false) or s.token is null then excluded.token
        else s.token
      end,
      expires_at = excluded.expires_at,
      created_by = excluded.created_by
  returning s.token, s.expires_at into v_token, v_expires;

  select o.slug into v_slug from public.organizations o where o.id = v_org;

  return jsonb_build_object('token', v_token, 'expires_at', v_expires, 'slug', v_slug);
end;
$$;

revoke all on function public.share_proposal(uuid, integer, boolean) from public, anon;
grant execute on function public.share_proposal(uuid, integer, boolean) to authenticated;

-- Derruba o endereço sem apagar o histórico de leitura.
create or replace function public.revoke_proposal_share(p_proposal_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_updated integer;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if not private.can_share_proposal(p_proposal_id) then
    raise exception 'Só o corretor da proposta ou quem edita o imóvel pode revogar o link.'
      using errcode = '42501';
  end if;

  select pr.organization_id into v_org
  from public.proposals pr
  where pr.id = p_proposal_id;

  update public.proposal_shares s
  set token = null, expires_at = null
  where s.organization_id = v_org and s.proposal_id = p_proposal_id and s.token is not null;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.revoke_proposal_share(uuid) from public, anon;
grant execute on function public.revoke_proposal_share(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Leitura pública por token
-- -----------------------------------------------------------------------------
-- Devolve só a proposta do token, nunca uma lista. null para token com formato
-- errado, inexistente, revogado ou vencido (sem distinguir os casos).
create or replace function public.get_shared_proposal(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_proposal uuid;
begin
  if p_token is null or char_length(p_token) <> 48 then
    return null;
  end if;

  select s.proposal_id into v_proposal
  from public.proposal_shares s
  where s.token = p_token and s.expires_at > now();

  if v_proposal is null then
    return null;
  end if;

  return private.proposal_document(v_proposal, true);
end;
$$;

revoke all on function public.get_shared_proposal(text) from public;
grant execute on function public.get_shared_proposal(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. "Saber se ele leu"
-- -----------------------------------------------------------------------------
-- Chamada pelo navegador de quem abre o link (o robô de prévia do WhatsApp não
-- executa JavaScript e não conta). Uma leitura por minuto: recarregar a página
-- não infla a contagem. Sempre silenciosa — não devolve nada e não diz se o
-- token existe.
create or replace function public.register_shared_proposal_view(p_token text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_token is null or char_length(p_token) <> 48 then
    return;
  end if;

  update public.proposal_shares s
  set first_viewed_at = coalesce(s.first_viewed_at, now()),
      last_viewed_at = now(),
      view_count = s.view_count + 1
  where s.token = p_token
    and s.expires_at > now()
    and (s.last_viewed_at is null or s.last_viewed_at < now() - interval '1 minute');
end;
$$;

revoke all on function public.register_shared_proposal_view(text) from public;
grant execute on function public.register_shared_proposal_view(text) to anon, authenticated;
