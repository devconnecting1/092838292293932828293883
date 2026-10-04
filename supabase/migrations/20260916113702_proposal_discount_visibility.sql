-- =============================================================================
-- Comissionamento: percentual inteiro, pedido de desconto visível e trava que
-- não escapa por troca de imóvel
-- =============================================================================
-- Três lacunas da aprovação de desconto (migração commissions) que só se
-- resolvem no banco:
--
--  1. private.milli_percent_text devolvia "10,%" para percentual inteiro: a
--     máscara 'FM999990.999' deixa o separador sem casas. A função é chamada em
--     tempo de execução pelo gatilho de desconto, por request_proposal_discount
--     e por set_commission_partner, então trocar só ela corrige as três
--     mensagens.
--  2. O corretor da proposta não via o pedido feito pelo captador ou pelo
--     gerente (o RLS mostra só à gestão e a quem pediu) e a tela oferecia pedir
--     de novo. A RPC, por sua vez, trocava autor e justificativa do pedido em
--     aberto de outra pessoa e abria pedido novo mesmo com aprovação que já
--     cobria o valor. Nova RPC list_proposal_discount_requests e
--     request_proposal_discount mais estrita; o RLS da tabela não muda.
--  3. O gatilho só conferia de novo quando mudavam status ou amount: trocar
--     property_id ou purpose de proposta enviada para um imóvel mais caro
--     passava sem aprovação. Agora esses campos também reabrem a conta, e a
--     aprovação só cobre a proposta se o preço anunciado não subiu desde o
--     pedido (senão a troca de imóvel de proposta já aprovada escaparia igual).
--
-- A mensagem do gatilho mantém o trecho "que dispensa aprovação":
-- isDiscountApprovalError (apps/web/lib/propostas/discount.ts) reconhece a
-- recusa por ele.

-- -----------------------------------------------------------------------------
-- 1. "10%" em vez de "10,%"
-- -----------------------------------------------------------------------------
-- 'FM999990.000' sempre dá três casas. Tirar os zeros da direita e depois o
-- ponto que sobrar deixa "10", "12.5" e "0.333"; o rtrim de '0' para no ponto,
-- então o zero da parte inteira ("10", "0") fica.
create or replace function private.milli_percent_text(p_milli bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(
    rtrim(rtrim(to_char(coalesce(p_milli, 0) / 1000.0, 'FM999990.000'), '0'), '.'),
    '.', ','
  ) || '%';
$$;

revoke all on function private.milli_percent_text(bigint) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. O que uma aprovação cobre
-- -----------------------------------------------------------------------------
-- Pedido aprovado cobre a proposta enquanto o negócio não piorou para a
-- imobiliária desde o pedido: o valor não baixou (amount_cents <= valor atual) e
-- o preço anunciado não subiu (reference_cents >= referência atual). Trocar para
-- um imóvel mais caro, mudar a finalidade para a de preço maior ou reajustar o
-- anúncio para cima pede aprovação nova.
-- Espelho: discountApprovalCovers em packages/core/src/comissoes/discount.ts.
create or replace function private.proposal_discount_approved(
  p_proposal_id uuid,
  p_amount_cents bigint,
  p_reference_cents bigint
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.proposal_discount_requests r
    where r.proposal_id = p_proposal_id
      and r.status = 'approved'
      and r.amount_cents <= p_amount_cents
      and r.reference_cents >= p_reference_cents
  );
$$;

revoke all on function private.proposal_discount_approved(uuid, bigint, bigint)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Gatilho: imóvel e finalidade também reabrem a conta
-- -----------------------------------------------------------------------------
create or replace function private.proposals_require_discount_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_limit_percent numeric;
  v_reference bigint;
  v_amount bigint;
  v_discount bigint;
  v_limit bigint;
begin
  -- Sem sessão (RPC de servidor, pg_cron, admin) e em gravação disparada por
  -- outro gatilho, não trava.
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.status not in ('sent', 'accepted') then
    return new;
  end if;

  -- Só confere de novo quando muda algo que entra na conta: status, valor,
  -- imóvel (preço anunciado) ou finalidade (venda ou locação). Editar condições,
  -- validade ou forma de pagamento não reabre a trava.
  if tg_op = 'UPDATE'
     and (new.status, new.amount, new.property_id, new.purpose)
         is not distinct from (old.status, old.amount, old.property_id, old.purpose) then
    return new;
  end if;

  select s.discount_approval_enabled, s.max_discount_percent
    into v_enabled, v_limit_percent
  from public.commission_settings s
  where s.organization_id = new.organization_id;

  if not coalesce(v_enabled, false) then
    return new;
  end if;

  v_reference := private.property_reference_cents(new.property_id, new.purpose);
  v_amount := round(new.amount * 100)::bigint;
  v_discount := private.discount_milli(v_reference, v_amount);
  v_limit := round(coalesce(v_limit_percent, 0) * 1000)::bigint;

  -- Sem preço anunciado não há desconto para medir.
  if v_discount <= v_limit then
    return new;
  end if;

  if private.proposal_discount_approved(new.id, v_amount, v_reference) then
    return new;
  end if;

  raise exception
    'Esta proposta dá % de desconto sobre o anunciado e passa do limite de % que dispensa aprovação. Peça a aprovação do gerente em Comissões.',
    private.milli_percent_text(v_discount), private.milli_percent_text(v_limit)
    using errcode = 'P0001';
end;
$$;

revoke all on function private.proposals_require_discount_approval()
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. request_proposal_discount: não repete aprovação nem toma pedido alheio
-- -----------------------------------------------------------------------------
create or replace function public.request_proposal_discount(
  p_proposal_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user constant uuid := (select auth.uid());
  v_proposal public.proposals;
  v_enabled boolean;
  v_limit_percent numeric;
  v_reference bigint;
  v_amount bigint;
  v_discount bigint;
  v_limit bigint;
  v_pending public.proposal_discount_requests;
  v_request public.proposal_discount_requests;
begin
  -- A trava da linha vale até o fim da chamada: dois pedidos ao mesmo tempo para
  -- a mesma proposta não passam juntos pelas checagens de aprovação e de pedido
  -- em aberto. NO KEY UPDATE não bloqueia quem só referencia a proposta.
  select * into v_proposal
  from public.proposals p
  where p.id = p_proposal_id
    and private.is_member(p.organization_id)
  for no key update;

  if not found then
    raise exception 'Proposta não encontrada.' using errcode = 'P0001';
  end if;

  if not (
    private.has_role(v_proposal.organization_id, '{owner,manager}')
    or v_proposal.broker_id = v_user
    or private.can_edit_property(v_proposal.property_id)
  ) then
    raise exception 'Só o corretor da proposta ou quem edita o imóvel pode pedir aprovação de desconto.'
      using errcode = '42501';
  end if;

  if v_proposal.status in ('accepted', 'rejected', 'withdrawn') then
    raise exception 'Esta proposta já foi encerrada.' using errcode = 'P0001';
  end if;

  select s.discount_approval_enabled, s.max_discount_percent
    into v_enabled, v_limit_percent
  from public.commission_settings s
  where s.organization_id = v_proposal.organization_id;

  if not coalesce(v_enabled, false) then
    raise exception 'A aprovação de desconto está desligada nesta imobiliária.'
      using errcode = 'P0001';
  end if;

  v_reference := private.property_reference_cents(v_proposal.property_id, v_proposal.purpose);

  if coalesce(v_reference, 0) <= 0 then
    raise exception 'Este imóvel não tem preço anunciado para comparar com a proposta.'
      using errcode = 'P0001';
  end if;

  v_amount := round(v_proposal.amount * 100)::bigint;
  v_discount := private.discount_milli(v_reference, v_amount);
  v_limit := round(coalesce(v_limit_percent, 0) * 1000)::bigint;

  if v_discount <= v_limit then
    raise exception 'Esta proposta está dentro do limite de % e não precisa de aprovação.',
      private.milli_percent_text(v_limit)
      using errcode = 'P0001';
  end if;

  if private.proposal_discount_approved(p_proposal_id, v_amount, v_reference) then
    raise exception 'O gerente já aprovou este desconto: a proposta pode ser enviada e aceita sem pedido novo.'
      using errcode = 'P0001';
  end if;

  select * into v_pending
  from public.proposal_discount_requests r
  where r.proposal_id = p_proposal_id
    and r.status = 'pending';

  if found then
    -- Pedido de outra pessoa (ou de quem saiu da conta) fica como está: trocar o
    -- autor apagaria a justificativa dela e, se quem reenviou for o gerente,
    -- ele deixaria de poder aprovar o pedido.
    if v_pending.requested_by is distinct from v_user then
      raise exception 'Outra pessoa da equipe já pediu a aprovação deste desconto e o gerente ainda não respondeu.'
        using errcode = 'P0001';
    end if;

    -- Pedido próprio em aberto: atualiza o valor e a justificativa.
    update public.proposal_discount_requests r
    set amount_cents = v_amount,
        reference_cents = v_reference,
        discount_percent = v_discount / 1000.0,
        reason = nullif(btrim(coalesce(p_reason, '')), ''),
        updated_at = now()
    where r.id = v_pending.id
    returning r.* into v_request;
  else
    insert into public.proposal_discount_requests (
      organization_id, proposal_id, amount_cents, reference_cents, discount_percent,
      reason, requested_by
    )
    values (
      v_proposal.organization_id, p_proposal_id, v_amount, v_reference, v_discount / 1000.0,
      nullif(btrim(coalesce(p_reason, '')), ''), v_user
    )
    returning * into v_request;
  end if;

  return to_jsonb(v_request);
end;
$$;

revoke all on function public.request_proposal_discount(uuid, text) from public, anon;
grant execute on function public.request_proposal_discount(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. list_proposal_discount_requests: situação dos pedidos para quem edita a
--    proposta
-- -----------------------------------------------------------------------------
-- O RLS de proposal_discount_requests continua mostrando a linha inteira só à
-- gestão (dono, gerente, financeiro) e a quem pediu. Esta função devolve a
-- situação a quem pode editar a proposta — a mesma regra da política de UPDATE
-- de proposals: quem edita o imóvel (dono, gerente, assistente, captador e
-- corretor do imóvel) ou o corretor da proposta — e à gestão. Justificativa e
-- resposta do gerente só saem para quem já as lê pelo RLS; os demais recebem
-- null. Mais recente primeiro.
create or replace function public.list_proposal_discount_requests(
  p_organization_id uuid,
  p_proposal_ids uuid[]
)
returns table (
  id uuid,
  proposal_id uuid,
  status public.discount_request_status,
  amount_cents bigint,
  reference_cents bigint,
  discount_percent numeric,
  requested_by_me boolean,
  reason text,
  review_note text,
  created_at timestamptz,
  updated_at timestamptz,
  reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select
      (select auth.uid()) as user_id,
      private.commission_auditor(p_organization_id) as auditor,
      private.has_role(p_organization_id, '{broker,capturer}') as self_broker
    where private.is_member(p_organization_id)
  )
  select
    r.id,
    r.proposal_id,
    r.status,
    r.amount_cents,
    r.reference_cents,
    r.discount_percent,
    coalesce(r.requested_by = v.user_id, false),
    case when v.auditor or r.requested_by = v.user_id then r.reason end,
    case when v.auditor or r.requested_by = v.user_id then r.review_note end,
    r.created_at,
    r.updated_at,
    r.reviewed_at
  from viewer v
  join public.proposals pr
    on pr.organization_id = p_organization_id
   and pr.id = any (p_proposal_ids)
  join public.proposal_discount_requests r
    on r.proposal_id = pr.id
  where v.auditor
     or (v.self_broker and pr.broker_id = v.user_id)
     or private.can_edit_property(pr.property_id)
  order by r.created_at desc, r.id;
$$;

revoke all on function public.list_proposal_discount_requests(uuid, uuid[]) from public, anon;
grant execute on function public.list_proposal_discount_requests(uuid, uuid[]) to authenticated;

comment on function public.list_proposal_discount_requests(uuid, uuid[]) is
  'Situação dos pedidos de desconto das propostas informadas, para quem edita a proposta e para a gestão. reason e review_note só para a gestão e para quem pediu.';

comment on table public.proposal_discount_requests is
  'Pedido de aprovação de desconto de uma proposta. Escrito só pelas RPCs request_proposal_discount e review_proposal_discount; a situação resumida sai por list_proposal_discount_requests.';
