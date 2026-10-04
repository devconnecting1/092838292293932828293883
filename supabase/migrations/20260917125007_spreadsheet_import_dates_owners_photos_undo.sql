-- =============================================================================
-- Importação de planilhas v2: datas originais do lead, proprietários do imóvel,
-- fotos por link, assistente importando e "Desfazer esta importação"
-- =============================================================================
-- 1. Lead importado guarda a origem (leads.import_job_id e leads.imported_at).
--    A planilha pode trazer "Data de entrada", "Data do 1º contato" e "Data de
--    ganho ou perda": o lead entra com essas datas (created_at, assigned_at,
--    first_contact_at e o evento de etapa). Sem data de entrada, o lead não
--    conta em "Recebidos"/"Atendidos" de período nenhum (created_at =
--    imported_at) e não ganha evento de etapa; com ou sem data, o SLA de
--    primeiro contato (no prazo, mediana, média) ignora lead importado.
-- 2. Proprietários do imóvel: cada linha pode trazer um ou mais proprietários
--    (nome, CPF/CNPJ, telefone, e-mail, percentual). O cliente é encontrado
--    por CPF/CNPJ, e-mail ou telefone, ou criado (base legal: contrato), e o
--    vínculo vai para property_owners. Percentuais informados somam 100.
-- 3. Fotos por link: os links ficam numa fila interna (private.
--    import_photo_queue). O servidor do app baixa em lotes pequenos, otimiza e
--    grava no Storage; o banco registra a foto como o upload normal
--    (property_media, com os gatilhos de limite do plano valendo).
-- 4. Assistente importa (as próprias importações); dono e gerente seguem
--    vendo todas. A exportação não muda.
-- 5. Desfazer por até 7 dias: remove o que o lote criou e não foi alterado nem
--    usado depois (o resto fica, com contagem de "mantidos"). O registro do que
--    cada importação criou fica em private.import_job_records; o desfazer é
--    registrado em audit_events só com contagens.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Origem da importação no lead
-- -----------------------------------------------------------------------------
alter table public.leads
  add column if not exists import_job_id uuid,
  add column if not exists imported_at timestamptz;

alter table public.leads
  drop constraint if exists leads_import_job_fkey;

alter table public.leads
  add constraint leads_import_job_fkey foreign key (organization_id, import_job_id)
    references public.import_jobs (organization_id, id) on delete set null (import_job_id);

alter table public.leads
  drop constraint if exists leads_import_origin_pair;

alter table public.leads
  add constraint leads_import_origin_pair check (import_job_id is null or imported_at is not null);

create index if not exists leads_organization_import_job_idx
  on public.leads (organization_id, import_job_id)
  where import_job_id is not null;

comment on column public.leads.import_job_id is
  'Importação de planilha que criou o lead (null para lead que entrou pelo CRM). Gravado só pelo banco na importação; não muda depois.';
comment on column public.leads.imported_at is
  'Quando o lead foi importado. created_at = imported_at quer dizer que a planilha não trouxe a data de entrada: o lead não conta em "Recebidos" de período nenhum. Relatórios ignoram o SLA de primeiro contato de lead importado.';

-- -----------------------------------------------------------------------------
-- 2. Importação desfeita
-- -----------------------------------------------------------------------------
alter table public.import_jobs
  add column if not exists undone_at timestamptz,
  add column if not exists undone_by uuid references auth.users (id) on delete set null;

create index if not exists import_jobs_undone_by_idx
  on public.import_jobs (undone_by)
  where undone_by is not null;

comment on column public.import_jobs.undone_at is
  'Quando a importação foi desfeita (até 7 dias depois). Importação desfeita não recebe lote, foto nem outro desfazer.';
comment on column public.import_jobs.undone_by is
  'Quem desfez a importação.';

-- Assistente lê as próprias importações; dono e gerente leem todas.
drop policy if exists "import_jobs: dono e gerente leem" on public.import_jobs;
drop policy if exists "import_jobs: dono e gerente leem tudo, assistente as próprias" on public.import_jobs;
create policy "import_jobs: dono e gerente leem tudo, assistente as próprias"
  on public.import_jobs for select to authenticated
  using (
    (select private.has_role(organization_id, '{owner,manager}'))
    or (
      created_by = (select auth.uid())
      and (select private.has_role(organization_id, '{assistant}'))
    )
  );

drop policy if exists "import_job_batches: dono e gerente leem" on public.import_job_batches;
drop policy if exists "import_job_batches: dono e gerente leem tudo, assistente as próprias" on public.import_job_batches;
create policy "import_job_batches: dono e gerente leem tudo, assistente as próprias"
  on public.import_job_batches for select to authenticated
  using (
    (select private.has_role(organization_id, '{owner,manager}'))
    or exists (
      select 1
      from public.import_jobs j
      where j.organization_id = import_job_batches.organization_id
        and j.id = import_job_batches.job_id
        and j.created_by = (select auth.uid())
        and private.has_role(j.organization_id, '{assistant}')
    )
  );

-- -----------------------------------------------------------------------------
-- 3. Tabelas internas: o que cada importação criou e a fila de fotos
-- -----------------------------------------------------------------------------
create table if not exists private.import_job_records (
  organization_id uuid not null,
  job_id uuid not null,
  entity text not null,
  record_id uuid not null,
  recorded_at timestamptz not null default now(),
  undo_status text,
  constraint import_job_records_pkey primary key (job_id, entity, record_id),
  constraint import_job_records_job_fkey foreign key (organization_id, job_id)
    references public.import_jobs (organization_id, id) on delete cascade,
  constraint import_job_records_entity_check check (
    entity in ('clients', 'leads', 'properties', 'property_owners', 'property_media')
  ),
  constraint import_job_records_undo_status_check check (
    undo_status is null or undo_status in ('removing', 'removed', 'kept', 'missing')
  )
);

create index if not exists import_job_records_job_status_idx
  on private.import_job_records (job_id, undo_status, entity);
create index if not exists import_job_records_organization_job_idx
  on private.import_job_records (organization_id, job_id);

comment on table private.import_job_records is
  'Registros criados por uma importação de planilha (cliente, lead, imóvel, vínculo de proprietário, foto). Só ids: base do "Desfazer esta importação". undo_status: removing (decidido, aguardando exclusão), removed, kept (alterado ou usado depois), missing (já não existia).';

create table if not exists private.import_photo_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  property_id uuid not null,
  row_number integer not null,
  position smallint not null,
  url text not null,
  status text not null default 'pending',
  error_code text,
  attempts smallint not null default 0,
  locked_until timestamptz,
  media_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_photo_queue_job_fkey foreign key (organization_id, job_id)
    references public.import_jobs (organization_id, id) on delete cascade,
  constraint import_photo_queue_property_fkey foreign key (organization_id, property_id)
    references public.properties (organization_id, id) on delete cascade,
  constraint import_photo_queue_item_key unique (job_id, property_id, position),
  constraint import_photo_queue_status_check check (
    status in ('pending', 'processing', 'done', 'failed')
  ),
  constraint import_photo_queue_position_range check (position between 0 and 19),
  constraint import_photo_queue_url_format check (
    char_length(url) between 10 and 2000 and url ~* '^https?://[^[:space:][:cntrl:]]+$'
  ),
  constraint import_photo_queue_error_code_length check (char_length(error_code) <= 40),
  constraint import_photo_queue_attempts_range check (attempts between 0 and 10)
);

create index if not exists import_photo_queue_job_status_idx
  on private.import_photo_queue (job_id, status, row_number, position);
create index if not exists import_photo_queue_organization_property_idx
  on private.import_photo_queue (organization_id, property_id);

create trigger import_photo_queue_set_updated_at
  before update on private.import_photo_queue
  for each row execute function private.set_updated_at();

comment on table private.import_photo_queue is
  'Links de fotos de imóveis importados por planilha, baixados pelo servidor do app em lotes pequenos. Situação por link: pending, processing (com prazo em locked_until), done (media_id) ou failed (error_code estável que a tela traduz).';

alter table private.import_job_records enable row level security;
alter table private.import_photo_queue enable row level security;

revoke all on private.import_job_records from public, anon, authenticated;
revoke all on private.import_photo_queue from public, anon, authenticated;

drop policy if exists "import_job_records: sem acesso pela API" on private.import_job_records;
create policy "import_job_records: sem acesso pela API"
  on private.import_job_records as restrictive for all to anon, authenticated
  using (false) with check (false);
comment on policy "import_job_records: sem acesso pela API" on private.import_job_records is
  'Negação explícita (RESTRICTIVE): tabela interna, lida e gravada só por funções security definer e rotinas agendadas. Nunca crie política permissiva nem grant para anon/authenticated aqui.';

drop policy if exists "import_photo_queue: sem acesso pela API" on private.import_photo_queue;
create policy "import_photo_queue: sem acesso pela API"
  on private.import_photo_queue as restrictive for all to anon, authenticated
  using (false) with check (false);
comment on policy "import_photo_queue: sem acesso pela API" on private.import_photo_queue is
  'Negação explícita (RESTRICTIVE): tabela interna, lida e gravada só por funções security definer e rotinas agendadas. Nunca crie política permissiva nem grant para anon/authenticated aqui.';

-- -----------------------------------------------------------------------------
-- 4. Lead: datas originais e origem na importação
-- -----------------------------------------------------------------------------
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
      new.created_at := least(coalesce(new.created_at, now()), now());
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
  'Normaliza e valida o lead, marca o primeiro contato e calcula o prazo de primeiro contato. Na importação de planilha (app.import_job): grava a origem (import_job_id, imported_at), respeita as datas da planilha e não abre prazo.';

create or replace function private.leads_log_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := left(nullif(btrim(coalesce(current_setting('app.lead_event_reason', true), '')), ''), 40);
  v_insert_reason text := left(nullif(btrim(coalesce(current_setting('app.lead_insert_reason', true), '')), ''), 40);
  v_actor uuid := (select auth.uid());
  v_known constant text[] := array[
    'created', 'manual', 'claim', 'roulette', 'landing_page', 'sla_reassign',
    'sla_queued', 'bulk_transfer', 'bulk_release', 'member_removed'
  ];
  v_stage_at timestamptz;
begin
  if tg_op = 'INSERT' then
    -- Lead importado: o evento de etapa leva a data da planilha (ganho/perda
    -- ou entrada). Sem data nenhuma não há evento: o funil e os ganhos do mês
    -- da importação não mudam.
    if new.import_job_id is not null then
      v_stage_at := case
        when new.stage in ('won', 'lost') then coalesce(
          nullif(current_setting('app.import_stage_at', true), '')::timestamptz,
          case when new.created_at < new.imported_at then new.created_at end
        )
        when new.created_at < new.imported_at then new.created_at
      end;

      if v_stage_at is not null then
        insert into public.lead_stage_events (
          organization_id, lead_id, from_stage, to_stage, changed_by, reason, created_at
        )
        values (
          new.organization_id, new.id, null, new.stage, v_actor, 'import',
          least(v_stage_at, now())
        );
      end if;

      if new.assigned_to is not null then
        insert into public.lead_assignment_events (
          organization_id, lead_id, from_user_id, to_user_id, changed_by, reason, created_at
        )
        values (
          new.organization_id, new.id, null, new.assigned_to, v_actor, 'created',
          coalesce(new.assigned_at, now())
        );
      end if;

      -- Base antiga não mexe na vez do rodízio.
      return null;
    end if;

    -- Etapa: o lead entrou no funil pelo canal X.
    insert into public.lead_stage_events (
      organization_id, lead_id, from_stage, to_stage, changed_by, reason
    )
    values (
      new.organization_id, new.id, null, new.stage, v_actor,
      case when new.source = 'landing_page' then 'landing_page' else 'created' end
    );

    -- Atribuição: quem decidiu o responsável (roleta, página, cadastro manual).
    if new.assigned_to is not null then
      v_reason := coalesce(v_insert_reason, v_reason, 'created');

      insert into public.lead_assignment_events (
        organization_id, lead_id, from_user_id, to_user_id, changed_by, reason
      )
      values (
        new.organization_id, new.id, null, new.assigned_to, v_actor,
        case when v_reason = any (v_known) then v_reason else 'created' end
      );

      update public.lead_routing_members m
      set last_assigned_at = now()
      where m.organization_id = new.organization_id
        and m.user_id = new.assigned_to;
    end if;

    return null;
  end if;

  if new.stage is distinct from old.stage then
    insert into public.lead_stage_events (
      organization_id, lead_id, from_stage, to_stage, changed_by, reason
    )
    values (new.organization_id, new.id, old.stage, new.stage, v_actor, v_reason);
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    insert into public.lead_assignment_events (
      organization_id, lead_id, from_user_id, to_user_id, changed_by, reason
    )
    values (
      new.organization_id, new.id, old.assigned_to, new.assigned_to, v_actor,
      case
        when v_reason = any (v_known) then v_reason
        -- Corretor assumindo um lead que estava sem responsável.
        when v_actor is not null
         and old.assigned_to is null
         and new.assigned_to = v_actor then 'claim'
        else 'manual'
      end
    );

    if new.assigned_to is not null then
      update public.lead_routing_members m
      set last_assigned_at = now()
      where m.organization_id = new.organization_id
        and m.user_id = new.assigned_to;
    end if;
  end if;

  return null;
end;
$$;

revoke all on function private.leads_log_events() from public, anon, authenticated;

comment on function private.leads_log_events() is
  'Histórico de etapa e de responsável do lead. Lead importado: evento de etapa com a data da planilha (reason = import) ou nenhum, sem mexer na vez do rodízio.';

-- -----------------------------------------------------------------------------
-- 5. Utilitários
-- -----------------------------------------------------------------------------
-- Data e hora ISO 8601 com fuso (o app manda -03:00). Vazio vira null; formato
-- inválido ou fora de 1990..agora+1 dia gera 22007 (linha com invalid_value).
create or replace function private.import_timestamp(p_row jsonb, p_key text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_text constant text := private.import_text(p_row, p_key);
  v_value timestamptz;
begin
  if v_text is null then
    return null;
  end if;

  if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'import_invalid_date' using errcode = '22007';
  end if;

  v_value := v_text::timestamptz;

  if v_value < timestamptz '1990-01-01 00:00:00+00' or v_value > now() + interval '1 day' then
    raise exception 'import_invalid_date' using errcode = '22007';
  end if;

  return least(v_value, now());
end;
$$;

create or replace function private.import_error_code(p_state text, p_message text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_state = 'P0001' and p_message = 'assinatura_somente_leitura' then 'billing_read_only'
    when p_message = 'import_invalid_owner' then 'invalid_owner'
    when p_message = 'import_invalid_owner_share' then 'invalid_owner_share'
    when p_message = 'import_invalid_date' then 'invalid_date'
    when p_message = 'import_invalid_date_order' then 'invalid_date_order'
    when p_message = 'import_invalid_photo_url' then 'invalid_photo_link'
    when p_state = '42501' then 'permission_denied'
    when p_state = '23505' then 'duplicate_unique'
    when p_state = '23514' and p_message ilike '%membro ativo%' then 'invalid_member'
    when p_state = '23514' and p_message ilike '%e-mail%' then 'invalid_email'
    when p_state = '23514' and p_message ilike '%telefone%' then 'invalid_phone'
    when p_state = '23514' and p_message ilike '%nome%' then 'invalid_name'
    when p_state in ('23514', '22P02', '22007', '22008', '22003', '23502') then 'invalid_value'
    when p_state = '22001' then 'too_long'
    else 'write_failed'
  end;
$$;

-- Registra um registro criado pela importação em andamento. Só vale dentro de
-- public.import_batch (app.import_job), para quem abriu a importação e para
-- linhas que essa pessoa acabou de criar.
create or replace function private.import_track(p_job_id uuid, p_entity text, p_record_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user constant uuid := (select auth.uid());
  v_job public.import_jobs;
  v_ok boolean;
begin
  if v_user is null or p_job_id is null or p_record_id is null
     or coalesce(current_setting('app.import_job', true), '') <> p_job_id::text then
    raise exception 'Registro de importação inválido.' using errcode = '42501';
  end if;

  select * into v_job from public.import_jobs j where j.id = p_job_id;

  if not found
     or v_job.created_by is distinct from v_user
     or v_job.finished_at is not null
     or v_job.undone_at is not null then
    raise exception 'Registro de importação inválido.' using errcode = '42501';
  end if;

  v_ok := case p_entity
    when 'clients' then exists (
      select 1 from public.clients c
      where c.id = p_record_id and c.organization_id = v_job.organization_id
        and c.created_by = v_user and c.created_at >= v_job.created_at
    )
    when 'leads' then exists (
      select 1 from public.leads l
      where l.id = p_record_id and l.organization_id = v_job.organization_id
        and l.created_by = v_user and l.import_job_id = v_job.id
    )
    when 'properties' then exists (
      select 1 from public.properties p
      where p.id = p_record_id and p.organization_id = v_job.organization_id
        and p.created_by = v_user and p.created_at >= v_job.created_at
    )
    when 'property_owners' then exists (
      select 1 from public.property_owners po
      where po.id = p_record_id and po.organization_id = v_job.organization_id
        and po.created_by = v_user and po.created_at >= v_job.created_at
    )
    else false
  end;

  if not v_ok then
    raise exception 'Registro de importação inválido.' using errcode = '42501';
  end if;

  insert into private.import_job_records (organization_id, job_id, entity, record_id)
  values (v_job.organization_id, v_job.id, p_entity, p_record_id)
  on conflict (job_id, entity, record_id) do nothing;
end;
$$;

-- Coloca na fila os links de foto de um imóvel da importação em andamento.
create or replace function private.import_enqueue_photos(
  p_job_id uuid,
  p_property_id uuid,
  p_line integer,
  p_urls jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user constant uuid := (select auth.uid());
  v_job public.import_jobs;
  v_rows integer;
begin
  if v_user is null or p_job_id is null or p_property_id is null
     or coalesce(current_setting('app.import_job', true), '') <> p_job_id::text then
    raise exception 'Registro de importação inválido.' using errcode = '42501';
  end if;

  select * into v_job from public.import_jobs j where j.id = p_job_id;

  if not found
     or v_job.created_by is distinct from v_user
     or v_job.finished_at is not null
     or v_job.undone_at is not null
     or v_job.kind <> 'properties'
     or not exists (
       select 1 from public.properties p
       where p.id = p_property_id and p.organization_id = v_job.organization_id
     )
     or not private.can_edit_property(p_property_id) then
    raise exception 'Registro de importação inválido.' using errcode = '42501';
  end if;

  if p_urls is null or jsonb_typeof(p_urls) <> 'array' or jsonb_array_length(p_urls) > 20
     or exists (
       select 1
       from jsonb_array_elements(p_urls) as u(value)
       where jsonb_typeof(u.value) <> 'string'
          or char_length(u.value #>> '{}') not between 10 and 2000
          or (u.value #>> '{}') !~* '^https?://[^[:space:][:cntrl:]]+$'
     ) then
    raise exception 'import_invalid_photo_url' using errcode = '22023';
  end if;

  insert into private.import_photo_queue (
    organization_id, job_id, property_id, row_number, position, url
  )
  select v_job.organization_id, v_job.id, p_property_id, greatest(coalesce(p_line, 0), 0),
         (u.n - 1)::smallint, u.value
  from jsonb_array_elements_text(p_urls) with ordinality as u(value, n)
  on conflict (job_id, property_id, position) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- Proprietário da linha: cliente existente (CPF/CNPJ, e-mail ou telefone) ou
-- um novo, criado com a sessão de quem importa (RLS de clients valendo).
create or replace function private.import_owner_client(p_job public.import_jobs, p_owner jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_name text;
  v_document text;
  v_email text;
  v_phone text;
  v_id uuid;
begin
  if p_owner is null or jsonb_typeof(p_owner) <> 'object' then
    raise exception 'import_invalid_owner' using errcode = '22023';
  end if;

  v_name := private.import_text(p_owner, 'name');
  v_document := upper(private.import_text(p_owner, 'document'));
  v_email := lower(private.import_text(p_owner, 'email'));
  v_phone := private.import_text(p_owner, 'phone');

  if v_name is null or char_length(v_name) > 200
     or (v_document is null and v_email is null and v_phone is null)
     or (v_email is not null and (
       char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     ))
     or (v_phone is not null and v_phone !~ '^[0-9]{10,11}$')
     or (v_document is not null and v_document !~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$') then
    raise exception 'import_invalid_owner' using errcode = '22023';
  end if;

  v_id := private.import_find_client(
    p_job.organization_id, v_document, v_email, array_remove(array[v_phone], null)
  );

  if v_id is not null then
    return v_id;
  end if;

  insert into public.clients (
    organization_id, kind, name, document, email, phone, tags, lgpd_legal_basis
  )
  values (
    p_job.organization_id,
    case when char_length(v_document) = 14 then 'pj' else 'pf' end::public.client_kind,
    v_name,
    v_document,
    v_email,
    v_phone,
    array['Proprietário'],
    'contract'
  )
  returning id into v_id;

  perform private.import_track(p_job.id, 'clients', v_id);

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Busca do registro existente: assistente também importa
-- -----------------------------------------------------------------------------
create or replace function private.import_find_client(
  p_organization_id uuid,
  p_document text,
  p_email text,
  p_phone_keys text[]
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_organization_id is null
     or not private.has_role(p_organization_id, '{owner,manager,assistant}') then
    return null;
  end if;

  if p_document is not null then
    select c.id into v_id
    from public.clients c
    where c.organization_id = p_organization_id
      and c.document = p_document;

    if v_id is not null then
      return v_id;
    end if;
  end if;

  if p_email is not null then
    select c.id into v_id
    from public.clients c
    where c.organization_id = p_organization_id
      and lower(btrim(c.email)) = p_email
    order by c.created_at
    limit 1;

    if v_id is not null then
      return v_id;
    end if;
  end if;

  if coalesce(cardinality(p_phone_keys), 0) > 0 then
    select c.id into v_id
    from public.clients c
    where c.organization_id = p_organization_id
      and (
        right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 11) = any (p_phone_keys)
        or right(regexp_replace(c.whatsapp, '[^0-9]', '', 'g'), 11) = any (p_phone_keys)
      )
    order by c.created_at
    limit 1;
  end if;

  return v_id;
end;
$$;

create or replace function private.import_find_lead(
  p_organization_id uuid,
  p_email text,
  p_phone text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_organization_id is null
     or not private.has_role(p_organization_id, '{owner,manager,assistant}') then
    return null;
  end if;

  if p_phone is not null then
    select l.id into v_id
    from public.leads l
    where l.organization_id = p_organization_id
      and right(l.phone, 11) = right(p_phone, 11)
    order by l.created_at
    limit 1;

    if v_id is not null then
      return v_id;
    end if;
  end if;

  if p_email is not null then
    select l.id into v_id
    from public.leads l
    where l.organization_id = p_organization_id
      and lower(l.email) = p_email
    order by l.created_at
    limit 1;
  end if;

  return v_id;
end;
$$;

create or replace function private.import_find_property(p_organization_id uuid, p_row jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_code constant text := private.import_text(p_row, 'external_code');
  v_type constant text := private.import_text(p_row, 'type');
  v_purpose constant text := private.import_text(p_row, 'purpose');
  v_title constant text := lower(coalesce(private.import_text(p_row, 'title'), ''));
  v_street constant text := lower(coalesce(private.import_text(p_row, 'street'), ''));
  v_number constant text := lower(coalesce(private.import_text(p_row, 'street_number'), ''));
  v_complement constant text := lower(coalesce(private.import_text(p_row, 'complement'), ''));
  v_neighborhood constant text := lower(coalesce(private.import_text(p_row, 'neighborhood'), ''));
  v_city constant text := lower(coalesce(private.import_text(p_row, 'city'), ''));
begin
  if p_organization_id is null
     or not private.has_role(p_organization_id, '{owner,manager,assistant}') then
    return null;
  end if;

  if v_code is not null then
    select p.id into v_id
    from public.properties p
    where p.organization_id = p_organization_id
      and p.external_code = v_code;

    return v_id;
  end if;

  select p.id into v_id
  from public.properties p
  where p.organization_id = p_organization_id
    and lower(p.title) = v_title
    and p.type::text = v_type
    and p.purpose::text = v_purpose
    and lower(coalesce(p.street, '')) = v_street
    and lower(coalesce(p.street_number, '')) = v_number
    and lower(coalesce(p.complement, '')) = v_complement
    and lower(coalesce(p.neighborhood, '')) = v_neighborhood
    and lower(coalesce(p.city, '')) = v_city
  order by p.created_at
  limit 1;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Gravação de uma linha
-- -----------------------------------------------------------------------------
create or replace function private.import_client_row(p_job public.import_jobs, p_row jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_line constant integer := private.import_line(p_row);
  v_name text;
  v_document text;
  v_email text;
  v_phone text;
  v_whatsapp text;
  v_kind public.client_kind;
  v_tags text[];
  v_new_tags text[];
  v_existing uuid;
  v_id uuid;
begin
  begin
    v_name := private.import_text(p_row, 'name');
    v_document := upper(private.import_text(p_row, 'document'));
    v_email := lower(private.import_text(p_row, 'email'));
    v_phone := private.import_text(p_row, 'phone');
    v_whatsapp := private.import_text(p_row, 'whatsapp');
    v_kind := coalesce(
      private.import_text(p_row, 'kind'),
      case when char_length(v_document) = 14 then 'pj' else 'pf' end
    )::public.client_kind;

    if v_name is null then
      return private.import_outcome(v_line, 'failed', 'required_name');
    end if;

    if char_length(v_name) > 200 then
      return private.import_outcome(v_line, 'failed', 'too_long');
    end if;

    if v_email is not null
       and (char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
      return private.import_outcome(v_line, 'failed', 'invalid_email');
    end if;

    if (v_phone is not null and v_phone !~ '^[0-9]{10,11}$')
       or (v_whatsapp is not null and v_whatsapp !~ '^[0-9]{10,11}$') then
      return private.import_outcome(v_line, 'failed', 'invalid_phone');
    end if;

    if v_document is not null and not (
      (v_kind = 'pf' and v_document ~ '^[0-9]{11}$')
      or (v_kind = 'pj' and v_document ~ '^[0-9A-Z]{12}[0-9]{2}$')
    ) then
      return private.import_outcome(v_line, 'failed', 'invalid_document');
    end if;

    if v_document is null and v_email is null and v_phone is null and v_whatsapp is null then
      return private.import_outcome(v_line, 'failed', 'required_contact');
    end if;

    v_existing := private.import_find_client(
      p_job.organization_id,
      v_document,
      v_email,
      array_remove(array[v_phone, v_whatsapp], null)
    );

    if v_existing is not null and p_job.duplicate_mode = 'skip' then
      return private.import_outcome(v_line, 'skipped', 'duplicate_in_base');
    end if;

    v_tags := array(
      select btrim(t.value)
      from jsonb_array_elements_text(coalesce(p_row -> 'tags', '[]'::jsonb)) with ordinality as t(value, n)
      where btrim(t.value) <> ''
      order by t.n
    );

    if v_existing is null then
      v_new_tags := v_tags;

      if private.import_text(p_job.options, 'tag') is not null then
        v_new_tags := v_new_tags || private.import_text(p_job.options, 'tag');
      end if;

      insert into public.clients (
        organization_id, kind, name, trade_name, document, rg, birth_date, email, phone,
        whatsapp, postal_code, street, street_number, complement, neighborhood, city, state,
        source, tags, assigned_to, lgpd_legal_basis, notes
      )
      values (
        p_job.organization_id,
        v_kind,
        v_name,
        case when v_kind = 'pj' then private.import_text(p_row, 'trade_name') end,
        v_document,
        case when v_kind = 'pf' then private.import_text(p_row, 'rg') end,
        case when v_kind = 'pf' then private.import_text(p_row, 'birth_date')::date end,
        v_email,
        v_phone,
        v_whatsapp,
        private.import_text(p_row, 'postal_code'),
        private.import_text(p_row, 'street'),
        private.import_text(p_row, 'street_number'),
        private.import_text(p_row, 'complement'),
        private.import_text(p_row, 'neighborhood'),
        private.import_text(p_row, 'city'),
        private.import_text(p_row, 'state'),
        private.import_text(p_row, 'source'),
        array(
          select t.value
          from unnest(v_new_tags) with ordinality as t(value, n)
          group by t.value
          order by min(t.n)
        ),
        private.import_text(p_row, 'assigned_to')::uuid,
        private.import_text(p_job.options, 'legal_basis'),
        private.import_text(p_row, 'notes')
      )
      returning id into v_id;

      perform private.import_track(p_job.id, 'clients', v_id);

      return private.import_outcome(v_line, 'inserted');
    end if;

    -- Atualizar: só o que veio preenchido na planilha substitui o que existe.
    update public.clients c
    set
      kind = case when v_document is not null then v_kind else c.kind end,
      name = v_name,
      trade_name = case
        when (case when v_document is not null then v_kind else c.kind end) = 'pj'
          then coalesce(private.import_text(p_row, 'trade_name'), c.trade_name)
        else c.trade_name
      end,
      document = coalesce(v_document, c.document),
      rg = coalesce(private.import_text(p_row, 'rg'), c.rg),
      birth_date = coalesce(private.import_text(p_row, 'birth_date')::date, c.birth_date),
      email = coalesce(v_email, c.email),
      phone = coalesce(v_phone, c.phone),
      whatsapp = coalesce(v_whatsapp, c.whatsapp),
      postal_code = coalesce(private.import_text(p_row, 'postal_code'), c.postal_code),
      street = coalesce(private.import_text(p_row, 'street'), c.street),
      street_number = coalesce(private.import_text(p_row, 'street_number'), c.street_number),
      complement = coalesce(private.import_text(p_row, 'complement'), c.complement),
      neighborhood = coalesce(private.import_text(p_row, 'neighborhood'), c.neighborhood),
      city = coalesce(private.import_text(p_row, 'city'), c.city),
      state = coalesce(private.import_text(p_row, 'state'), c.state),
      source = coalesce(private.import_text(p_row, 'source'), c.source),
      tags = array(
        select t.value
        from unnest(c.tags || v_tags) with ordinality as t(value, n)
        group by t.value
        order by min(t.n)
      ),
      assigned_to = coalesce(private.import_text(p_row, 'assigned_to')::uuid, c.assigned_to),
      lgpd_legal_basis = coalesce(c.lgpd_legal_basis, private.import_text(p_job.options, 'legal_basis')),
      notes = coalesce(private.import_text(p_row, 'notes'), c.notes)
    where c.id = v_existing;

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
      -- Data de ganho/perda para o evento de etapa (lido por leads_log_events).
      perform set_config(
        'app.import_stage_at',
        case when v_stage in ('won', 'lost') and v_closed is not null then v_closed::text else '' end,
        true
      );

      insert into public.leads (
        organization_id, name, email, phone, interest, source, stage, lost_reason, message,
        typology, assigned_to, created_at, last_contact_at
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
        coalesce(v_received, now()),
        v_first_contact
      )
      returning id into v_id;

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

create or replace function private.import_property_row(p_job public.import_jobs, p_row jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_line constant integer := private.import_line(p_row);
  v_title text;
  v_title_generated boolean;
  v_purpose public.listing_purpose;
  v_type public.property_type;
  v_status public.property_status;
  v_sale numeric;
  v_rent numeric;
  v_living numeric;
  v_lot numeric;
  v_features text[];
  v_existing uuid;
  v_old public.properties;
  v_code text;
  v_id uuid;
  v_owners jsonb;
  v_photos jsonb;
  v_owner jsonb;
  v_owner_count integer;
  v_share_count integer;
  v_share_sum numeric;
  v_client uuid;
  v_link uuid;
  v_link_inserted boolean;
begin
  begin
    v_title := private.import_text(p_row, 'title');
    v_title_generated := coalesce((p_row ->> 'title_generated')::boolean, false);
    v_purpose := private.import_text(p_row, 'purpose')::public.listing_purpose;
    v_type := private.import_text(p_row, 'type')::public.property_type;
    v_sale := private.import_text(p_row, 'sale_price')::numeric;
    v_rent := private.import_text(p_row, 'rent_price')::numeric;
    v_living := private.import_text(p_row, 'living_area')::numeric;
    v_lot := private.import_text(p_row, 'lot_area')::numeric;
    v_owners := coalesce(p_row -> 'owners', '[]'::jsonb);
    v_photos := coalesce(p_row -> 'photo_urls', '[]'::jsonb);

    if v_type is null then
      return private.import_outcome(v_line, 'failed', 'required_type');
    end if;

    if v_purpose is null then
      return private.import_outcome(v_line, 'failed', 'required_purpose');
    end if;

    if v_title is null then
      return private.import_outcome(v_line, 'failed', 'required_title');
    end if;

    if char_length(v_title) > 200 then
      return private.import_outcome(v_line, 'failed', 'too_long');
    end if;

    -- Proprietários: até 10 por imóvel; percentuais, quando informados, em
    -- todos e somando 100.
    if jsonb_typeof(v_owners) <> 'array' or jsonb_array_length(v_owners) > 10 then
      return private.import_outcome(v_line, 'failed', 'invalid_owner');
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_owners) as o(value)
      where jsonb_typeof(o.value) <> 'object'
         or (
           private.import_text(o.value, 'share_percent') is not null
           and (
             private.import_text(o.value, 'share_percent') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$'
             or private.import_text(o.value, 'share_percent')::numeric not between 0.01 and 100
           )
         )
    ) then
      return private.import_outcome(v_line, 'failed', 'invalid_owner_share');
    end if;

    select
      count(*)::integer,
      count(private.import_text(o.value, 'share_percent'))::integer,
      coalesce(sum(private.import_text(o.value, 'share_percent')::numeric), 0)
    into v_owner_count, v_share_count, v_share_sum
    from jsonb_array_elements(v_owners) as o(value);

    if v_share_count > 0 and (v_share_count <> v_owner_count or abs(v_share_sum - 100) > 0.01) then
      return private.import_outcome(v_line, 'failed', 'invalid_owner_share');
    end if;

    if jsonb_typeof(v_photos) <> 'array' or jsonb_array_length(v_photos) > 20 then
      return private.import_outcome(v_line, 'failed', 'invalid_photo_link');
    end if;

    v_features := array(
      select btrim(t.value)
      from jsonb_array_elements_text(coalesce(p_row -> 'features', '[]'::jsonb)) with ordinality as t(value, n)
      where btrim(t.value) <> ''
      order by t.n
    );

    v_existing := private.import_find_property(p_job.organization_id, p_row);

    if v_existing is not null and p_job.duplicate_mode = 'skip' then
      return private.import_outcome(v_line, 'skipped', 'duplicate_in_base');
    end if;

    if v_existing is null then
      v_status := coalesce(private.import_text(p_row, 'status'), 'active')::public.property_status;

      if v_status <> 'draft'
         and not private.import_property_complete(v_purpose, v_type, v_sale, v_rent, v_living, v_lot) then
        v_status := 'draft';
        v_code := 'saved_as_draft';
      end if;

      insert into public.properties (
        organization_id, external_code, title, description, purpose, usage, type, status,
        sale_price, rent_price, condo_fee, iptu_yearly, living_area, lot_area, bedrooms, suites,
        bathrooms, parking_spaces, floor, total_floors, year_built, features, furnished,
        accepts_pets, accepts_exchange, postal_code, street, street_number, complement,
        neighborhood, city, state, broker_id, captured_by
      )
      values (
        p_job.organization_id,
        private.import_text(p_row, 'external_code'),
        v_title,
        private.import_text(p_row, 'description'),
        v_purpose,
        coalesce(private.import_text(p_row, 'usage'), 'residential')::public.property_usage,
        v_type,
        v_status,
        v_sale,
        v_rent,
        private.import_text(p_row, 'condo_fee')::numeric,
        private.import_text(p_row, 'iptu_yearly')::numeric,
        v_living,
        v_lot,
        private.import_text(p_row, 'bedrooms')::smallint,
        private.import_text(p_row, 'suites')::smallint,
        private.import_text(p_row, 'bathrooms')::smallint,
        private.import_text(p_row, 'parking_spaces')::smallint,
        private.import_text(p_row, 'floor')::smallint,
        private.import_text(p_row, 'total_floors')::smallint,
        private.import_text(p_row, 'year_built')::smallint,
        v_features,
        coalesce(private.import_text(p_row, 'furnished')::boolean, false),
        coalesce(private.import_text(p_row, 'accepts_pets')::boolean, false),
        coalesce(private.import_text(p_row, 'accepts_exchange')::boolean, false),
        private.import_text(p_row, 'postal_code'),
        private.import_text(p_row, 'street'),
        private.import_text(p_row, 'street_number'),
        private.import_text(p_row, 'complement'),
        private.import_text(p_row, 'neighborhood'),
        private.import_text(p_row, 'city'),
        private.import_text(p_row, 'state'),
        private.import_text(p_row, 'broker_id')::uuid,
        private.import_text(p_row, 'captured_by')::uuid
      )
      returning id into v_id;

      perform private.import_track(p_job.id, 'properties', v_id);
    else
      select * into v_old from public.properties p where p.id = v_existing;

      if not found then
        return private.import_outcome(v_line, 'failed', 'permission_denied');
      end if;

      -- Valores finais (planilha por cima do que existe) para decidir o status.
      v_sale := coalesce(v_sale, v_old.sale_price);
      v_rent := coalesce(v_rent, v_old.rent_price);
      v_living := coalesce(v_living, v_old.living_area);
      v_lot := coalesce(v_lot, v_old.lot_area);
      v_status := coalesce(private.import_text(p_row, 'status')::public.property_status, v_old.status);

      if v_status <> 'draft'
         and not private.import_property_complete(v_purpose, v_type, v_sale, v_rent, v_living, v_lot) then
        v_status := 'draft';
        v_code := 'saved_as_draft';
      end if;

      update public.properties p
      set
        external_code = coalesce(p.external_code, private.import_text(p_row, 'external_code')),
        title = case when v_title_generated then p.title else v_title end,
        description = coalesce(private.import_text(p_row, 'description'), p.description),
        purpose = v_purpose,
        usage = coalesce(private.import_text(p_row, 'usage')::public.property_usage, p.usage),
        type = v_type,
        status = v_status,
        sale_price = v_sale,
        rent_price = v_rent,
        condo_fee = coalesce(private.import_text(p_row, 'condo_fee')::numeric, p.condo_fee),
        iptu_yearly = coalesce(private.import_text(p_row, 'iptu_yearly')::numeric, p.iptu_yearly),
        living_area = v_living,
        lot_area = v_lot,
        bedrooms = coalesce(private.import_text(p_row, 'bedrooms')::smallint, p.bedrooms),
        suites = coalesce(private.import_text(p_row, 'suites')::smallint, p.suites),
        bathrooms = coalesce(private.import_text(p_row, 'bathrooms')::smallint, p.bathrooms),
        parking_spaces = coalesce(private.import_text(p_row, 'parking_spaces')::smallint, p.parking_spaces),
        floor = coalesce(private.import_text(p_row, 'floor')::smallint, p.floor),
        total_floors = coalesce(private.import_text(p_row, 'total_floors')::smallint, p.total_floors),
        year_built = coalesce(private.import_text(p_row, 'year_built')::smallint, p.year_built),
        features = array(
          select t.value
          from unnest(p.features || v_features) with ordinality as t(value, n)
          group by t.value
          order by min(t.n)
        ),
        furnished = coalesce(private.import_text(p_row, 'furnished')::boolean, p.furnished),
        accepts_pets = coalesce(private.import_text(p_row, 'accepts_pets')::boolean, p.accepts_pets),
        accepts_exchange = coalesce(private.import_text(p_row, 'accepts_exchange')::boolean, p.accepts_exchange),
        postal_code = coalesce(private.import_text(p_row, 'postal_code'), p.postal_code),
        street = coalesce(private.import_text(p_row, 'street'), p.street),
        street_number = coalesce(private.import_text(p_row, 'street_number'), p.street_number),
        complement = coalesce(private.import_text(p_row, 'complement'), p.complement),
        neighborhood = coalesce(private.import_text(p_row, 'neighborhood'), p.neighborhood),
        city = coalesce(private.import_text(p_row, 'city'), p.city),
        state = coalesce(private.import_text(p_row, 'state'), p.state),
        broker_id = coalesce(private.import_text(p_row, 'broker_id')::uuid, p.broker_id),
        captured_by = coalesce(private.import_text(p_row, 'captured_by')::uuid, p.captured_by)
      where p.id = v_existing;

      if not found then
        return private.import_outcome(v_line, 'failed', 'permission_denied');
      end if;

      v_id := v_existing;
    end if;

    -- Proprietários (cliente existente ou novo) e vínculo em property_owners.
    for v_owner in select o.value from jsonb_array_elements(v_owners) as o(value) loop
      v_client := private.import_owner_client(p_job, v_owner);

      insert into public.property_owners (organization_id, property_id, client_id, share_percent)
      values (
        p_job.organization_id,
        v_id,
        v_client,
        private.import_text(v_owner, 'share_percent')::numeric
      )
      on conflict (property_id, client_id) do update
        set share_percent = coalesce(excluded.share_percent, public.property_owners.share_percent)
      returning id, (xmax = 0) into v_link, v_link_inserted;

      if v_link_inserted then
        perform private.import_track(p_job.id, 'property_owners', v_link);
      end if;
    end loop;

    -- Fotos por link: imóvel novo ou já existente ainda sem foto.
    if jsonb_array_length(v_photos) > 0
       and (
         v_existing is null
         or not exists (
           select 1 from public.property_media m
           where m.organization_id = p_job.organization_id
             and m.property_id = v_id
             and m.kind = 'image'
         )
       ) then
      perform private.import_enqueue_photos(p_job.id, v_id, v_line, v_photos);
    end if;

    return private.import_outcome(
      v_line,
      case when v_existing is null then 'inserted' else 'updated' end,
      v_code
    );
  exception
    when others then
      return private.import_outcome(v_line, 'failed', private.import_error_code(sqlstate, sqlerrm));
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Abertura, lotes e fechamento: assistente importa; importação desfeita
--    não recebe mais nada
-- -----------------------------------------------------------------------------
create or replace function private.import_start_job(
  p_organization_id uuid,
  p_job_id uuid,
  p_kind public.import_kind,
  p_duplicate_mode public.import_duplicate_mode,
  p_total_rows integer,
  p_options jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user constant uuid := (select auth.uid());
  v_options constant jsonb := coalesce(p_options, '{}'::jsonb);
  v_job public.import_jobs;
  v_rows integer;
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null
     or not private.has_role(p_organization_id, '{owner,manager,assistant}') then
    raise exception 'Só dono, gerente e assistente importam planilhas.' using errcode = '42501';
  end if;

  if p_job_id is null or p_kind is null or p_duplicate_mode is null then
    raise exception 'Importação inválida. Comece de novo.' using errcode = '22023';
  end if;

  if p_total_rows is null or p_total_rows not between 1 and 5000 then
    raise exception 'A planilha precisa ter de 1 a 5.000 linhas.' using errcode = '22023';
  end if;

  if jsonb_typeof(v_options) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(v_options) as k(key) where k.key not in ('legal_basis', 'tag')
     ) then
    raise exception 'Opções de importação inválidas.' using errcode = '22023';
  end if;

  if p_kind = 'clients' then
    if coalesce(v_options ->> 'legal_basis', '') not in ('legitimate_interest', 'contract') then
      raise exception 'Escolha a base legal (LGPD) dos contatos importados.' using errcode = '22023';
    end if;

    if v_options ? 'tag' and (
      jsonb_typeof(v_options -> 'tag') <> 'string'
      or char_length(btrim(v_options ->> 'tag')) not between 1 and 40
    ) then
      raise exception 'A etiqueta precisa ter de 1 a 40 caracteres.' using errcode = '22023';
    end if;
  elsif v_options <> '{}'::jsonb then
    raise exception 'Opções de importação inválidas.' using errcode = '22023';
  end if;

  if private.billing_state(p_organization_id) = 'read_only' then
    raise exception 'assinatura_somente_leitura' using errcode = 'P0001';
  end if;

  insert into public.import_jobs (
    id, organization_id, kind, duplicate_mode, options, total_rows, created_by
  )
  values (
    p_job_id, p_organization_id, p_kind, p_duplicate_mode, v_options, p_total_rows, v_user
  )
  on conflict (id) do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    select * into v_job from public.import_jobs j where j.id = p_job_id;

    if v_job.organization_id is distinct from p_organization_id
       or v_job.created_by is distinct from v_user
       or v_job.kind is distinct from p_kind
       or v_job.duplicate_mode is distinct from p_duplicate_mode
       or v_job.total_rows is distinct from p_total_rows then
      raise exception 'Importação inválida. Comece de novo.' using errcode = '42501';
    end if;

    if v_job.undone_at is not null then
      raise exception 'Esta importação foi desfeita.' using errcode = '22023';
    end if;

    if v_job.finished_at is not null then
      raise exception 'Esta importação já foi concluída.' using errcode = '22023';
    end if;
  end if;

  return p_job_id;
end;
$$;

create or replace function private.import_save_batch(
  p_job_id uuid,
  p_batch_index integer,
  p_results jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user constant uuid := (select auth.uid());
  v_job public.import_jobs;
  v_inserted integer;
  v_updated integer;
  v_skipped integer;
  v_failed integer;
  v_rows integer;
begin
  select * into v_job
  from public.import_jobs j
  where j.id = p_job_id
  for update;

  if not found
     or v_job.created_by is distinct from v_user
     or not private.has_role(v_job.organization_id, '{owner,manager,assistant}') then
    raise exception 'Importação não encontrada.' using errcode = '42501';
  end if;

  if v_job.finished_at is not null or v_job.undone_at is not null then
    raise exception 'Esta importação já foi concluída.' using errcode = '22023';
  end if;

  select
    count(*) filter (where r.value ->> 'status' = 'inserted'),
    count(*) filter (where r.value ->> 'status' = 'updated'),
    count(*) filter (where r.value ->> 'status' = 'skipped'),
    count(*) filter (where r.value ->> 'status' = 'failed')
  into v_inserted, v_updated, v_skipped, v_failed
  from jsonb_array_elements(p_results) as r(value);

  insert into public.import_job_batches (
    organization_id, job_id, batch_index, row_count, inserted_count, updated_count,
    skipped_count, failed_count, results
  )
  values (
    v_job.organization_id, p_job_id, p_batch_index, jsonb_array_length(p_results), v_inserted,
    v_updated, v_skipped, v_failed, p_results
  )
  on conflict (job_id, batch_index) do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 1 then
    update public.import_jobs j
    set
      inserted_count = j.inserted_count + v_inserted,
      updated_count = j.updated_count + v_updated,
      skipped_count = j.skipped_count + v_skipped,
      failed_count = j.failed_count + v_failed
    where j.id = p_job_id;
  end if;
end;
$$;

create or replace function private.import_finish_job(
  p_organization_id uuid,
  p_job_id uuid,
  p_invalid_rows integer,
  p_file_duplicates integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user constant uuid := (select auth.uid());
  v_job public.import_jobs;
  v_batches integer;
  v_photos integer;
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null
     or not private.has_role(p_organization_id, '{owner,manager,assistant}') then
    raise exception 'Só dono, gerente e assistente importam planilhas.' using errcode = '42501';
  end if;

  select * into v_job
  from public.import_jobs j
  where j.id = p_job_id
    and j.organization_id = p_organization_id
  for update;

  if not found or v_job.created_by is distinct from v_user then
    raise exception 'Importação não encontrada.' using errcode = '42501';
  end if;

  if v_job.undone_at is not null then
    raise exception 'Esta importação foi desfeita.' using errcode = '22023';
  end if;

  select count(*)::integer into v_photos
  from private.import_photo_queue q
  where q.job_id = v_job.id;

  if v_job.finished_at is null then
    if coalesce(p_invalid_rows, -1) < 0 or coalesce(p_file_duplicates, -1) < 0 then
      raise exception 'Contagem inválida.' using errcode = '22023';
    end if;

    select count(*)::integer into v_batches
    from public.import_job_batches b
    where b.job_id = v_job.id;

    update public.import_jobs j
    set
      failed_count = j.failed_count + p_invalid_rows,
      skipped_count = j.skipped_count + p_file_duplicates,
      finished_at = now()
    where j.id = v_job.id
    returning * into v_job;

    -- Auditoria da importação: só tipo, modo e contagens (nenhum dado das linhas).
    insert into public.audit_events (organization_id, actor_id, action, entity, entity_id, metadata)
    values (
      v_job.organization_id,
      v_user,
      'import',
      'import_jobs',
      v_job.id,
      jsonb_build_object(
        'kind', v_job.kind,
        'duplicate_mode', v_job.duplicate_mode,
        'total_rows', v_job.total_rows,
        'inserted', v_job.inserted_count,
        'updated', v_job.updated_count,
        'skipped', v_job.skipped_count,
        'failed', v_job.failed_count,
        'batches', v_batches,
        'photo_links', v_photos
      )
    );
  end if;

  return jsonb_build_object(
    'job_id', v_job.id,
    'kind', v_job.kind,
    'total_rows', v_job.total_rows,
    'inserted', v_job.inserted_count,
    'updated', v_job.updated_count,
    'skipped', v_job.skipped_count,
    'failed', v_job.failed_count,
    'photo_links', v_photos,
    'finished_at', v_job.finished_at
  );
end;
$$;

create or replace function public.import_find_existing(
  p_organization_id uuid,
  p_kind public.import_kind,
  p_rows jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_found jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null
     or not private.has_role(p_organization_id, '{owner,manager,assistant}') then
    raise exception 'Só dono, gerente e assistente importam planilhas.' using errcode = '42501';
  end if;

  if p_kind is null or p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Envie de 0 a 1.000 linhas por consulta.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(private.import_line(r.value) order by r.n), '[]'::jsonb)
  into v_found
  from jsonb_array_elements(p_rows) with ordinality as r(value, n)
  where jsonb_typeof(r.value) = 'object'
    and case p_kind
      when 'clients' then private.import_find_client(
        p_organization_id,
        upper(private.import_text(r.value, 'document')),
        lower(private.import_text(r.value, 'email')),
        array_remove(
          array[private.import_text(r.value, 'phone'), private.import_text(r.value, 'whatsapp')],
          null
        )
      ) is not null
      when 'leads' then private.import_find_lead(
        p_organization_id,
        lower(private.import_text(r.value, 'email')),
        private.import_text(r.value, 'phone')
      ) is not null
      else private.import_find_property(p_organization_id, r.value) is not null
    end;

  return v_found;
end;
$$;

create or replace function public.import_batch(
  p_organization_id uuid,
  p_job_id uuid,
  p_batch_index integer,
  p_rows jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.import_jobs;
  v_saved public.import_job_batches;
  v_item jsonb;
  v_outcome jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null
     or not private.has_role(p_organization_id, '{owner,manager,assistant}') then
    raise exception 'Só dono, gerente e assistente importam planilhas.' using errcode = '42501';
  end if;

  if p_batch_index is null or p_batch_index not between 0 and 4999 then
    raise exception 'Lote inválido.' using errcode = '22023';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) not between 1 and 250 then
    raise exception 'Cada lote precisa ter de 1 a 250 linhas.' using errcode = '22023';
  end if;

  select * into v_job
  from public.import_jobs j
  where j.id = p_job_id
    and j.organization_id = p_organization_id;

  if not found or v_job.created_by is distinct from (select auth.uid()) then
    raise exception 'Importação não encontrada.' using errcode = '42501';
  end if;

  if v_job.undone_at is not null then
    raise exception 'Esta importação foi desfeita.' using errcode = '22023';
  end if;

  if v_job.finished_at is not null then
    raise exception 'Esta importação já foi concluída.' using errcode = '22023';
  end if;

  -- Uma gravação por vez por imobiliária e tipo: dois envios simultâneos do
  -- mesmo lote (ou duas pessoas importando a mesma planilha) não duplicam.
  perform pg_advisory_xact_lock(
    hashtextextended('import:' || p_organization_id::text || ':' || v_job.kind::text, 0)
  );

  select * into v_saved
  from public.import_job_batches b
  where b.job_id = p_job_id
    and b.batch_index = p_batch_index;

  if found then
    return jsonb_build_object(
      'batch_index', v_saved.batch_index,
      'replayed', true,
      'inserted', v_saved.inserted_count,
      'updated', v_saved.updated_count,
      'skipped', v_saved.skipped_count,
      'failed', v_saved.failed_count,
      'results', v_saved.results
    );
  end if;

  perform set_config('app.import_job', p_job_id::text, true);

  for v_item in select r.value from jsonb_array_elements(p_rows) as r(value) loop
    if jsonb_typeof(v_item) <> 'object' then
      v_outcome := private.import_outcome(0, 'failed', 'invalid_value');
    else
      v_outcome := case v_job.kind
        when 'clients' then private.import_client_row(v_job, v_item)
        when 'leads' then private.import_lead_row(v_job, v_item)
        else private.import_property_row(v_job, v_item)
      end;
    end if;

    v_results := v_results || jsonb_build_array(v_outcome);
  end loop;

  perform set_config('app.import_job', '', true);
  perform set_config('app.import_stage_at', '', true);

  perform private.import_save_batch(p_job_id, p_batch_index, v_results);

  select * into v_saved
  from public.import_job_batches b
  where b.job_id = p_job_id
    and b.batch_index = p_batch_index;

  return jsonb_build_object(
    'batch_index', p_batch_index,
    'replayed', false,
    'inserted', v_saved.inserted_count,
    'updated', v_saved.updated_count,
    'skipped', v_saved.skipped_count,
    'failed', v_saved.failed_count,
    'results', v_saved.results
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Fotos por link (o download e a otimização são do servidor do app)
-- -----------------------------------------------------------------------------
-- Quem pode mexer na importação: quem a abriu (se ainda importa) ou dono/gerente.
create or replace function private.import_job_for_action(p_organization_id uuid, p_job_id uuid)
returns public.import_jobs
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user constant uuid := (select auth.uid());
  v_job public.import_jobs;
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null or p_job_id is null then
    raise exception 'Importação não encontrada.' using errcode = '42501';
  end if;

  select * into v_job
  from public.import_jobs j
  where j.id = p_job_id
    and j.organization_id = p_organization_id;

  if not found or not (
    private.has_role(p_organization_id, '{owner,manager}')
    or (
      v_job.created_by = v_user
      and private.has_role(p_organization_id, '{owner,manager,assistant}')
    )
  ) then
    raise exception 'Importação não encontrada.' using errcode = '42501';
  end if;

  return v_job;
end;
$$;

create or replace function private.import_photos_claim(
  p_organization_id uuid,
  p_job_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.import_jobs;
  v_limit constant integer := least(greatest(coalesce(p_limit, 4), 1), 10);
  v_item private.import_photo_queue;
  v_claimed jsonb := '[]'::jsonb;
  v_status public.property_status;
  v_all_images integer;
  v_owned integer;
  v_in_flight integer;
  v_per_listing integer;
  v_listings integer;
  v_listing_limit integer;
  v_code text;
begin
  v_job := private.import_job_for_action(p_organization_id, p_job_id);

  if v_job.undone_at is not null then
    raise exception 'Esta importação foi desfeita.' using errcode = '22023';
  end if;

  if private.billing_state(p_organization_id) = 'read_only' then
    raise exception 'assinatura_somente_leitura' using errcode = 'P0001';
  end if;

  v_per_listing := private.billing_limit(p_organization_id, 'photos_per_listing');
  v_listing_limit := private.billing_limit(p_organization_id, 'owned_listings');

  for v_item in
    select q.*
    from private.import_photo_queue q
    where q.job_id = p_job_id
      and (
        q.status = 'pending'
        or (q.status = 'processing' and q.locked_until < now())
      )
    order by q.row_number, q.property_id, q.position
    limit 60
    for update skip locked
  loop
    exit when jsonb_array_length(v_claimed) >= v_limit;

    v_code := null;

    if v_item.attempts >= 3 then
      v_code := 'download_failed';
    elsif not private.can_edit_property(v_item.property_id) then
      v_code := 'permission_denied';
    else
      select p.status into v_status
      from public.properties p
      where p.organization_id = p_organization_id and p.id = v_item.property_id;

      select
        count(*) filter (where m.kind = 'image')::integer,
        count(*) filter (where m.kind = 'image' and m.storage_path is not null)::integer
      into v_all_images, v_owned
      from public.property_media m
      where m.organization_id = p_organization_id and m.property_id = v_item.property_id;

      select count(*)::integer into v_in_flight
      from private.import_photo_queue q
      where q.job_id = p_job_id
        and q.property_id = v_item.property_id
        and q.id <> v_item.id
        and q.status = 'processing'
        and q.locked_until >= now();

      if v_all_images + v_in_flight >= 20 then
        v_code := 'photo_limit_property';
      elsif v_per_listing is not null and v_per_listing >= 0
            and v_owned + v_in_flight >= v_per_listing then
        v_code := 'photo_limit_per_listing';
      elsif v_owned + v_in_flight = 0
            and not (v_status = any (private.owned_listing_exempt_statuses()))
            and v_listing_limit is not null and v_listing_limit >= 0 then
        v_listings := private.owned_listing_count(p_organization_id, v_item.property_id);

        if v_listings >= v_listing_limit then
          v_code := 'listing_limit';
        end if;
      end if;
    end if;

    if v_code is not null then
      update private.import_photo_queue q
      set status = 'failed', error_code = v_code, locked_until = null
      where q.id = v_item.id;
    else
      update private.import_photo_queue q
      set status = 'processing', attempts = q.attempts + 1, locked_until = now() + interval '3 minutes'
      where q.id = v_item.id;

      v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
        'id', v_item.id,
        'property_id', v_item.property_id,
        'row', v_item.row_number,
        'position', v_item.position,
        'url', v_item.url
      ));
    end if;
  end loop;

  return v_claimed;
end;
$$;

create or replace function private.import_photos_complete(
  p_organization_id uuid,
  p_job_id uuid,
  p_item_id uuid,
  p_storage_path text,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.import_jobs;
  v_item private.import_photo_queue;
  v_code text;
  v_position integer;
  v_has_cover boolean;
  v_media uuid;
  v_remaining integer;
begin
  v_job := private.import_job_for_action(p_organization_id, p_job_id);

  select * into v_item
  from private.import_photo_queue q
  where q.id = p_item_id
    and q.job_id = p_job_id
    and q.organization_id = p_organization_id
  for update;

  if not found or v_item.status <> 'processing' or v_job.undone_at is not null then
    return jsonb_build_object('ok', false, 'code', 'stale', 'property_done', false);
  end if;

  if p_error_code is not null then
    v_code := case
      when p_error_code in (
        'download_failed', 'invalid_link', 'blocked_address', 'timeout', 'too_large',
        'not_image', 'optimize_failed', 'upload_failed', 'http_error'
      ) then p_error_code
      else 'download_failed'
    end;
  elsif p_storage_path is null
     or p_storage_path !~ (
       '^' || p_organization_id::text || '/properties/' || v_item.property_id::text
       || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
     ) then
    v_code := 'upload_failed';
  elsif not private.can_edit_property(v_item.property_id) then
    v_code := 'permission_denied';
  else
    begin
      select coalesce(max(m.position) + 1, 0), coalesce(bool_or(m.is_cover), false)
      into v_position, v_has_cover
      from public.property_media m
      where m.organization_id = p_organization_id
        and m.property_id = v_item.property_id;

      insert into public.property_media (
        organization_id, property_id, kind, storage_path, position, is_cover
      )
      values (
        p_organization_id, v_item.property_id, 'image', p_storage_path, v_position, not v_has_cover
      )
      returning id into v_media;

      insert into private.import_job_records (organization_id, job_id, entity, record_id)
      values (p_organization_id, p_job_id, 'property_media', v_media)
      on conflict (job_id, entity, record_id) do nothing;
    exception
      when others then
        v_code := case
          when sqlerrm = 'limite_photos_per_listing' then 'photo_limit_per_listing'
          when sqlerrm = 'limite_owned_listings' then 'listing_limit'
          when sqlerrm = 'limite_fotos_imovel' then 'photo_limit_property'
          when sqlerrm = 'assinatura_somente_leitura' then 'billing_read_only'
          when sqlstate = '42501' then 'permission_denied'
          else 'upload_failed'
        end;
    end;
  end if;

  update private.import_photo_queue q
  set
    status = case when v_code is null then 'done' else 'failed' end,
    error_code = v_code,
    media_id = v_media,
    locked_until = null
  where q.id = v_item.id;

  select count(*)::integer into v_remaining
  from private.import_photo_queue q
  where q.job_id = p_job_id
    and q.property_id = v_item.property_id
    and q.status in ('pending', 'processing');

  return jsonb_build_object(
    'ok', v_code is null,
    'code', v_code,
    'property_id', v_item.property_id,
    'property_done', v_remaining = 0
  );
end;
$$;

create or replace function private.import_photos_status(p_organization_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job public.import_jobs;
  v_result jsonb;
begin
  v_job := private.import_job_for_action(p_organization_id, p_job_id);

  select jsonb_build_object(
    'total', count(*),
    'pending', count(*) filter (where q.status in ('pending', 'processing')),
    'done', count(*) filter (where q.status = 'done'),
    'failed', count(*) filter (where q.status = 'failed'),
    'failures', coalesce(
      jsonb_agg(
        jsonb_build_object('row', q.row_number, 'position', q.position, 'code', q.error_code)
        order by q.row_number, q.position
      ) filter (where q.status = 'failed'),
      '[]'::jsonb
    )
  )
  into v_result
  from private.import_photo_queue q
  where q.job_id = v_job.id;

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Desfazer a importação (até 7 dias)
-- -----------------------------------------------------------------------------
-- Registro em uso por outra tabela (proposta, visita, tarefa, vínculo feito à
-- mão...). Percorre as chaves estrangeiras do catálogo, então tabela nova que
-- referencie o registro também conta. Ignora históricos automáticos do lead e,
-- quando pedido, fotos e vínculos de proprietário criados pela própria
-- importação.
create or replace function private.import_record_in_use(
  p_table text,
  p_record_id uuid,
  p_job_id uuid,
  p_ignore_job_children boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fk record;
  v_found boolean;
begin
  if p_table not in ('clients', 'leads', 'properties') then
    raise exception 'Tabela inválida.' using errcode = '22023';
  end if;

  for v_fk in
    select
      c.conrelid::regclass::text as source,
      cl.relname,
      (
        select a.attname
        from unnest(c.conkey, c.confkey) as k(src, dst)
        join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.src
        join pg_catalog.pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = k.dst
        where fa.attname = 'id'
        limit 1
      ) as col
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class cl on cl.oid = c.conrelid
    join pg_catalog.pg_namespace ns on ns.oid = cl.relnamespace
    where c.contype = 'f'
      and c.confrelid = ('public.' || p_table)::regclass
      and ns.nspname = 'public'
      and cl.relname not in ('lead_stage_events', 'lead_assignment_events')
  loop
    continue when v_fk.col is null;

    if p_ignore_job_children and v_fk.relname in ('property_media', 'property_owners') then
      execute format(
        'select exists (select 1 from %s t where t.%I = $1 and not exists ('
          || 'select 1 from private.import_job_records r '
          || 'where r.job_id = $2 and r.entity = %L and r.record_id = t.id))',
        v_fk.source, v_fk.col, v_fk.relname
      )
      into v_found
      using p_record_id, p_job_id;
    else
      execute format('select exists (select 1 from %s t where t.%I = $1)', v_fk.source, v_fk.col)
      into v_found
      using p_record_id;
    end if;

    if v_found then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

-- Alterado depois da importação: evento de auditoria de UPDATE (a nota do
-- anúncio recalculada pelo sistema não conta).
create or replace function private.import_record_changed(
  p_organization_id uuid,
  p_table text,
  p_record_id uuid,
  p_since timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.audit_events a
    where a.entity = p_table
      and a.entity_id = p_record_id
      and a.organization_id = p_organization_id
      and a.action = 'update'
      and a.created_at >= p_since
      and not (coalesce(a.metadata -> 'changed_fields', '[]'::jsonb) <@ '["imob_score"]'::jsonb)
  );
$$;

-- Decide o próximo pedaço: marca 'removing' (vai sair) ou 'kept' (fica) e
-- devolve os arquivos do Storage das fotos que vão sair. A ordem é imóveis,
-- fotos, vínculos de proprietário, leads e clientes: cliente só é decidido
-- depois que os imóveis do lote já saíram (o vínculo de um imóvel mantido
-- segura o cliente).
create or replace function private.import_undo_prepare(
  p_organization_id uuid,
  p_job_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.import_jobs;
  v_limit constant integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_entity text;
  v_record private.import_job_records;
  v_decision text;
  v_paths text[] := '{}';
begin
  v_job := private.import_job_for_action(p_organization_id, p_job_id);

  if v_job.undone_at is not null then
    raise exception 'Esta importação já foi desfeita.' using errcode = '22023';
  end if;

  if coalesce(v_job.finished_at, v_job.created_at) < now() - interval '7 days' then
    raise exception 'O prazo de 7 dias para desfazer esta importação terminou.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('import_undo:' || p_job_id::text, 0));

  -- Fotos ainda na fila não são mais baixadas.
  update private.import_photo_queue q
  set status = 'failed', error_code = 'import_undone', locked_until = null
  where q.job_id = p_job_id
    and q.status in ('pending', 'processing');

  -- Pedaço anterior ainda não aplicado: só devolve os arquivos de novo.
  if not exists (
    select 1 from private.import_job_records r
    where r.job_id = p_job_id and r.undo_status = 'removing'
  ) then
    select r.entity into v_entity
    from private.import_job_records r
    where r.job_id = p_job_id
      and r.undo_status is null
    order by case r.entity
      when 'properties' then 1
      when 'property_media' then 2
      when 'property_owners' then 3
      when 'leads' then 4
      else 5
    end
    limit 1;

    if v_entity is not null then
      for v_record in
        select r.*
        from private.import_job_records r
        where r.job_id = p_job_id
          and r.entity = v_entity
          and r.undo_status is null
        order by r.recorded_at, r.record_id
        limit v_limit
        for update
      loop
        v_decision := case v_entity
          when 'properties' then case
            when not exists (select 1 from public.properties p where p.id = v_record.record_id) then 'missing'
            when private.import_record_changed(p_organization_id, 'properties', v_record.record_id, v_record.recorded_at)
              or private.import_record_in_use('properties', v_record.record_id, p_job_id, true) then 'kept'
            else 'removing'
          end
          when 'property_media' then case
            when not exists (select 1 from public.property_media m where m.id = v_record.record_id) then 'missing'
            when exists (
              select 1 from public.property_media m
              where m.id = v_record.record_id and m.updated_at > m.created_at + interval '1 second'
            ) then 'kept'
            else 'removing'
          end
          when 'property_owners' then case
            when not exists (select 1 from public.property_owners po where po.id = v_record.record_id) then 'missing'
            when exists (
              select 1 from public.property_owners po
              where po.id = v_record.record_id and po.updated_at > po.created_at + interval '1 second'
            ) then 'kept'
            else 'removing'
          end
          when 'leads' then case
            when not exists (select 1 from public.leads l where l.id = v_record.record_id) then 'missing'
            when private.import_record_changed(p_organization_id, 'leads', v_record.record_id, v_record.recorded_at)
              or private.import_record_in_use('leads', v_record.record_id, p_job_id, false) then 'kept'
            else 'removing'
          end
          else case
            when not exists (select 1 from public.clients c where c.id = v_record.record_id) then 'missing'
            when private.import_record_changed(p_organization_id, 'clients', v_record.record_id, v_record.recorded_at)
              or private.import_record_in_use('clients', v_record.record_id, p_job_id, false) then 'kept'
            else 'removing'
          end
        end;

        update private.import_job_records r
        set undo_status = v_decision
        where r.job_id = v_record.job_id
          and r.entity = v_record.entity
          and r.record_id = v_record.record_id;

        -- Fotos e vínculos do imóvel seguem a decisão do imóvel.
        if v_entity = 'properties' and v_decision in ('removing', 'kept') then
          update private.import_job_records r
          set undo_status = v_decision
          where r.job_id = p_job_id
            and r.undo_status is null
            and (
              (r.entity = 'property_media' and exists (
                select 1 from public.property_media m
                where m.id = r.record_id and m.property_id = v_record.record_id
              ))
              or (r.entity = 'property_owners' and exists (
                select 1 from public.property_owners po
                where po.id = r.record_id and po.property_id = v_record.record_id
              ))
            );
        end if;
      end loop;
    end if;
  end if;

  -- Arquivos das fotos que vão sair (principal e miniatura: o app deriva).
  select coalesce(array_agg(m.storage_path order by m.storage_path), '{}')
  into v_paths
  from private.import_job_records r
  join public.property_media m on m.id = r.record_id
  where r.job_id = p_job_id
    and r.entity = 'property_media'
    and r.undo_status = 'removing'
    and m.storage_path is not null;

  return jsonb_build_object(
    'storage_paths', to_jsonb(v_paths),
    'undecided', (
      select count(*) from private.import_job_records r
      where r.job_id = p_job_id and r.undo_status is null
    )
  );
end;
$$;

-- Apaga o que foi marcado 'removing' e, quando não sobra nada por decidir,
-- fecha o desfazer (undone_at) e registra em audit_events só as contagens.
create or replace function private.import_undo_apply(p_organization_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user constant uuid := (select auth.uid());
  v_job public.import_jobs;
  v_removed jsonb;
  v_kept jsonb;
  v_done boolean;
begin
  v_job := private.import_job_for_action(p_organization_id, p_job_id);

  if v_job.undone_at is not null then
    raise exception 'Esta importação já foi desfeita.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('import_undo:' || p_job_id::text, 0));

  -- Lead ou cliente alterado entre a decisão e agora fica.
  update private.import_job_records r
  set undo_status = 'kept'
  where r.job_id = p_job_id
    and r.undo_status = 'removing'
    and r.entity in ('leads', 'clients')
    and private.import_record_changed(p_organization_id, r.entity, r.record_id, r.recorded_at);

  delete from public.property_media m
  using private.import_job_records r
  where r.job_id = p_job_id and r.entity = 'property_media' and r.undo_status = 'removing'
    and m.id = r.record_id and m.organization_id = p_organization_id;

  delete from public.property_owners po
  using private.import_job_records r
  where r.job_id = p_job_id and r.entity = 'property_owners' and r.undo_status = 'removing'
    and po.id = r.record_id and po.organization_id = p_organization_id;

  delete from public.properties p
  using private.import_job_records r
  where r.job_id = p_job_id and r.entity = 'properties' and r.undo_status = 'removing'
    and p.id = r.record_id and p.organization_id = p_organization_id;

  delete from public.leads l
  using private.import_job_records r
  where r.job_id = p_job_id and r.entity = 'leads' and r.undo_status = 'removing'
    and l.id = r.record_id and l.organization_id = p_organization_id;

  delete from public.clients c
  using private.import_job_records r
  where r.job_id = p_job_id and r.entity = 'clients' and r.undo_status = 'removing'
    and c.id = r.record_id and c.organization_id = p_organization_id;

  update private.import_job_records r
  set undo_status = 'removed'
  where r.job_id = p_job_id and r.undo_status = 'removing';

  v_done := not exists (
    select 1 from private.import_job_records r
    where r.job_id = p_job_id and (r.undo_status is null or r.undo_status = 'removing')
  );

  select
    jsonb_build_object(
      'clients', count(*) filter (where r.entity = 'clients' and r.undo_status = 'removed'),
      'leads', count(*) filter (where r.entity = 'leads' and r.undo_status = 'removed'),
      'properties', count(*) filter (where r.entity = 'properties' and r.undo_status = 'removed'),
      'property_owners', count(*) filter (where r.entity = 'property_owners' and r.undo_status = 'removed'),
      'property_media', count(*) filter (where r.entity = 'property_media' and r.undo_status = 'removed')
    ),
    jsonb_build_object(
      'clients', count(*) filter (where r.entity = 'clients' and r.undo_status = 'kept'),
      'leads', count(*) filter (where r.entity = 'leads' and r.undo_status = 'kept'),
      'properties', count(*) filter (where r.entity = 'properties' and r.undo_status = 'kept'),
      'property_owners', count(*) filter (where r.entity = 'property_owners' and r.undo_status = 'kept'),
      'property_media', count(*) filter (where r.entity = 'property_media' and r.undo_status = 'kept')
    )
  into v_removed, v_kept
  from private.import_job_records r
  where r.job_id = p_job_id;

  if v_done then
    update public.import_jobs j
    set undone_at = now(), undone_by = v_user
    where j.id = p_job_id;

    insert into public.audit_events (organization_id, actor_id, action, entity, entity_id, metadata)
    values (
      p_organization_id,
      v_user,
      'import_undo',
      'import_jobs',
      p_job_id,
      jsonb_build_object('kind', v_job.kind, 'removed', v_removed, 'kept', v_kept)
    );
  end if;

  return jsonb_build_object('done', v_done, 'removed', v_removed, 'kept', v_kept);
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. RPCs (SECURITY INVOKER; as checagens estão nas funções de private)
-- -----------------------------------------------------------------------------
create or replace function public.import_photos_claim(
  p_organization_id uuid,
  p_job_id uuid,
  p_limit integer default 4
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.import_photos_claim(p_organization_id, p_job_id, p_limit);
$$;

create or replace function public.import_photos_complete(
  p_organization_id uuid,
  p_job_id uuid,
  p_item_id uuid,
  p_storage_path text default null,
  p_error_code text default null
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.import_photos_complete(p_organization_id, p_job_id, p_item_id, p_storage_path, p_error_code);
$$;

create or replace function public.import_photos_status(p_organization_id uuid, p_job_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.import_photos_status(p_organization_id, p_job_id);
$$;

create or replace function public.import_undo_prepare(
  p_organization_id uuid,
  p_job_id uuid,
  p_limit integer default 100
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.import_undo_prepare(p_organization_id, p_job_id, p_limit);
$$;

create or replace function public.import_undo_apply(p_organization_id uuid, p_job_id uuid)
returns jsonb
language sql
set search_path = ''
as $$
  select private.import_undo_apply(p_organization_id, p_job_id);
$$;

-- -----------------------------------------------------------------------------
-- 12. Relatórios: lead importado não conta no SLA, e sem data de entrada não
--     conta em "Recebidos"/"Atendidos" de período nenhum
-- -----------------------------------------------------------------------------
-- Ajuste pontual sobre a versão das funções que está no banco agora (outras
-- frentes também mexem nelas): cada trecho precisa aparecer exatamente uma vez.
do $$
declare
  v_patch record;
  v_def text;
  v_count integer;
begin
  for v_patch in
    select *
    from (
      values
        (
          'private.report_broker_performance(uuid,timestamp with time zone,timestamp with time zone,uuid,uuid)',
          '(and l\.assigned_to = e\.user_id\s+and coalesce\(l\.assigned_at, l\.created_at\) >= j\.inicio)',
          E'\\1\n      and (l.imported_at is null or l.created_at < l.imported_at)'
        ),
        (
          'private.report_broker_performance(uuid,timestamp with time zone,timestamp with time zone,uuid,uuid)',
          'where (l\.first_contact_at is not null\s+and l\.first_contact_at\s+<= coalesce\(l\.assigned_at, l\.created_at\))',
          E'where l.imported_at is null\n          and \\1'
        ),
        (
          'private.report_broker_performance(uuid,timestamp with time zone,timestamp with time zone,uuid,uuid)',
          'when (l\.first_contact_at >= coalesce\(l\.assigned_at, l\.created_at\))',
          'when l.imported_at is null and \1'
        ),
        (
          'private.report_lead_sources(uuid,timestamp with time zone,timestamp with time zone,uuid,integer,uuid)',
          '(and l\.created_at >= j\.inicio\s+and l\.created_at < j\.fim)',
          E'\\1\n      and (l.imported_at is null or l.created_at < l.imported_at)'
        ),
        (
          'private.report_sales_goals(uuid,date,uuid,uuid)',
          '(and l\.assigned_to = c\.user_id\s+and coalesce\(l\.assigned_at, l\.created_at\) >= x\.inicio)',
          E'\\1\n        and (l.imported_at is null or l.created_at < l.imported_at)'
        ),
        (
          'public.get_lead_routing_overview(uuid)',
          '(and l\.first_contact_at >= l\.assigned_at)',
          E'\\1\n          and l.imported_at is null'
        )
    ) as p(fn, pattern, replacement)
  loop
    v_def := pg_catalog.pg_get_functiondef(v_patch.fn::regprocedure);
    v_count := pg_catalog.regexp_count(v_def, v_patch.pattern);

    if v_count <> 1 then
      raise exception 'Trecho esperado em % apareceu % vezes: %', v_patch.fn, v_count, v_patch.pattern;
    end if;

    execute pg_catalog.regexp_replace(v_def, v_patch.pattern, v_patch.replacement);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 13. Permissões de execução e comentários
-- -----------------------------------------------------------------------------
revoke all on function private.import_timestamp(jsonb, text) from public, anon;
revoke all on function private.import_track(uuid, text, uuid) from public, anon;
revoke all on function private.import_enqueue_photos(uuid, uuid, integer, jsonb) from public, anon;
revoke all on function private.import_owner_client(public.import_jobs, jsonb) from public, anon;
revoke all on function private.import_job_for_action(uuid, uuid) from public, anon;
revoke all on function private.import_photos_claim(uuid, uuid, integer) from public, anon;
revoke all on function private.import_photos_complete(uuid, uuid, uuid, text, text) from public, anon;
revoke all on function private.import_photos_status(uuid, uuid) from public, anon;
revoke all on function private.import_record_in_use(text, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function private.import_record_changed(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.import_undo_prepare(uuid, uuid, integer) from public, anon;
revoke all on function private.import_undo_apply(uuid, uuid) from public, anon;

grant execute on function private.import_timestamp(jsonb, text) to authenticated;
grant execute on function private.import_track(uuid, text, uuid) to authenticated;
grant execute on function private.import_enqueue_photos(uuid, uuid, integer, jsonb) to authenticated;
grant execute on function private.import_owner_client(public.import_jobs, jsonb) to authenticated;
grant execute on function private.import_job_for_action(uuid, uuid) to authenticated;
grant execute on function private.import_photos_claim(uuid, uuid, integer) to authenticated;
grant execute on function private.import_photos_complete(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function private.import_photos_status(uuid, uuid) to authenticated;
grant execute on function private.import_undo_prepare(uuid, uuid, integer) to authenticated;
grant execute on function private.import_undo_apply(uuid, uuid) to authenticated;

revoke all on function public.import_photos_claim(uuid, uuid, integer) from public, anon;
revoke all on function public.import_photos_complete(uuid, uuid, uuid, text, text) from public, anon;
revoke all on function public.import_photos_status(uuid, uuid) from public, anon;
revoke all on function public.import_undo_prepare(uuid, uuid, integer) from public, anon;
revoke all on function public.import_undo_apply(uuid, uuid) from public, anon;

grant execute on function public.import_photos_claim(uuid, uuid, integer) to authenticated;
grant execute on function public.import_photos_complete(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.import_photos_status(uuid, uuid) to authenticated;
grant execute on function public.import_undo_prepare(uuid, uuid, integer) to authenticated;
grant execute on function public.import_undo_apply(uuid, uuid) to authenticated;

comment on function public.import_start(
  uuid, uuid, public.import_kind, public.import_duplicate_mode, integer, jsonb
) is
  'Abre (ou reabre, com o mesmo id) uma importação de planilha. Dono, gerente e assistente; recusa com a assinatura em somente leitura ou importação desfeita.';
comment on function public.import_batch(uuid, uuid, integer, jsonb) is
  'Grava um lote (até 250 linhas) com a sessão e a RLS de quem importa. Idempotente por (importação, lote). Lead com datas da planilha; imóvel com proprietários e links de foto (fila). Resultado por linha só com número, situação e código do motivo.';
comment on function public.import_photos_claim(uuid, uuid, integer) is
  'Reserva até 10 links de foto da importação para o servidor baixar (prazo de 3 minutos). Recusa na hora, sem baixar, o que passaria do limite de fotos por imóvel ou de imóveis com foto do plano.';
comment on function public.import_photos_complete(uuid, uuid, uuid, text, text) is
  'Registra o resultado de um link de foto: grava em property_media (gatilhos de limite do plano valendo) ou marca a falha com um código estável.';
comment on function public.import_photos_status(uuid, uuid) is
  'Contagem dos links de foto da importação e as falhas por linha/posição (sem o link).';
comment on function public.import_undo_prepare(uuid, uuid, integer) is
  'Desfazer importação, passo 1: decide o próximo pedaço (sai ou fica, se alterado ou usado depois) e devolve os arquivos das fotos que vão sair. Até 7 dias; quem importou ou dono/gerente.';
comment on function public.import_undo_apply(uuid, uuid) is
  'Desfazer importação, passo 2: apaga o que foi decidido e, no fim, marca a importação como desfeita e registra em audit_events (action = import_undo) só as contagens.';
comment on function private.import_track(uuid, text, uuid) is
  'Guarda o id de um registro criado pela importação em andamento (só dentro de import_batch, para quem abriu a importação e registros que essa pessoa acabou de criar).';
comment on function private.import_owner_client(public.import_jobs, jsonb) is
  'Cliente proprietário da linha: existente por CPF/CNPJ, e-mail ou telefone, ou criado com a sessão de quem importa (base legal: contrato; etiqueta Proprietário).';
comment on function private.import_record_in_use(text, uuid, uuid, boolean) is
  'Verdadeiro se outra tabela referencia o registro (pelas chaves estrangeiras do catálogo), ignorando históricos automáticos do lead e, se pedido, fotos e vínculos criados pela própria importação.';
comment on function private.import_record_changed(uuid, text, uuid, timestamptz) is
  'Verdadeiro se o registro foi alterado (audit_events de UPDATE) depois da importação, sem contar o recálculo da nota do anúncio.';
comment on function private.import_find_client(uuid, text, text, text[]) is
  'Cliente existente por CPF/CNPJ, depois e-mail, depois telefone ou WhatsApp (últimos 11 dígitos). SECURITY DEFINER para usar os índices de expressão; só dono, gerente e assistente da imobiliária; devolve só o id.';
comment on function private.import_find_lead(uuid, text, text) is
  'Lead existente por telefone (últimos 11 dígitos) ou e-mail. SECURITY DEFINER para usar os índices; só dono, gerente e assistente da imobiliária; devolve só o id.';
comment on function private.import_find_property(uuid, jsonb) is
  'Imóvel existente pelo código de referência do sistema anterior ou, sem código, por tipo, finalidade, título e endereço (índice properties_organization_title_lower_idx). Só dono, gerente e assistente da imobiliária; devolve só o id.';
