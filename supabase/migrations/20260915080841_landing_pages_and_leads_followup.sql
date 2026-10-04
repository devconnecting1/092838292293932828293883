-- =============================================================================
-- 1310 - Landing pages e leads (complemento pedido pelo funil)
-- =============================================================================
--  1. RPC lead_duplicate_flags: sinal de duplicado (lead ou cliente da mesma
--     imobiliária nos últimos 90 dias) sem expor o registro duplicado
--  2. leads.position com default NULL (lead novo no topo da coluna)
--  3. Auditoria LGPD de leads: trigger de alterações e log_access_event('lead')

-- -----------------------------------------------------------------------------
-- 1. lead_duplicate_flags
-- -----------------------------------------------------------------------------
-- Índices para a busca por telefone (só dígitos, últimos 11) e e-mail
-- (minúsculas, sem espaços nas pontas) em clients. Em leads, telefone e e-mail
-- já são guardados normalizados e os índices vieram na migração anterior.
create index clients_organization_phone_idx
  on public.clients (organization_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 11));
create index clients_organization_whatsapp_idx
  on public.clients (organization_id, right(regexp_replace(whatsapp, '[^0-9]', '', 'g'), 11));
create index clients_organization_email_idx
  on public.clients (organization_id, lower(btrim(email)));

-- Para cada lead de p_lead_ids que o usuário PODE ver (mesma regra do SELECT
-- de leads), informa se existe OUTRO lead ou um cliente da mesma imobiliária,
-- criado nos últimos 90 dias, com o mesmo telefone (últimos 11 dígitos; em
-- clientes, phone ou whatsapp) ou o mesmo e-mail. O cliente já vinculado ao
-- próprio lead (client_id) não conta. Nunca devolve id, nome ou responsável do
-- duplicado; ids que o usuário não vê (ou inexistentes) ficam fora do resultado.
-- Até 1.000 ids por chamada (22023 acima disso).
create or replace function public.lead_duplicate_flags(p_lead_ids uuid[])
returns table (lead_id uuid, has_duplicate boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_lead_ids is null or cardinality(p_lead_ids) = 0 then
    return;
  end if;

  if cardinality(p_lead_ids) > 1000 then
    raise exception 'Envie no máximo 1.000 leads por consulta.' using errcode = '22023';
  end if;

  return query
  select
    l.id,
    (
      (
        l.phone is not null
        and (
          exists (
            select 1
            from public.leads d
            where d.organization_id = l.organization_id
              and right(d.phone, 11) = right(l.phone, 11)
              and d.id <> l.id
              and d.created_at > now() - interval '90 days'
          )
          or exists (
            select 1
            from public.clients c
            where c.organization_id = l.organization_id
              and right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 11) = right(l.phone, 11)
              and c.id is distinct from l.client_id
              and c.created_at > now() - interval '90 days'
          )
          or exists (
            select 1
            from public.clients c
            where c.organization_id = l.organization_id
              and right(regexp_replace(c.whatsapp, '[^0-9]', '', 'g'), 11) = right(l.phone, 11)
              and c.id is distinct from l.client_id
              and c.created_at > now() - interval '90 days'
          )
        )
      )
      or (
        l.email is not null
        and (
          exists (
            select 1
            from public.leads d
            where d.organization_id = l.organization_id
              and lower(d.email) = lower(btrim(l.email))
              and d.id <> l.id
              and d.created_at > now() - interval '90 days'
          )
          or exists (
            select 1
            from public.clients c
            where c.organization_id = l.organization_id
              and lower(btrim(c.email)) = lower(btrim(l.email))
              and c.id is distinct from l.client_id
              and c.created_at > now() - interval '90 days'
          )
        )
      )
    )
  from public.leads l
  where l.id in (select distinct u.id from unnest(p_lead_ids) as u (id) where u.id is not null)
    and private.can_access_lead_row(l.organization_id, l.assigned_to, false);
end;
$$;

revoke all on function public.lead_duplicate_flags(uuid[]) from public, anon;
grant execute on function public.lead_duplicate_flags(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. leads.position: default NULL
-- -----------------------------------------------------------------------------
-- O app ordena nulos primeiro; submit_landing_lead não informa position.
alter table public.leads
  alter column position drop default,
  alter column position drop not null;

-- -----------------------------------------------------------------------------
-- 3. Auditoria LGPD de leads
-- -----------------------------------------------------------------------------
-- Alterações: mesmo trigger das demais tabelas sensíveis (guarda só os NOMES
-- dos campos alterados). Entidade registrada: 'leads'.
create trigger leads_audit
  after insert or update or delete on public.leads
  for each row execute function private.audit_row_change();

-- Leituras: log_access_event aceita 'lead' (ou 'leads') e registra como 'leads',
-- exigindo que o usuário possa ver o lead.
create or replace function public.log_access_event(
  p_entity text,
  p_entity_id uuid,
  p_action text default 'view'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_allowed boolean := false;
  v_entity text := p_entity;
begin
  if v_user is null then
    raise exception 'Não autenticado.' using errcode = '42501';
  end if;

  if p_action is null or p_action not in ('view', 'download', 'export', 'print') then
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;

  case p_entity
    when 'clients' then
      select c.organization_id, private.can_access_client(c.id)
        into v_org, v_allowed
      from public.clients c where c.id = p_entity_id;
    when 'client_documents' then
      select d.organization_id, private.can_access_client(d.client_id)
        into v_org, v_allowed
      from public.client_documents d where d.id = p_entity_id;
    when 'properties' then
      select p.organization_id, private.is_member(p.organization_id)
        into v_org, v_allowed
      from public.properties p where p.id = p_entity_id;
    when 'lead', 'leads' then
      v_entity := 'leads';
      select l.organization_id, private.can_access_lead_row(l.organization_id, l.assigned_to, false)
        into v_org, v_allowed
      from public.leads l where l.id = p_entity_id;
    else
      raise exception 'Entidade inválida.' using errcode = '22023';
  end case;

  if v_org is null or not coalesce(v_allowed, false) then
    raise exception 'Registro não encontrado.' using errcode = 'P0002';
  end if;

  insert into public.audit_events (organization_id, actor_id, action, entity, entity_id)
  values (v_org, v_user, p_action, v_entity, p_entity_id);
end;
$$;

revoke all on function public.log_access_event(text, uuid, text) from public, anon;
grant execute on function public.log_access_event(text, uuid, text) to authenticated;
