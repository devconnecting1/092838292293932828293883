-- =============================================================================
-- Importação de planilhas: data de entrada do lead por configuração da transação
-- =============================================================================
-- authenticated não tem grant de INSERT na coluna leads.created_at (de
-- propósito: ninguém antedata lead pela API). A importação roda com a sessão de
-- quem importa, então a data de entrada da planilha passa a ir em
-- app.import_received_at (local à transação, ligada só por import_lead_row) e
-- private.leads_before_write a aplica apenas quando app.import_job está ligado.

create or replace function private.leads_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_import boolean;
begin
  -- Só public.import_batch liga app.import_job (local à transação).
  v_import := tg_op = 'INSERT' and coalesce(current_setting('app.import_job', true), '') <> '';

  new.name := btrim(new.name);
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.phone := nullif(regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g'), '');
  new.message := nullif(btrim(coalesce(new.message, '')), '');
  new.typology := nullif(btrim(coalesce(new.typology, '')), '');
  new.lost_reason := nullif(btrim(coalesce(new.lost_reason, '')), '');

  -- Origem da importação: só o banco grava, e nunca muda depois.
  if tg_op = 'INSERT' then
    if v_import then
      new.import_job_id := current_setting('app.import_job', true)::uuid;
      new.imported_at := now();
      -- Data de entrada da planilha (app.import_received_at, ligado por
      -- import_lead_row): authenticated não tem grant na coluna created_at.
      new.created_at := least(
        coalesce(nullif(current_setting('app.import_received_at', true), '')::timestamptz, now()),
        now()
      );
    else
      new.import_job_id := null;
      new.imported_at := null;
    end if;
  else
    new.import_job_id := old.import_job_id;
    new.imported_at := old.imported_at;
  end if;

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
    new.last_contact_at := case when v_import then new.created_at else now() end;
  end if;

  if v_import and new.last_contact_at is not null then
    -- Data da planilha: nunca antes da entrada (quando a planilha trouxe a
    -- entrada) nem no futuro.
    new.last_contact_at := least(
      case
        when new.created_at < now() then greatest(new.last_contact_at, new.created_at)
        else new.last_contact_at
      end,
      now()
    );
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

  -- Quando o responsável muda, o relógio do primeiro contato recomeça. Lead
  -- importado fica atribuído desde a data de entrada da planilha.
  if tg_op = 'INSERT' then
    new.assigned_at := case
      when new.assigned_to is null then null
      when v_import then new.created_at
      else now()
    end;
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
     or v_import then
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
  'Normaliza e valida o lead, marca o primeiro contato e calcula o prazo de primeiro contato. Na importação de planilha (app.import_job): grava a origem (import_job_id, imported_at), usa a data de entrada de app.import_received_at, respeita as outras datas da planilha e não abre prazo.';

create or replace function private.import_lead_row(p_job public.import_jobs, p_row jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_line constant integer := private.import_line(p_row);
  v_name text;
  v_email text;
  v_phone text;
  v_interest text;
  v_stage public.lead_stage;
  v_stage_given boolean;
  v_lost_reason text;
  v_existing uuid;
  v_received timestamptz;
  v_first_contact timestamptz;
  v_closed timestamptz;
  v_id uuid;
begin
  begin
    v_name := private.import_text(p_row, 'name');
    v_email := lower(private.import_text(p_row, 'email'));
    v_phone := private.import_text(p_row, 'phone');
    v_interest := private.import_text(p_row, 'interest');
    v_stage_given := private.import_text(p_row, 'stage') is not null;
    v_stage := coalesce(private.import_text(p_row, 'stage'), 'new')::public.lead_stage;
    v_lost_reason := private.import_text(p_row, 'lost_reason');
    v_received := private.import_timestamp(p_row, 'received_at');
    v_first_contact := private.import_timestamp(p_row, 'first_contact_at');
    v_closed := private.import_timestamp(p_row, 'closed_at');

    if v_name is null then
      return private.import_outcome(v_line, 'failed', 'required_name');
    end if;

    if char_length(v_name) not between 2 and 120 then
      return private.import_outcome(v_line, 'failed', 'invalid_name');
    end if;

    if v_email is not null and (
      char_length(v_email) > 254
      or v_email !~ '^[a-z0-9._+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
      or position('..' in v_email) > 0
    ) then
      return private.import_outcome(v_line, 'failed', 'invalid_email');
    end if;

    if v_phone is not null and v_phone !~ '^[0-9]{10,11}$' then
      return private.import_outcome(v_line, 'failed', 'invalid_phone');
    end if;

    if v_email is null and v_phone is null then
      return private.import_outcome(v_line, 'failed', 'required_contact');
    end if;

    if v_interest is not null and v_interest not in ('buy', 'rent', 'invest', 'sell', 'info') then
      return private.import_outcome(v_line, 'failed', 'invalid_value');
    end if;

    -- Landing page é só do formulário público (tem página, UTM e consentimento).
    if coalesce(private.import_text(p_row, 'source'), 'other')
       not in ('portal', 'website', 'social', 'referral', 'manual', 'other') then
      return private.import_outcome(v_line, 'failed', 'invalid_value');
    end if;

    -- Datas da planilha: 1º contato e ganho/perda não vêm antes da entrada.
    if v_received is not null and (
      (v_first_contact is not null and v_first_contact < v_received)
      or (v_closed is not null and v_closed < v_received)
    ) then
      return private.import_outcome(v_line, 'failed', 'invalid_date_order');
    end if;

    if v_stage = 'lost' and v_lost_reason is null then
      v_lost_reason := 'Não informado na importação';
    end if;

    v_existing := private.import_find_lead(p_job.organization_id, v_email, v_phone);

    if v_existing is not null and p_job.duplicate_mode = 'skip' then
      return private.import_outcome(v_line, 'skipped', 'duplicate_in_base');
    end if;

    if v_existing is null then
      -- Data de entrada (lida por leads_before_write) e de ganho/perda (lida
      -- por leads_log_events).
      perform set_config(
        'app.import_received_at',
        case when v_received is not null then v_received::text else '' end,
        true
      );
      perform set_config(
        'app.import_stage_at',
        case when v_stage in ('won', 'lost') and v_closed is not null then v_closed::text else '' end,
        true
      );

      insert into public.leads (
        organization_id, name, email, phone, interest, source, stage, lost_reason, message,
        typology, assigned_to, last_contact_at
      )
      values (
        p_job.organization_id,
        v_name,
        v_email,
        v_phone,
        v_interest,
        coalesce(private.import_text(p_row, 'source'), 'other')::public.lead_source,
        v_stage,
        case when v_stage = 'lost' then v_lost_reason end,
        private.import_text(p_row, 'message'),
        private.import_text(p_row, 'typology'),
        private.import_text(p_row, 'assigned_to')::uuid,
        v_first_contact
      )
      returning id into v_id;

      perform set_config('app.import_received_at', '', true);
      perform set_config('app.import_stage_at', '', true);
      perform private.import_track(p_job.id, 'leads', v_id);

      return private.import_outcome(v_line, 'inserted');
    end if;

    update public.leads l
    set
      name = v_name,
      email = coalesce(v_email, l.email),
      phone = coalesce(v_phone, l.phone),
      interest = coalesce(v_interest, l.interest),
      message = coalesce(private.import_text(p_row, 'message'), l.message),
      stage = case when v_stage_given then v_stage else l.stage end,
      lost_reason = case
        when v_stage_given and v_stage = 'lost' then coalesce(private.import_text(p_row, 'lost_reason'), l.lost_reason, v_lost_reason)
        else l.lost_reason
      end,
      assigned_to = coalesce(private.import_text(p_row, 'assigned_to')::uuid, l.assigned_to)
    where l.id = v_existing;

    if not found then
      return private.import_outcome(v_line, 'failed', 'permission_denied');
    end if;

    return private.import_outcome(v_line, 'updated');
  exception
    when others then
      return private.import_outcome(v_line, 'failed', private.import_error_code(sqlstate, sqlerrm));
  end;
end;
$$;
