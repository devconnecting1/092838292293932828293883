-- =============================================================================
-- 0800 - Auditoria (LGPD): triggers em tabelas sensíveis
-- =============================================================================
-- Registra insert/update/delete em clients, client_documents, properties e
-- memberships. Para não copiar dados pessoais para o log, guarda apenas os
-- NOMES dos campos alterados e um contexto mínimo não sensível.

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_org uuid;
  v_changed text[];
  v_meta jsonb := '{}'::jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;

  v_org := (v_row ->> 'organization_id')::uuid;

  -- Exclusão em cascata da própria imobiliária: não há onde registrar.
  if not exists (select 1 from public.organizations o where o.id = v_org) then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    select coalesce(array_agg(n.key order by n.key), '{}')
      into v_changed
    from jsonb_each(v_row) as n
    where n.key <> 'updated_at'
      and (v_old -> n.key) is distinct from n.value;

    if cardinality(v_changed) = 0 then
      return null;
    end if;

    v_meta := jsonb_build_object('changed_fields', to_jsonb(v_changed));
  end if;

  case tg_table_name
    when 'memberships' then
      v_meta := v_meta || jsonb_build_object(
        'user_id', v_row ->> 'user_id',
        'role', v_row ->> 'role',
        'active', (v_row ->> 'active')::boolean
      );
      if tg_op = 'UPDATE' and (v_old ->> 'role') is distinct from (v_row ->> 'role') then
        v_meta := v_meta || jsonb_build_object('previous_role', v_old ->> 'role');
      end if;
    when 'properties' then
      v_meta := v_meta || jsonb_build_object('code', v_row ->> 'code', 'status', v_row ->> 'status');
    when 'client_documents' then
      v_meta := v_meta || jsonb_build_object('client_id', v_row ->> 'client_id');
    when 'clients' then
      v_meta := v_meta || jsonb_build_object('kind', v_row ->> 'kind');
    else
      null;
  end case;

  insert into public.audit_events (organization_id, actor_id, action, entity, entity_id, metadata)
  values (
    v_org,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_meta
  );

  return null;
end;
$$;

revoke all on function private.audit_row_change() from public;

create trigger clients_audit
  after insert or update or delete on public.clients
  for each row execute function private.audit_row_change();

create trigger client_documents_audit
  after insert or update or delete on public.client_documents
  for each row execute function private.audit_row_change();

create trigger properties_audit
  after insert or update or delete on public.properties
  for each row execute function private.audit_row_change();

create trigger memberships_audit
  after insert or update or delete on public.memberships
  for each row execute function private.audit_row_change();
