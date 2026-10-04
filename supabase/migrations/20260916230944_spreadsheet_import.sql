-- =============================================================================
-- Importação de planilhas: clientes, leads e imóveis sem digitar
-- =============================================================================
-- O navegador lê o .csv/.xlsx, sugere o mapeamento das colunas, normaliza e
-- valida cada linha. O banco grava em lotes, sempre com a sessão de quem
-- importa (RLS de clients, leads e properties valendo), e devolve o que
-- aconteceu com cada linha: importada, atualizada, ignorada ou com erro.
--
-- Garantias:
--   · Só dono e gerente importam.
--   · Idempotência por lote: (job_id, batch_index) é gravado junto com as
--     linhas, na mesma transação. Reenviar o mesmo lote devolve o resultado
--     guardado e não grava nada de novo.
--   · Duplicados contra a base: cliente por CPF/CNPJ, e-mail ou telefone
--     (telefone ou WhatsApp, só dígitos com DDD); lead por telefone ou e-mail;
--     imóvel pelo código de referência do sistema anterior ou, sem código, por
--     tipo + finalidade + título + endereço. Padrão: ignorar; opcional: atualizar.
--   · Nada de dado pessoal fora das tabelas de destino: o registro do lote
--     guarda só número da linha, situação e código do motivo; a auditoria
--     guarda só contagens.
--   · Lead importado não entra no rodízio nem abre prazo de primeiro contato
--     (a base antiga não é lead novo chegando agora).
--   · Imóvel importado não tem foto no nosso bucket, então não consome o limite
--     de imóveis próprios (private.enforce_billing_owned_listings).

-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------
create type public.import_kind as enum ('clients', 'leads', 'properties');
create type public.import_duplicate_mode as enum ('skip', 'update');

comment on type public.import_kind is
  'O que a planilha importa: clientes/contatos, leads ou imóveis.';
comment on type public.import_duplicate_mode is
  'O que fazer com a linha que já existe na base: ignorar (padrão) ou atualizar o registro existente.';

-- -----------------------------------------------------------------------------
-- 2. Código de referência do imóvel no sistema anterior
-- -----------------------------------------------------------------------------
-- properties.code é gerado pelo banco (IMV-000123) e não muda. O código que a
-- imobiliária usava antes fica aqui, para busca e para reimportar sem duplicar.
alter table public.properties
  add column if not exists external_code text;

alter table public.properties
  drop constraint if exists properties_external_code_format;

alter table public.properties
  add constraint properties_external_code_format check (
    external_code is null
    or (
      char_length(external_code) between 1 and 60
      and external_code = btrim(external_code)
      and external_code !~ '[[:cntrl:]]'
    )
  );

create unique index if not exists properties_organization_external_code_key
  on public.properties (organization_id, external_code)
  where external_code is not null;

comment on column public.properties.external_code is
  'Código de referência do imóvel no sistema anterior (importação de planilha). Único por imobiliária; o código IMV continua sendo gerado pelo banco.';

-- -----------------------------------------------------------------------------
-- 3. Registro das importações e dos lotes
-- -----------------------------------------------------------------------------
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind public.import_kind not null,
  duplicate_mode public.import_duplicate_mode not null default 'skip',
  options jsonb not null default '{}'::jsonb,
  total_rows integer not null,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint import_jobs_total_rows_range check (total_rows between 1 and 5000),
  constraint import_jobs_counts_non_negative check (
    inserted_count >= 0 and updated_count >= 0 and skipped_count >= 0 and failed_count >= 0
  ),
  constraint import_jobs_counts_within_total check (
    inserted_count + updated_count + skipped_count + failed_count <= total_rows
  ),
  constraint import_jobs_options_object check (jsonb_typeof(options) = 'object'),
  constraint import_jobs_organization_id_id_key unique (organization_id, id)
);

create index import_jobs_organization_created_idx
  on public.import_jobs (organization_id, created_at desc);
create index import_jobs_created_by_idx on public.import_jobs (created_by);

create trigger import_jobs_set_updated_at
  before update on public.import_jobs
  for each row execute function private.set_updated_at();
create trigger import_jobs_lock_organization_id
  before update on public.import_jobs
  for each row execute function private.lock_organization_id();

comment on table public.import_jobs is
  'Uma importação de planilha (clientes, leads ou imóveis): quem fez, quando, modo de duplicados e contagens. Sem nenhum dado das linhas.';
comment on column public.import_jobs.id is
  'Gerado pelo navegador no início da importação: repetir o início com o mesmo id não cria outra.';
comment on column public.import_jobs.options is
  'Opções do tipo. Clientes: legal_basis (legitimate_interest | contract) e tag (etiqueta aplicada aos novos).';
comment on column public.import_jobs.total_rows is
  'Linhas de dados do arquivo (sem o cabeçalho), incluindo as recusadas na validação.';

create table public.import_job_batches (
  organization_id uuid not null,
  job_id uuid not null,
  batch_index integer not null,
  row_count integer not null,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint import_job_batches_pkey primary key (job_id, batch_index),
  constraint import_job_batches_job_fkey foreign key (organization_id, job_id)
    references public.import_jobs (organization_id, id) on delete cascade,
  constraint import_job_batches_index_range check (batch_index between 0 and 4999),
  constraint import_job_batches_row_count_range check (row_count between 1 and 250),
  constraint import_job_batches_counts_match check (
    inserted_count >= 0 and updated_count >= 0 and skipped_count >= 0 and failed_count >= 0
    and inserted_count + updated_count + skipped_count + failed_count = row_count
  ),
  constraint import_job_batches_results_format check (
    jsonb_typeof(results) = 'array' and jsonb_array_length(results) = row_count
  )
);

create index import_job_batches_organization_job_idx
  on public.import_job_batches (organization_id, job_id);

comment on table public.import_job_batches is
  'Lote gravado de uma importação. A chave (job_id, batch_index) torna o reenvio idempotente: o lote repetido devolve este resultado sem gravar de novo.';
comment on column public.import_job_batches.results is
  'Uma entrada por linha: {row, status, code}. Só número da linha na planilha, situação (inserted, updated, skipped, failed) e código do motivo; nunca o conteúdo.';

alter table public.import_jobs enable row level security;
alter table public.import_job_batches enable row level security;

drop policy if exists "import_jobs: dono e gerente leem" on public.import_jobs;
create policy "import_jobs: dono e gerente leem"
  on public.import_jobs for select to authenticated
  using ((select private.has_role(organization_id, '{owner,manager}')));

drop policy if exists "import_job_batches: dono e gerente leem" on public.import_job_batches;
create policy "import_job_batches: dono e gerente leem"
  on public.import_job_batches for select to authenticated
  using ((select private.has_role(organization_id, '{owner,manager}')));

-- Escrita só pelas funções abaixo (sem policy de INSERT/UPDATE/DELETE).
revoke all on public.import_jobs from anon;
revoke insert, update, delete, truncate, trigger, references on public.import_jobs from authenticated;
grant select on public.import_jobs to authenticated;

revoke all on public.import_job_batches from anon;
revoke insert, update, delete, truncate, trigger, references
  on public.import_job_batches from authenticated;
grant select on public.import_job_batches to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Lead importado não entra no rodízio nem abre prazo de primeiro contato
-- -----------------------------------------------------------------------------
-- public.import_batch liga `app.import_job` só durante a gravação do lote
-- (set_config local à transação). Fora dela as duas funções seguem iguais.
create or replace function private.leads_apply_roulette()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.lead_routing_settings;
  v_now timestamptz := now();
  v_picked uuid;
begin
  -- Motivo padrão deste INSERT (o trigger AFTER consome).
  perform set_config(
    'app.lead_insert_reason',
    case when new.source = 'landing_page' then 'landing_page' else 'created' end,
    true
  );

  -- Importação de planilha: a base antiga fica com o responsável da planilha
  -- (ou sem responsável) e não passa pela roleta.
  if coalesce(current_setting('app.import_job', true), '') <> '' then
    new.routing_due_at := null;
    return new;
  end if;

  if new.stage <> 'new' then
    return new;
  end if;

  if new.source is distinct from 'landing_page' and new.assigned_to is not null then
    return new;
  end if;

  v_config := private.lead_routing_config(new.organization_id);

  if not v_config.roulette_enabled then
    return new;
  end if;

  v_picked := private.lead_routing_pick(new.organization_id, v_now, '{}'::uuid[]);

  if v_picked is not null then
    new.assigned_to := v_picked;
    new.routing_due_at := null;
    perform set_config('app.lead_insert_reason', 'roulette', true);
    return new;
  end if;

  -- Ninguém de plantão agora: cai no responsável fixo da página, quando houver.
  if new.source is not distinct from 'landing_page'
     and v_config.fallback_to_page_assignee
     and new.assigned_to is not null then
    new.routing_due_at := null;
    return new;
  end if;

  new.assigned_to := null;

  if private.lead_routing_has_queue(new.organization_id, v_now, '{}'::uuid[]) then
    new.routing_due_at := coalesce(
      private.lead_routing_next_window(new.organization_id, v_now, '{}'::uuid[]),
      v_now + interval '15 minutes'
    );
  else
    new.routing_due_at := null;
  end if;

  return new;
end;
$$;

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

  -- Quando o responsável muda, o relógio do primeiro contato recomeça.
  if tg_op = 'INSERT' then
    new.assigned_at := case when new.assigned_to is not null then now() end;
  elsif new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is not null then now() end;
    new.sla_warned_at := null;
  end if;

  -- Prazo de primeiro contato: só com responsável, em "Novo" e sem contato.
  -- Lead que entra por importação de planilha não abre prazo.
  if new.assigned_to is null
     or new.stage <> 'new'
     or new.last_contact_at is not null
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

-- -----------------------------------------------------------------------------
-- 5. Utilitários das linhas
-- -----------------------------------------------------------------------------
-- Texto aparado; vazio vira null.
create or replace function private.import_text(p_row jsonb, p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(coalesce(p_row ->> p_key, '')), '');
$$;

-- Número da linha na planilha (a primeira linha de dados é a 2).
create or replace function private.import_line(p_row jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_row ->> 'row', '') ~ '^[0-9]{1,6}$' then (p_row ->> 'row')::integer
    else 0
  end;
$$;

create or replace function private.import_outcome(p_line integer, p_status text, p_code text default null)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object('row', p_line, 'status', p_status, 'code', p_code));
$$;

-- Erro do Postgres para um código estável que a tela traduz. Nunca devolve a
-- mensagem original (pode citar valores da linha).
create or replace function private.import_error_code(p_state text, p_message text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_state = 'P0001' and p_message = 'assinatura_somente_leitura' then 'billing_read_only'
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

-- Imóvel com o mínimo para sair de rascunho (os CHECKs properties_price_required
-- e properties_area_required).
create or replace function private.import_property_complete(
  p_purpose public.listing_purpose,
  p_type public.property_type,
  p_sale_price numeric,
  p_rent_price numeric,
  p_living_area numeric,
  p_lot_area numeric
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    case p_purpose
      when 'sale' then p_sale_price is not null
      when 'rent' then p_rent_price is not null
      else p_sale_price is not null and p_rent_price is not null
    end
    and case
      when p_type in ('land', 'farm', 'ranch', 'warehouse') then p_lot_area is not null
      else p_living_area is not null
    end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Busca do registro existente (com RLS de quem importa)
-- -----------------------------------------------------------------------------
-- As expressões batem com os índices clients_organization_*_idx e
-- leads_organization_*_idx.
create or replace function private.import_find_client(
  p_organization_id uuid,
  p_document text,
  p_email text,
  p_phone_keys text[]
)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id uuid;
begin
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
set search_path = ''
as $$
declare
  v_id uuid;
begin
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

-- Com código de referência: só o código decide. Sem código: mesmo tipo,
-- finalidade, título e endereço (sem diferenciar maiúsculas).
create or replace function private.import_find_property(p_organization_id uuid, p_row jsonb)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id uuid;
  v_code constant text := private.import_text(p_row, 'external_code');
begin
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
    and p.type::text = private.import_text(p_row, 'type')
    and p.purpose::text = private.import_text(p_row, 'purpose')
    and lower(p.title) = lower(coalesce(private.import_text(p_row, 'title'), ''))
    and lower(coalesce(p.street, '')) = lower(coalesce(private.import_text(p_row, 'street'), ''))
    and lower(coalesce(p.street_number, '')) = lower(coalesce(private.import_text(p_row, 'street_number'), ''))
    and lower(coalesce(p.complement, '')) = lower(coalesce(private.import_text(p_row, 'complement'), ''))
    and lower(coalesce(p.neighborhood, '')) = lower(coalesce(private.import_text(p_row, 'neighborhood'), ''))
    and lower(coalesce(p.city, '')) = lower(coalesce(private.import_text(p_row, 'city'), ''))
  order by p.created_at
  limit 1;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Gravação de uma linha (com RLS de quem importa)
-- -----------------------------------------------------------------------------
-- Cada linha roda num bloco próprio: um erro inesperado marca só aquela linha.
-- A tela já validou tudo antes; aqui as regras essenciais são conferidas de
-- novo, porque a função é chamável direto pela API.
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
      );

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
begin
  begin
    v_name := private.import_text(p_row, 'name');
    v_email := lower(private.import_text(p_row, 'email'));
    v_phone := private.import_text(p_row, 'phone');
    v_interest := private.import_text(p_row, 'interest');
    v_stage_given := private.import_text(p_row, 'stage') is not null;
    v_stage := coalesce(private.import_text(p_row, 'stage'), 'new')::public.lead_stage;
    v_lost_reason := private.import_text(p_row, 'lost_reason');

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

    if v_stage = 'lost' and v_lost_reason is null then
      v_lost_reason := 'Não informado na importação';
    end if;

    v_existing := private.import_find_lead(p_job.organization_id, v_email, v_phone);

    if v_existing is not null and p_job.duplicate_mode = 'skip' then
      return private.import_outcome(v_line, 'skipped', 'duplicate_in_base');
    end if;

    if v_existing is null then
      insert into public.leads (
        organization_id, name, email, phone, interest, source, stage, lost_reason, message,
        typology, assigned_to
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
        private.import_text(p_row, 'assigned_to')::uuid
      );

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
      );

      return private.import_outcome(v_line, 'inserted', v_code);
    end if;

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

    return private.import_outcome(v_line, 'updated', v_code);
  exception
    when others then
      return private.import_outcome(v_line, 'failed', private.import_error_code(sqlstate, sqlerrm));
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Registro (definer: as tabelas de registro não aceitam escrita direta)
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

  if p_organization_id is null or not private.has_role(p_organization_id, '{owner,manager}') then
    raise exception 'Só dono e gerente importam planilhas.' using errcode = '42501';
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
     or not private.has_role(v_job.organization_id, '{owner,manager}') then
    raise exception 'Importação não encontrada.' using errcode = '42501';
  end if;

  if v_job.finished_at is not null then
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
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null or not private.has_role(p_organization_id, '{owner,manager}') then
    raise exception 'Só dono e gerente importam planilhas.' using errcode = '42501';
  end if;

  select * into v_job
  from public.import_jobs j
  where j.id = p_job_id
    and j.organization_id = p_organization_id
  for update;

  if not found or v_job.created_by is distinct from v_user then
    raise exception 'Importação não encontrada.' using errcode = '42501';
  end if;

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
        'batches', v_batches
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
    'finished_at', v_job.finished_at
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. RPCs (SECURITY INVOKER: a sessão e a RLS de quem importa valem em tudo)
-- -----------------------------------------------------------------------------
create or replace function public.import_start(
  p_organization_id uuid,
  p_job_id uuid,
  p_kind public.import_kind,
  p_duplicate_mode public.import_duplicate_mode,
  p_total_rows integer,
  p_options jsonb default '{}'::jsonb
)
returns uuid
language sql
set search_path = ''
as $$
  select private.import_start_job(
    p_organization_id, p_job_id, p_kind, p_duplicate_mode, p_total_rows, p_options
  );
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

  if p_organization_id is null or not private.has_role(p_organization_id, '{owner,manager}') then
    raise exception 'Só dono e gerente importam planilhas.' using errcode = '42501';
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

  if p_organization_id is null or not private.has_role(p_organization_id, '{owner,manager}') then
    raise exception 'Só dono e gerente importam planilhas.' using errcode = '42501';
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

create or replace function public.import_finish(
  p_organization_id uuid,
  p_job_id uuid,
  p_invalid_rows integer default 0,
  p_file_duplicates integer default 0
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.import_finish_job(p_organization_id, p_job_id, p_invalid_rows, p_file_duplicates);
$$;

-- -----------------------------------------------------------------------------
-- 10. Permissões de execução
-- -----------------------------------------------------------------------------
revoke all on function private.import_text(jsonb, text) from public, anon;
revoke all on function private.import_line(jsonb) from public, anon;
revoke all on function private.import_outcome(integer, text, text) from public, anon;
revoke all on function private.import_error_code(text, text) from public, anon;
revoke all on function private.import_property_complete(
  public.listing_purpose, public.property_type, numeric, numeric, numeric, numeric
) from public, anon;
revoke all on function private.import_find_client(uuid, text, text, text[]) from public, anon;
revoke all on function private.import_find_lead(uuid, text, text) from public, anon;
revoke all on function private.import_find_property(uuid, jsonb) from public, anon;
revoke all on function private.import_client_row(public.import_jobs, jsonb) from public, anon;
revoke all on function private.import_lead_row(public.import_jobs, jsonb) from public, anon;
revoke all on function private.import_property_row(public.import_jobs, jsonb) from public, anon;
revoke all on function private.import_start_job(
  uuid, uuid, public.import_kind, public.import_duplicate_mode, integer, jsonb
) from public, anon;
revoke all on function private.import_save_batch(uuid, integer, jsonb) from public, anon;
revoke all on function private.import_finish_job(uuid, uuid, integer, integer) from public, anon;

-- O schema private não é exposto na API: estas concessões só permitem que as
-- RPCs abaixo (que rodam como a sessão) chamem os utilitários.
grant execute on function private.import_text(jsonb, text) to authenticated;
grant execute on function private.import_line(jsonb) to authenticated;
grant execute on function private.import_outcome(integer, text, text) to authenticated;
grant execute on function private.import_error_code(text, text) to authenticated;
grant execute on function private.import_property_complete(
  public.listing_purpose, public.property_type, numeric, numeric, numeric, numeric
) to authenticated;
grant execute on function private.import_find_client(uuid, text, text, text[]) to authenticated;
grant execute on function private.import_find_lead(uuid, text, text) to authenticated;
grant execute on function private.import_find_property(uuid, jsonb) to authenticated;
grant execute on function private.import_client_row(public.import_jobs, jsonb) to authenticated;
grant execute on function private.import_lead_row(public.import_jobs, jsonb) to authenticated;
grant execute on function private.import_property_row(public.import_jobs, jsonb) to authenticated;
grant execute on function private.import_start_job(
  uuid, uuid, public.import_kind, public.import_duplicate_mode, integer, jsonb
) to authenticated;
grant execute on function private.import_save_batch(uuid, integer, jsonb) to authenticated;
grant execute on function private.import_finish_job(uuid, uuid, integer, integer) to authenticated;

revoke all on function public.import_start(
  uuid, uuid, public.import_kind, public.import_duplicate_mode, integer, jsonb
) from public, anon;
revoke all on function public.import_find_existing(uuid, public.import_kind, jsonb) from public, anon;
revoke all on function public.import_batch(uuid, uuid, integer, jsonb) from public, anon;
revoke all on function public.import_finish(uuid, uuid, integer, integer) from public, anon;

grant execute on function public.import_start(
  uuid, uuid, public.import_kind, public.import_duplicate_mode, integer, jsonb
) to authenticated;
grant execute on function public.import_find_existing(uuid, public.import_kind, jsonb) to authenticated;
grant execute on function public.import_batch(uuid, uuid, integer, jsonb) to authenticated;
grant execute on function public.import_finish(uuid, uuid, integer, integer) to authenticated;

comment on function public.import_start(
  uuid, uuid, public.import_kind, public.import_duplicate_mode, integer, jsonb
) is
  'Abre (ou reabre, com o mesmo id) uma importação de planilha. Só dono e gerente; recusa com a assinatura em somente leitura.';
comment on function public.import_find_existing(uuid, public.import_kind, jsonb) is
  'Prévia antes de gravar: devolve os números das linhas que já existem na base (cliente por CPF/CNPJ, e-mail ou telefone; lead por telefone ou e-mail; imóvel por código de referência ou endereço). Até 1.000 linhas por chamada.';
comment on function public.import_batch(uuid, uuid, integer, jsonb) is
  'Grava um lote (até 250 linhas) com a sessão e a RLS de quem importa. Idempotente por (importação, lote): o reenvio devolve o resultado guardado. Resultado por linha só com número, situação e código do motivo.';
comment on function public.import_finish(uuid, uuid, integer, integer) is
  'Fecha a importação, soma as linhas recusadas na validação e os duplicados do próprio arquivo e registra a importação em audit_events (só contagens). Idempotente.';
comment on function private.import_find_client(uuid, text, text, text[]) is
  'Cliente existente por CPF/CNPJ, depois e-mail, depois telefone ou WhatsApp (últimos 11 dígitos). Roda com a RLS da sessão.';
comment on function private.import_find_lead(uuid, text, text) is
  'Lead existente por telefone (últimos 11 dígitos) ou e-mail. Roda com a RLS da sessão.';
comment on function private.import_find_property(uuid, jsonb) is
  'Imóvel existente pelo código de referência do sistema anterior ou, sem código, por tipo, finalidade, título e endereço.';
comment on function private.import_save_batch(uuid, integer, jsonb) is
  'Guarda o resultado de um lote e soma as contagens na importação (uma vez só por lote).';
comment on function private.import_finish_job(uuid, uuid, integer, integer) is
  'Fecha a importação e grava o evento de auditoria (action = import, entity = import_jobs) só com contagens.';
