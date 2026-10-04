-- =============================================================================
-- 2901 - Comissionamento: correção de review_proposal_discount
-- =============================================================================
-- O CASE do UPDATE devolvia text e o Postgres não converte sozinho para o enum
-- public.discount_request_status (42804). Cast explícito.

create or replace function public.review_proposal_discount(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_request public.proposal_discount_requests;
  v_user constant uuid := (select auth.uid());
begin
  select * into v_request
  from public.proposal_discount_requests r
  where r.id = p_request_id;

  if not found or not private.is_member(v_request.organization_id) then
    raise exception 'Pedido não encontrado.' using errcode = 'P0001';
  end if;

  if not private.has_role(v_request.organization_id, '{owner,manager}') then
    raise exception 'Só o dono ou o gerente da imobiliária aprova desconto.'
      using errcode = '42501';
  end if;

  -- Gerente não aprova o próprio pedido; o dono responde por si.
  if v_request.requested_by = v_user
     and not private.has_role(v_request.organization_id, '{owner}') then
    raise exception 'Você pediu este desconto: quem aprova é o dono da imobiliária.'
      using errcode = '42501';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Este pedido já foi respondido.' using errcode = 'P0001';
  end if;

  update public.proposal_discount_requests r
  set status = (case when coalesce(p_approve, false) then 'approved' else 'rejected' end)
        ::public.discount_request_status,
      review_note = nullif(btrim(coalesce(p_note, '')), ''),
      reviewed_by = v_user,
      reviewed_at = now(),
      updated_at = now()
  where r.id = p_request_id
    and r.status = 'pending'
  returning r.* into v_request;

  return to_jsonb(v_request);
end;
$fn$;

revoke all on function public.review_proposal_discount(uuid, boolean, text) from public, anon;
grant execute on function public.review_proposal_discount(uuid, boolean, text) to authenticated;
