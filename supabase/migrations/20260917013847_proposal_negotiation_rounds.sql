-- =============================================================================
-- Negociação em rodadas: proposta inicial, contraproposta e nova oferta
-- =============================================================================
-- Negociação de alto padrão tem 4 a 6 rodadas, com sinal, permuta e
-- financiamento. Até aqui a contraproposta era só um status e a mesma linha era
-- sobrescrita: ninguém sabia qual valor o proprietário já tinha recusado.
--
--  1. proposals ganha os campos da rodada vigente: round_number, round_kind
--     (initial, owner_counter, client_offer), down_payment (sinal),
--     financing_amount (financiamento), exchange_description (permuta) e
--     payment_deadline (prazo). amount, payment_terms, conditions e valid_until
--     continuam sendo os valores vigentes (relatórios, comissão e trava de
--     desconto não mudam).
--  2. proposal_rounds: uma linha por rodada, com os valores e quem registrou.
--     Imutável: ninguém atualiza nem apaga (só some junto com a proposta).
--  3. Gatilhos em proposals: toda mudança nos valores da negociação (ou no tipo
--     da rodada) numera uma rodada nova e grava o retrato em proposal_rounds.
--     Inserir a proposta grava a rodada 1 (proposta inicial). Rascunho só
--     registra proposta inicial; proposta encerrada não muda.
--  4. Propostas existentes: o valor atual vira a rodada 1. Não havia histórico
--     antes desta migração.
--  5. private.proposal_document (PDF do CRM, link público e PDF público) leva a
--     rodada vigente e, na versão pública, respeita o modo de exibição do
--     endereço do imóvel (bairro, rua ou completo).

-- -----------------------------------------------------------------------------
-- 1. Rodada vigente em proposals
-- -----------------------------------------------------------------------------
create type public.proposal_round_kind as enum ('initial', 'owner_counter', 'client_offer');

comment on type public.proposal_round_kind is
  'Rodada da negociação: proposta inicial, contraproposta do proprietário ou nova oferta do cliente.';

alter table public.proposals
  add column round_number integer not null default 1
    constraint proposals_round_number_positive check (round_number >= 1),
  add column round_kind public.proposal_round_kind not null default 'initial',
  add column down_payment numeric(14, 2)
    constraint proposals_down_payment_range check (down_payment is null or down_payment >= 0),
  add column financing_amount numeric(14, 2)
    constraint proposals_financing_amount_range check (
      financing_amount is null or financing_amount >= 0
    ),
  add column exchange_description text
    constraint proposals_exchange_description_length check (
      exchange_description is null or char_length(exchange_description) <= 1000
    ),
  add column payment_deadline text
    constraint proposals_payment_deadline_length check (
      payment_deadline is null or char_length(payment_deadline) <= 300
    );

comment on column public.proposals.round_number is
  'Número da rodada vigente da negociação. Mantido pelo banco (gatilho proposals_negotiation_round).';
comment on column public.proposals.round_kind is
  'Tipo da rodada vigente: proposta inicial, contraproposta do proprietário ou nova oferta do cliente.';
comment on column public.proposals.down_payment is 'Sinal da rodada vigente.';
comment on column public.proposals.financing_amount is 'Valor financiado da rodada vigente.';
comment on column public.proposals.exchange_description is 'Permuta oferecida na rodada vigente.';
comment on column public.proposals.payment_deadline is
  'Prazo da rodada vigente (ex.: saldo em 60 dias, na escritura).';

-- -----------------------------------------------------------------------------
-- 2. proposal_rounds
-- -----------------------------------------------------------------------------
create table public.proposal_rounds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  proposal_id uuid not null,
  round_number integer not null constraint proposal_rounds_round_number_positive check (round_number >= 1),
  kind public.proposal_round_kind not null,
  amount numeric(14, 2) not null,
  down_payment numeric(14, 2),
  financing_amount numeric(14, 2),
  exchange_description text,
  payment_deadline text,
  payment_terms text,
  conditions text,
  valid_until date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint proposal_rounds_proposal_fkey foreign key (organization_id, proposal_id)
    references public.proposals (organization_id, id) on delete cascade,
  constraint proposal_rounds_proposal_round_key unique (proposal_id, round_number)
);

create index proposal_rounds_organization_proposal_idx
  on public.proposal_rounds (organization_id, proposal_id);
create index proposal_rounds_created_by_idx on public.proposal_rounds (created_by);

comment on table public.proposal_rounds is
  'Histórico imutável da negociação: uma linha por rodada (valor, sinal, financiamento, permuta, prazo, condições e quem registrou). Gravada só pelo gatilho de proposals.';

-- Rodadas existentes: o valor atual de cada proposta vira a rodada 1.
insert into public.proposal_rounds (
  organization_id, proposal_id, round_number, kind, amount, payment_terms, conditions,
  valid_until, created_by, created_at
)
select
  p.organization_id, p.id, 1, 'initial', p.amount, p.payment_terms, p.conditions,
  p.valid_until, p.created_by, p.created_at
from public.proposals p;

-- -----------------------------------------------------------------------------
-- 3. Gatilhos
-- -----------------------------------------------------------------------------
-- Antes de gravar: numera a rodada quando muda algum valor da negociação. O
-- número nunca vem do cliente.
create or replace function private.proposals_negotiation_round()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.round_number := 1;
    new.round_kind := 'initial';
    return new;
  end if;

  if (new.amount, new.payment_terms, new.conditions, new.valid_until, new.down_payment,
      new.financing_amount, new.exchange_description, new.payment_deadline, new.round_kind)
     is not distinct from
     (old.amount, old.payment_terms, old.conditions, old.valid_until, old.down_payment,
      old.financing_amount, old.exchange_description, old.payment_deadline, old.round_kind) then
    new.round_number := old.round_number;
    return new;
  end if;

  if old.status in ('accepted', 'rejected', 'withdrawn') then
    raise exception 'Propostas encerradas (aceitas, recusadas ou retiradas) não podem ser editadas.'
      using errcode = 'P0001';
  end if;

  if new.round_kind = 'initial' and old.round_kind <> 'initial' then
    raise exception 'A negociação já passou da proposta inicial: registre uma contraproposta do proprietário ou uma nova oferta do cliente.'
      using errcode = 'P0001';
  end if;

  if new.status = 'draft' and new.round_kind <> 'initial' then
    raise exception 'Envie a proposta antes de registrar contraproposta ou nova oferta.'
      using errcode = 'P0001';
  end if;

  new.round_number := old.round_number + 1;
  return new;
end;
$$;

revoke all on function private.proposals_negotiation_round() from public, anon, authenticated;

create trigger proposals_negotiation_round
  before insert or update on public.proposals
  for each row execute function private.proposals_negotiation_round();

-- Depois de gravar: retrato da rodada nova (security definer: authenticated não
-- escreve em proposal_rounds).
create or replace function private.proposals_record_round()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.round_number = old.round_number then
    return null;
  end if;

  insert into public.proposal_rounds (
    organization_id, proposal_id, round_number, kind, amount, down_payment, financing_amount,
    exchange_description, payment_deadline, payment_terms, conditions, valid_until, created_by
  )
  values (
    new.organization_id, new.id, new.round_number, new.round_kind, new.amount, new.down_payment,
    new.financing_amount, new.exchange_description, new.payment_deadline, new.payment_terms,
    new.conditions, new.valid_until, coalesce((select auth.uid()), new.created_by)
  );

  return null;
end;
$$;

revoke all on function private.proposals_record_round() from public, anon, authenticated;

create trigger proposals_record_round
  after insert or update on public.proposals
  for each row execute function private.proposals_record_round();

-- Rodada não muda nem some. A exclusão só passa quando a proposta (ou a
-- imobiliária) já foi apagada: é a cascata da chave estrangeira.
create or replace function private.proposal_rounds_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and (
       not exists (select 1 from public.proposals p where p.id = old.proposal_id)
       or not exists (select 1 from public.organizations o where o.id = old.organization_id)
     ) then
    return old;
  end if;

  raise exception 'As rodadas da negociação não podem ser alteradas nem apagadas.'
    using errcode = '42501';
end;
$$;

revoke all on function private.proposal_rounds_immutable() from public, anon, authenticated;

create trigger proposal_rounds_immutable
  before update or delete on public.proposal_rounds
  for each row execute function private.proposal_rounds_immutable();

-- -----------------------------------------------------------------------------
-- 4. RLS: lê quem lê a proposta; ninguém escreve direto
-- -----------------------------------------------------------------------------
alter table public.proposal_rounds enable row level security;

revoke all on public.proposal_rounds from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.proposal_rounds from authenticated;
grant select on public.proposal_rounds to authenticated;

create policy "proposal_rounds: quem vê a proposta lê"
  on public.proposal_rounds for select to authenticated
  using (
    private.is_member(organization_id)
    and exists (
      select 1
      from public.proposals pr
      where pr.organization_id = proposal_rounds.organization_id
        and pr.id = proposal_rounds.proposal_id
    )
  );

-- -----------------------------------------------------------------------------
-- 5. Documento da proposta com a rodada vigente
-- -----------------------------------------------------------------------------
-- Versão pública (link e PDF do link): endereço conforme o modo de exibição do
-- imóvel — "bairro" esconde rua, número, complemento e CEP; "rua" esconde
-- número e complemento. O PDF gerado no CRM continua completo.
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
      'created_at', pr.created_at,
      'round_number', pr.round_number,
      'round_kind', pr.round_kind,
      'round_created_at', rd.created_at,
      'down_payment', pr.down_payment,
      'financing_amount', pr.financing_amount,
      'exchange_description', pr.exchange_description,
      'payment_deadline', pr.payment_deadline
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
      'address_display', p.address_display,
      'postal_code', case
        when not p_public or p.address_display in ('full', 'street') then p.postal_code
      end,
      'street', case
        when not p_public or p.address_display in ('full', 'street') then p.street
      end,
      'street_number', case
        when not p_public or p.address_display = 'full' then p.street_number
      end,
      'complement', case
        when not p_public or p.address_display = 'full' then p.complement
      end,
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
  left join public.proposal_rounds rd
    on rd.proposal_id = pr.id and rd.round_number = pr.round_number
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
