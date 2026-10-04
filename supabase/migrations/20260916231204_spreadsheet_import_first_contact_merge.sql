-- =============================================================================
-- Importação de planilhas: junta a trava de prazo com o "primeiro contato"
-- =============================================================================
-- As migrações leads_first_contact_and_alerts e spreadsheet_import foram
-- aplicadas quase juntas e as duas redefiniram private.leads_before_write().
-- A segunda saiu com a versão anterior do corpo (sem first_contact_at e
-- sla_breached_at). Esta migração restaura a versão de
-- leads_first_contact_and_alerts e mantém a regra da importação:
-- lead que entra por planilha (app.import_job ligado por public.import_batch)
-- não abre prazo de primeiro contato.
create or replace function private.leads_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.phone := nullif(regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g'), '');
  new.message := nullif(btrim(coalesce(new.message, '')), '');
  new.typology := nullif(btrim(coalesce(new.typology, '')), '');
  new.lost_reason := nullif(btrim(coalesce(new.lost_reason, '')), '');

  if char_length(coalesce(new.name, '')) not between 2 and 120 then
    raise exception 'Informe o nome do lead (2 a 120 caracteres).' using errcode = '23514';
  end if;

  if new.email is not null and (
    char_length(new.email) > 254
    or new.email !~ '^[a-z0-9._+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
    or position('..' in new.email) > 0
  ) then
    raise exception 'E-mail inválido.' using errcode = '23514';
  end if;

  if new.phone is not null and new.phone !~ '^[0-9]{10,13}$' then
    raise exception 'Telefone inválido: informe DDD e número.' using errcode = '23514';
  end if;

  if new.stage = 'lost' and new.lost_reason is null then
    raise exception 'Informe o motivo da perda do lead.' using errcode = '23514';
  end if;

  if new.stage <> 'new'
     and new.last_contact_at is null
     and (tg_op = 'INSERT' or old.stage = 'new') then
    new.last_contact_at := now();
  end if;

  -- Primeiro contato: uma única vez, na primeira vez que last_contact_at é
  -- preenchido. Depois disso nenhum UPDATE o altera.
  if tg_op = 'UPDATE' then
    if old.first_contact_at is not null then
      new.first_contact_at := old.first_contact_at;
    elsif new.last_contact_at is not null then
      new.first_contact_at := least(new.last_contact_at, now());
    else
      new.first_contact_at := null;
    end if;
  elsif new.last_contact_at is not null then
    new.first_contact_at := least(new.last_contact_at, now());
  else
    new.first_contact_at := null;
  end if;

  -- Quando o responsável muda, o relógio do primeiro contato recomeça.
  if tg_op = 'INSERT' then
    new.assigned_at := case when new.assigned_to is not null then now() end;
    new.sla_breached_at := null;
  elsif new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is not null then now() end;
    new.sla_warned_at := null;
    new.sla_breached_at := null;
  end if;

  -- Prazo de primeiro contato: só com responsável, em "Novo" e sem contato.
  -- Lead que entra por importação de planilha não abre prazo.
  if new.assigned_to is null
     or new.stage <> 'new'
     or new.first_contact_at is not null
     or (tg_op = 'INSERT' and coalesce(current_setting('app.import_job', true), '') <> '') then
    new.first_response_due_at := null;
  elsif tg_op = 'INSERT'
     or new.assigned_to is distinct from old.assigned_to
     or old.first_response_due_at is null then
    new.first_response_due_at := coalesce(new.assigned_at, now())
      + make_interval(mins => private.lead_sla_minutes(new.organization_id));
  end if;

  return new;
end;
$$;

revoke all on function private.leads_before_write() from public, anon, authenticated;

comment on function private.leads_before_write() is
  'Normaliza e valida o lead, marca o primeiro contato e calcula o prazo de primeiro contato. Lead gravado por importação de planilha (app.import_job) não abre prazo.';
