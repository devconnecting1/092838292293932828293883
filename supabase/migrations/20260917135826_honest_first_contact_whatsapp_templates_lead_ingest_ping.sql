-- =============================================================================
-- SLA honesto, modelos de mensagem de WhatsApp e nova tentativa de leads
-- externos em minutos
-- =============================================================================
--  1. leads_before_write: mudar a etapa não grava mais contato. Só a importação
--     de planilha (que traz o histórico do lead) continua preenchendo.
--  2. lead_contact_events: cada contato registrado com canal (ligação,
--     WhatsApp, e-mail, presencial), inclusive a tentativa sem resposta.
--     "Conseguiu falar? Sim" grava o contato no lead (e o 1º contato, pelo
--     trigger acima); "Não" grava só a tentativa.
--  3. Landing page com ?origem=instagram ou ?origem=whatsapp: origem validada
--     no banco; o rodízio passa a reconhecer lead de landing page pela página
--     (landing_page_id), e não mais pela origem.
--  4. Importação de planilha aceita as origens instagram e whatsapp.
--  5. whatsapp_message_templates: modelos de mensagem por imobiliária.
--  6. Nova tentativa de leads de portais e anúncios (Meta Lead Ads) em minutos:
--     pg_cron + pg_net chamam /api/cron/lead-ingest quando há entrega vencida
--     (segredos lead_ingest_webhook_url e lead_ingest_webhook_secret no Vault).
--
-- Relatórios, exportação e rodízio continuam lendo leads.first_contact_at: só
-- mudou QUEM grava o contato.

-- -----------------------------------------------------------------------------
-- 1. leads_before_write: etapa não é contato
-- -----------------------------------------------------------------------------
-- Igual à versão atual (importação de planilha, datas da planilha e 1º contato
-- gravado uma vez), menos o preenchimento de last_contact_at quando o lead
-- saía de "Novo": arrastar o card para "Em contato" sem ter falado com o
-- cliente mantinha o lead "no prazo". Agora o contato vem só de
-- lead_contact_events (Registrar contato / WhatsApp com "Conseguiu falar? Sim").
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

  -- Só a planilha importada vira contato pela etapa: ela traz o histórico de
  -- um lead que já foi atendido fora do sistema. Mudar a etapa no app não é
  -- contato.
  if v_import
     and new.stage <> 'new'
     and new.last_contact_at is null then
    new.last_contact_at := new.created_at;
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

comment on column public.leads.last_contact_at is
  'Último contato com o cliente: "Registrar contato" ou WhatsApp com "Conseguiu falar? Sim" (lead_contact_events), ou a data da planilha importada. Mudar a etapa não grava contato. O primeiro fica em first_contact_at.';

-- -----------------------------------------------------------------------------
-- 2. Contatos e tentativas com canal
-- -----------------------------------------------------------------------------
create type public.lead_contact_channel as enum ('call', 'whatsapp', 'email', 'in_person');

comment on type public.lead_contact_channel is
  'Canal do contato com o lead: call (ligação), whatsapp, email e in_person (presencial).';

create table public.lead_contact_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid not null,
  channel public.lead_contact_channel not null,
  reached boolean not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint lead_contact_events_lead_fkey foreign key (organization_id, lead_id)
    references public.leads (organization_id, id) on delete cascade
);

comment on table public.lead_contact_events is
  'Contatos com o lead registrados pela equipe, com canal. reached = true é contato de verdade (grava leads.last_contact_at e, na primeira vez, first_contact_at); reached = false é tentativa sem resposta e não mexe no prazo. Só inserção: não se altera nem se apaga (sai junto com o lead).';
comment on column public.lead_contact_events.reached is
  'Resposta a "Conseguiu falar?": true grava o contato no lead; false é só a tentativa.';
comment on column public.lead_contact_events.created_at is
  'Instante do registro, sempre now() (o app não informa a data: o 1º contato não pode ser antecipado).';

create index lead_contact_events_lead_idx
  on public.lead_contact_events (organization_id, lead_id, created_at desc);
create index lead_contact_events_created_by_idx
  on public.lead_contact_events (created_by);

-- Antes de gravar: instante e autor do servidor; o lead precisa existir fora da
-- lixeira.
create or replace function private.lead_contact_events_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();

  if not exists (
    select 1
    from public.leads l
    where l.organization_id = new.organization_id
      and l.id = new.lead_id
      and l.deleted_at is null
  ) then
    raise exception 'Lead não encontrado. Ele pode ter sido removido.' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Depois de gravar "Conseguiu falar? Sim": contato no lead, com os privilégios
-- de quem registrou (RLS de leads vale: sem permissão de edição, nada é gravado).
-- Lead em "Novo" passa para "Em contato".
create or replace function private.lead_contact_events_apply()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.reached then
    return null;
  end if;

  update public.leads l
  set last_contact_at = new.created_at,
      stage = case when l.stage = 'new' then 'contacted'::public.lead_stage else l.stage end
  where l.organization_id = new.organization_id
    and l.id = new.lead_id;

  if not found then
    raise exception 'Você não tem permissão para registrar contato neste lead.' using errcode = '42501';
  end if;

  return null;
end;
$$;

revoke all on function private.lead_contact_events_before_insert() from public, anon, authenticated;
revoke all on function private.lead_contact_events_apply() from public, anon, authenticated;

create trigger a0_billing_writable before insert or update on public.lead_contact_events
  for each row execute function private.assert_billing_writable();
create trigger lead_contact_events_enforce_author
  before insert or update of created_by on public.lead_contact_events
  for each row execute function private.enforce_author_column('created_by');
create trigger lead_contact_events_before_insert before insert on public.lead_contact_events
  for each row execute function private.lead_contact_events_before_insert();
create trigger lead_contact_events_apply after insert on public.lead_contact_events
  for each row execute function private.lead_contact_events_apply();

alter table public.lead_contact_events enable row level security;

create policy "lead_contact_events: acesso conforme o lead" on public.lead_contact_events
  for select to authenticated
  using ((select private.can_access_lead(lead_id)));

create policy "lead_contact_events: equipe comercial registra" on public.lead_contact_events
  for insert to authenticated
  with check (
    private.has_role(organization_id, '{owner,manager,assistant,broker}'::public.app_role[])
    and created_by = (select auth.uid())
    and exists (
      select 1
      from public.leads l
      where l.organization_id = lead_contact_events.organization_id
        and l.id = lead_contact_events.lead_id
        and private.can_access_lead_row(l.organization_id, l.assigned_to, true)
    )
  );

revoke all on table public.lead_contact_events from anon, authenticated;
grant select on table public.lead_contact_events to authenticated;
-- Sem created_at nem created_by: o banco preenche os dois.
grant insert (organization_id, lead_id, channel, reached)
  on table public.lead_contact_events to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Landing page com origem (Instagram, WhatsApp) e rodízio pela página
-- -----------------------------------------------------------------------------
-- submit_landing_lead: a mesma função atual, trocando só a origem fixa
-- 'landing_page' pela origem validada do payload (lista fechada; qualquer outro
-- valor continua 'landing_page'). Recriada a partir da definição do banco.
do $migration$
declare
  v_def text := pg_get_functiondef(
    'public.submit_landing_lead(text, text, jsonb, text, text, text)'::regprocedure
  );
  v_old constant text :=
    'v_org, v_name, v_email, v_phone, v_message, v_interest, ''landing_page'', v_page_id,';
  v_new constant text :=
    'v_org, v_name, v_email, v_phone, v_message, v_interest,' || chr(10)
    || '    -- Origem do link (?origem=): só instagram e whatsapp; o resto é landing page.' || chr(10)
    || '    case lower(btrim(coalesce(p_payload ->> ''origin'', '''')))' || chr(10)
    || '      when ''instagram'' then ''instagram''::public.lead_source' || chr(10)
    || '      when ''whatsapp'' then ''whatsapp''::public.lead_source' || chr(10)
    || '      else ''landing_page''::public.lead_source' || chr(10)
    || '    end,' || chr(10)
    || '    v_page_id,';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'submit_landing_lead mudou: origem fixa não encontrada.';
  end if;

  execute replace(v_def, v_old, v_new);
end;
$migration$;

-- import_lead_row: a lista fechada de origens da planilha ganha instagram e
-- whatsapp (a função atual, com lixeira e datas da planilha, fica igual).
do $migration$
declare
  v_def text := pg_get_functiondef('private.import_lead_row(public.import_jobs, jsonb)'::regprocedure);
  v_old constant text := 'not in (''portal'', ''website'', ''social'', ''referral'', ''manual'', ''other'')';
  v_new constant text :=
    'not in (''portal'', ''website'', ''social'', ''instagram'', ''whatsapp'', ''referral'', ''manual'', ''other'')';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'import_lead_row mudou: lista de origens não encontrada.';
  end if;

  execute replace(v_def, v_old, v_new);
end;
$migration$;

-- Rodízio: lead de landing page é o que tem página (landing_page_id), qualquer
-- que seja a origem do link. Igual à versão atual nos demais pontos.
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
    case when new.landing_page_id is not null then 'landing_page' else 'created' end,
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

  if new.landing_page_id is null and new.assigned_to is not null then
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
  if new.landing_page_id is not null
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

revoke all on function private.leads_apply_roulette() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Modelos de mensagem de WhatsApp
-- -----------------------------------------------------------------------------
create table public.whatsapp_message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  body text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_message_templates_title_check
    check (char_length(title) between 2 and 60 and title = btrim(title)),
  constraint whatsapp_message_templates_body_check
    check (char_length(body) between 2 and 1000 and body = btrim(body))
);

comment on table public.whatsapp_message_templates is
  'Modelos de mensagem de WhatsApp da imobiliária (título e texto com {nome}, {imovel}, {corretor} e {link}). Dono e gerente criam e editam; toda a equipe usa no botão de WhatsApp do lead e do imóvel, que abre wa.me com o texto (sem API da Meta). Até 30 por imobiliária.';
comment on column public.whatsapp_message_templates.body is
  'Texto do modelo (até 1.000 caracteres). Variáveis trocadas na tela: {nome} (primeiro nome do lead), {imovel} (título e código), {corretor} (quem envia) e {link} (página pública do imóvel).';

create unique index whatsapp_message_templates_title_key
  on public.whatsapp_message_templates (organization_id, lower(title));
create index whatsapp_message_templates_created_by_idx
  on public.whatsapp_message_templates (created_by);

create or replace function private.whatsapp_message_templates_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title := regexp_replace(btrim(coalesce(new.title, '')), '\s+', ' ', 'g');
  -- Quebras de linha no meio ficam; espaços e linhas vazias nas pontas saem.
  new.body := regexp_replace(coalesce(new.body, ''), '^\s+|\s+$', '', 'g');

  if char_length(new.title) not between 2 and 60 then
    raise exception 'Informe o título do modelo (2 a 60 caracteres).' using errcode = '23514';
  end if;

  if char_length(new.body) not between 2 and 1000 then
    raise exception 'Informe o texto do modelo (2 a 1.000 caracteres).' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    -- Serializa as inclusões da imobiliária para o limite valer com cliques simultâneos.
    perform pg_advisory_xact_lock(
      hashtextextended('whatsapp_message_templates:' || new.organization_id::text, 0)
    );

    if (
      select count(*)
      from public.whatsapp_message_templates t
      where t.organization_id = new.organization_id
    ) >= 30 then
      raise exception 'Limite de 30 modelos de mensagem. Apague um modelo antigo para criar outro.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.whatsapp_message_templates_before_write() from public, anon, authenticated;

create trigger a0_billing_writable before insert or update on public.whatsapp_message_templates
  for each row execute function private.assert_billing_writable();
create trigger whatsapp_message_templates_before_write
  before insert or update on public.whatsapp_message_templates
  for each row execute function private.whatsapp_message_templates_before_write();
create trigger whatsapp_message_templates_set_updated_at
  before update on public.whatsapp_message_templates
  for each row execute function private.set_updated_at();
create trigger whatsapp_message_templates_enforce_author
  before insert or update of created_by on public.whatsapp_message_templates
  for each row execute function private.enforce_author_column('created_by');
create trigger whatsapp_message_templates_lock_organization_id
  before update on public.whatsapp_message_templates
  for each row execute function private.lock_organization_id();
create trigger whatsapp_message_templates_audit
  after insert or update or delete on public.whatsapp_message_templates
  for each row execute function private.audit_row_change();

alter table public.whatsapp_message_templates enable row level security;

create policy "whatsapp_message_templates: equipe lê" on public.whatsapp_message_templates
  for select to authenticated
  using (private.is_member(organization_id));
create policy "whatsapp_message_templates: dono e gerente criam" on public.whatsapp_message_templates
  for insert to authenticated
  with check (private.has_role(organization_id, '{owner,manager}'::public.app_role[]));
create policy "whatsapp_message_templates: dono e gerente alteram" on public.whatsapp_message_templates
  for update to authenticated
  using (private.has_role(organization_id, '{owner,manager}'::public.app_role[]))
  with check (private.has_role(organization_id, '{owner,manager}'::public.app_role[]));
create policy "whatsapp_message_templates: dono e gerente removem" on public.whatsapp_message_templates
  for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'::public.app_role[]));

revoke all on table public.whatsapp_message_templates from anon;
revoke truncate, trigger, references on table public.whatsapp_message_templates from authenticated;
grant select, insert, update, delete on table public.whatsapp_message_templates to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Nova tentativa de leads externos em minutos (pg_cron + pg_net)
-- -----------------------------------------------------------------------------
-- A Vercel Hobby só agenda rotinas diárias (apps/web/vercel.json: lead-ingest
-- 1x/dia, que continua como rede de segurança). O banco chama a mesma rota
-- quando há entrega vencida: pendente há mais de 2 min (o webhook da Meta não
-- terminou a busca) ou falha com a próxima tentativa já vencida (5, 10, 15, 20 e
-- 25 min). Sem os segredos no Vault, nada é chamado.
create or replace function private.ping_lead_ingest_webhook()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1
    from public.lead_integration_deliveries del
    join public.lead_integrations li
      on li.organization_id = del.organization_id
     and li.provider = del.provider
     and li.status = 'connected'
    where del.status in ('pending', 'failed')
      and coalesce(del.next_attempt_at, del.received_at + interval '2 minutes') <= now()
  ) then
    return false;
  end if;

  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'lead_ingest_webhook_url'
  limit 1;

  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'lead_ingest_webhook_secret'
  limit 1;

  if v_url is null or v_secret is null or v_url !~* '^https://' then
    return false;
  end if;

  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    timeout_milliseconds := 5000
  );

  return true;
exception
  when others then
    -- Webhook é conveniência: falha nunca derruba a rotina.
    return false;
end;
$$;

revoke all on function private.ping_lead_ingest_webhook() from public, anon, authenticated;

comment on function private.ping_lead_ingest_webhook() is
  'Chamado pelo pg_cron a cada 5 min: se há entrega de lead externo vencida (pendente há 2 min ou falha com nova tentativa vencida) e os segredos lead_ingest_webhook_url e lead_ingest_webhook_secret existem no Vault, faz POST na rota /api/cron/lead-ingest com Bearer CRON_SECRET. Devolve se chamou.';

select cron.schedule(
  'nova-tentativa-leads-externos',
  '*/5 * * * *',
  $cron$ select private.ping_lead_ingest_webhook(); $cron$
);
