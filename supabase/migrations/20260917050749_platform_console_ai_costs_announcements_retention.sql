-- =============================================================================
-- Console da Plataforma: custos de IA, comunicados e retenção do registro
-- =============================================================================
-- Mesmo contrato do console (migração platform_console_health_and_audit): o
-- servidor Next confere o e-mail confirmado da equipe e chama as RPCs sem
-- sessão, com a chave publishable + PLATFORM_SERVER_KEY. Nunca service_role.
-- Toda RPC que altera algo grava o registro do console na mesma transação
-- (private.record_platform_audit_event).
--
--  1. public.platform_ai_costs: custo real de IA por imobiliária no ciclo atual
--     e no anterior (public.ai_usage_periods), teto do plano, preço do modelo e
--     câmbio em uso. Só números: nenhum conteúdo de conversa.
--  2. Comunicados globais para o CRM das imobiliárias:
--     public.platform_announcements (leitura por RLS só do comunicado no ar e
--     do público certo; escrita só pelas RPCs), public.platform_announcement_
--     dismissals (dispensa por usuário) e as RPCs platform_list_announcements,
--     platform_save_announcement e platform_end_announcement.
--  3. public.platform_audit_event_filters: ações e imobiliárias presentes no
--     registro, para os filtros da tela /plataforma/registro.
--  4. Retenção (LGPD): o registro do console fica 2 anos. O job semanal
--     retencao-registro-console apaga o que passou disso e as dispensas de
--     comunicados que saíram do ar há mais de 30 dias.

-- -----------------------------------------------------------------------------
-- 1. Custos de IA
-- -----------------------------------------------------------------------------
-- Ciclo atual = o ciclo que a trava de IA usa agora (private.ai_quota_context);
-- ciclo anterior = a última linha de ai_usage_periods antes dele. O teto vem do
-- plano ATUAL da imobiliária (não há histórico de plano por ciclo). Só entram
-- imobiliárias com linha de consumo em um dos dois ciclos; as demais aparecem
-- só nas contagens.
create or replace function public.platform_ai_costs(p_server_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := now();
  v_pricing jsonb;
  v_caps jsonb;
  v_organizations jsonb;
  v_accounts integer;
  v_with_ai integer;
begin
  perform private.check_platform_server_key(p_server_key);

  select jsonb_build_object(
    'model', p.model,
    'usd_per_mtok_input', p.usd_per_mtok_input,
    'usd_per_mtok_output', p.usd_per_mtok_output,
    'usd_per_mtok_cache_read', p.usd_per_mtok_cache_read,
    'usd_per_mtok_cache_write', p.usd_per_mtok_cache_write,
    'exchange_rate', p.exchange_rate
  )
  into v_pricing
  from private.ai_pricing() p;

  select jsonb_object_agg(k.plan_key, private.ai_cost_cap_cents(k.plan_key))
  into v_caps
  from unnest(array['trial', 'corretor', 'imobiliaria', 'equipe', 'rede']) as k(plan_key);

  with ctx as (
    select
      b.organization_id,
      o.name,
      c.period_start,
      c.period_end,
      c.plan_key,
      c.billing_state,
      c.conversations_limit,
      c.plan_cap_millicents,
      c.effective_cap_millicents
    from public.billing_accounts b
    join public.organizations o on o.id = b.organization_id
    cross join lateral private.ai_quota_context(b.organization_id, v_now) c
  ),
  org_usage as (
    select
      ctx.*,
      (
        select jsonb_build_object(
          'period_start', p.period_start,
          'period_end', p.period_end,
          'conversations', p.conversations,
          'requests', p.requests,
          'input_tokens', p.input_tokens,
          'output_tokens', p.output_tokens,
          'cache_read_tokens', p.cache_read_tokens,
          'cache_write_tokens', p.cache_write_tokens,
          'cost_millicents', p.cost_millicents
        )
        from public.ai_usage_periods p
        where p.organization_id = ctx.organization_id
          and p.period_start = ctx.period_start
      ) as current_usage,
      (
        select jsonb_build_object(
          'period_start', p.period_start,
          'period_end', p.period_end,
          'conversations', p.conversations,
          'requests', p.requests,
          'input_tokens', p.input_tokens,
          'output_tokens', p.output_tokens,
          'cache_read_tokens', p.cache_read_tokens,
          'cache_write_tokens', p.cache_write_tokens,
          'cost_millicents', p.cost_millicents
        )
        from public.ai_usage_periods p
        where p.organization_id = ctx.organization_id
          and (ctx.period_start is null or p.period_start < ctx.period_start)
        order by p.period_start desc
        limit 1
      ) as previous_usage
    from ctx
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'organization_id', u.organization_id,
      'organization_name', u.name,
      'plan_key', u.plan_key,
      'billing_state', u.billing_state,
      'conversations_limit', u.conversations_limit,
      'plan_cap_cents', (u.plan_cap_millicents / 1000)::integer,
      'effective_cap_cents', (u.effective_cap_millicents / 1000)::integer,
      'current_period_start', u.period_start,
      'current_period_end', u.period_end,
      'current', u.current_usage,
      'previous', u.previous_usage
    ) order by coalesce((u.current_usage ->> 'cost_millicents')::bigint, 0) desc, u.name)
      filter (where u.current_usage is not null or u.previous_usage is not null), '[]'::jsonb),
    count(*)::integer,
    count(*) filter (where u.conversations_limit <> 0)::integer
  into v_organizations, v_accounts, v_with_ai
  from org_usage u;

  return jsonb_build_object(
    'generated_at', v_now,
    'pricing', v_pricing,
    'plan_caps_cents', v_caps,
    'organizations_total', v_accounts,
    'organizations_with_ai', v_with_ai,
    'organizations', v_organizations
  );
end;
$$;

comment on function public.platform_ai_costs(text) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir o e-mail da equipe: custo real de IA por imobiliária no ciclo atual (o da trava, private.ai_quota_context) e no anterior (última linha de ai_usage_periods antes dele), com tokens, conversas, requisições e cost_millicents exatamente como gravados, teto do plano atual, preço do modelo e câmbio de private.ai_pricing() e tetos por plano de private.ai_cost_cap_cents(). Só números, sem conteúdo de conversa.';

-- -----------------------------------------------------------------------------
-- 2. Comunicados
-- -----------------------------------------------------------------------------

-- Público "donos e gerentes": dono ou gerente ativo em alguma imobiliária. A
-- faixa do CRM filtra de novo pelo papel na imobiliária aberta.
create or replace function private.is_organization_leader()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = (select auth.uid())
      and m.active
      and m.role in ('owner', 'manager')
  );
$$;

comment on function private.is_organization_leader() is
  'Verdadeiro quando o usuário atual é dono ou gerente ativo em alguma imobiliária. Usada na RLS dos comunicados da plataforma (público donos_e_gerentes).';

revoke all on function private.is_organization_leader() from public, anon;
grant execute on function private.is_organization_leader() to authenticated;

create table public.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  kind text not null,
  audience text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  link_url text,
  link_label text,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_announcements_title_check
    check (
      char_length(title) between 3 and 80
      and title = btrim(title)
      and title !~ '[<>[:cntrl:]]'
    ),
  constraint platform_announcements_body_check
    check (
      char_length(body) between 3 and 500
      and body = btrim(body)
      and body !~ '[<>[:cntrl:]]'
    ),
  constraint platform_announcements_kind_check
    check (kind in ('informacao', 'atencao', 'manutencao')),
  constraint platform_announcements_audience_check
    check (audience in ('todos', 'donos_e_gerentes')),
  constraint platform_announcements_period_check
    check (ends_at > starts_at and ends_at <= starts_at + interval '90 days'),
  constraint platform_announcements_link_url_check
    check (
      link_url is null
      or (
        char_length(link_url) between 12 and 500
        and link_url ~ '^https://[^/[:space:][:cntrl:]@<>"''\\]+(/[^[:space:][:cntrl:]<>"''\\]*)?$'
      )
    ),
  constraint platform_announcements_link_label_check
    check (
      link_label is null
      or (
        link_url is not null
        and char_length(link_label) between 2 and 40
        and link_label = btrim(link_label)
        and link_label !~ '[<>[:cntrl:]]'
      )
    )
);

comment on table public.platform_announcements is
  'Comunicados globais da equipe da plataforma, mostrados numa faixa discreta no topo do CRM das imobiliárias. Texto puro (sem HTML), link só https, no ar de starts_at a ends_at (até 90 dias) ou até ended_at. Leitura por RLS: authenticated vê só o que está no ar e do público certo. Escrita só pelas RPCs platform_save_announcement e platform_end_announcement (chave do servidor), que gravam o registro do console.';
comment on column public.platform_announcements.kind is
  'informacao, atencao ou manutencao (ícone e tom da faixa).';
comment on column public.platform_announcements.audience is
  'todos (qualquer usuário logado) ou donos_e_gerentes (dono ou gerente ativo em alguma imobiliária).';
comment on column public.platform_announcements.ended_at is
  'Quando a equipe encerrou o comunicado antes do fim. Encerrado não volta ao ar nem pode ser editado.';

create index platform_announcements_live_idx
  on public.platform_announcements (ends_at)
  where ended_at is null;

create trigger platform_announcements_set_updated_at
  before update on public.platform_announcements
  for each row execute function private.set_updated_at();

alter table public.platform_announcements enable row level security;

revoke all on public.platform_announcements from public, anon, authenticated;
grant select on public.platform_announcements to authenticated;

create policy "platform_announcements: no ar para o público certo"
  on public.platform_announcements for select to authenticated
  using (
    ended_at is null
    and starts_at <= now()
    and ends_at > now()
    and (audience = 'todos' or (select private.is_organization_leader()))
  );

create table public.platform_announcement_dismissals (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  announcement_id uuid not null references public.platform_announcements (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  constraint platform_announcement_dismissals_pkey primary key (user_id, announcement_id)
);

comment on table public.platform_announcement_dismissals is
  'Comunicado da plataforma dispensado pelo usuário (some da faixa só para ele, em qualquer aparelho). O usuário lê e grava só as próprias linhas, e só de comunicado que ele vê. A rotina retencao-registro-console apaga as dispensas de comunicados fora do ar há mais de 30 dias.';

create index platform_announcement_dismissals_announcement_idx
  on public.platform_announcement_dismissals (announcement_id);

alter table public.platform_announcement_dismissals enable row level security;

revoke all on public.platform_announcement_dismissals from public, anon, authenticated;
grant select on public.platform_announcement_dismissals to authenticated;
grant insert (announcement_id) on public.platform_announcement_dismissals to authenticated;

create policy "platform_announcement_dismissals: usuário lê as próprias"
  on public.platform_announcement_dismissals for select to authenticated
  using (user_id = (select auth.uid()));

create policy "platform_announcement_dismissals: usuário dispensa o que vê"
  on public.platform_announcement_dismissals for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.platform_announcements a
      where a.id = announcement_id
    )
  );

-- Texto que vai para o antes/depois do registro: tira exatamente o que
-- private.platform_audit_has_personal_data recusa (e-mail, CPF formatado e
-- telefone com DDD), para um comunicado com o e-mail do suporte não travar.
create or replace function private.platform_audit_mask_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Depois de trocar os e-mails, a arroba que sobrar vira [arroba]: sem ela
  -- nenhum resto de texto volta a parecer e-mail.
  select regexp_replace(
    regexp_replace(
      replace(
        regexp_replace(p_text, '[^[:space:]@"]+@[^[:space:]@"]+\.[^[:space:]@"]+', '[e-mail]', 'g'),
        '@', '[arroba]'
      ),
      '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}', '[número]', 'g'
    ),
    '\([0-9]{2}\)[[:space:]]?[0-9]{4,5}-?[0-9]{4}', '[número]', 'g'
  );
$$;

comment on function private.platform_audit_mask_text(text) is
  'Troca e-mail por [e-mail] (e arroba solta por [arroba]) e CPF formatado ou telefone com DDD por [número]: os padrões recusados no antes/depois do registro do console.';

revoke all on function private.platform_audit_mask_text(text) from public, anon, authenticated;

create or replace function private.platform_announcement_audit_data(p public.platform_announcements)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'titulo', private.platform_audit_mask_text(p.title),
    'texto', private.platform_audit_mask_text(p.body),
    'tipo', p.kind,
    'publico', p.audience,
    'inicio', p.starts_at,
    'fim', p.ends_at,
    'link', private.platform_audit_mask_text(p.link_url),
    'texto_do_link', private.platform_audit_mask_text(p.link_label),
    'encerrado_em', p.ended_at
  );
$$;

comment on function private.platform_announcement_audit_data(public.platform_announcements) is
  'Antes/depois de um comunicado para o registro do console (textos mascarados por private.platform_audit_mask_text).';

revoke all on function private.platform_announcement_audit_data(public.platform_announcements)
  from public, anon, authenticated;

create or replace function public.platform_list_announcements(
  p_server_key text,
  p_limit integer default 100
)
returns table (
  id uuid,
  title text,
  body text,
  kind text,
  audience text,
  starts_at timestamptz,
  ends_at timestamptz,
  link_url text,
  link_label text,
  ended_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  dismissals integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.check_platform_server_key(p_server_key);

  return query
  select
    a.id, a.title, a.body, a.kind, a.audience, a.starts_at, a.ends_at, a.link_url,
    a.link_label, a.ended_at, a.created_at, a.updated_at,
    (
      select count(*)::integer
      from public.platform_announcement_dismissals d
      where d.announcement_id = a.id
    )
  from public.platform_announcements a
  order by a.created_at desc, a.id
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;

comment on function public.platform_list_announcements(text, integer) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY): todos os comunicados (agendados, no ar, encerrados e vencidos), do mais novo para o mais antigo, com quantas pessoas dispensaram. Até 200.';

create or replace function public.platform_save_announcement(
  p_server_key text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_title text,
  p_body text,
  p_kind text,
  p_audience text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_link_url text default null,
  p_link_label text default null,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.platform_announcements%rowtype;
  v_row public.platform_announcements%rowtype;
  v_link_url text := nullif(btrim(coalesce(p_link_url, '')), '');
  v_link_label text := nullif(btrim(coalesce(p_link_label, '')), '');
begin
  perform private.check_platform_server_key(p_server_key);

  if p_starts_at is null or p_ends_at is null or p_ends_at <= now() then
    raise exception 'O fim do comunicado precisa ser no futuro.' using errcode = '22023';
  end if;

  if v_link_url is null then
    v_link_label := null;
  end if;

  if p_id is null then
    insert into public.platform_announcements (
      title, body, kind, audience, starts_at, ends_at, link_url, link_label
    )
    values (
      btrim(coalesce(p_title, '')), btrim(coalesce(p_body, '')), p_kind, p_audience,
      p_starts_at, p_ends_at, v_link_url, v_link_label
    )
    returning * into v_row;

    perform private.record_platform_audit_event(
      p_actor_user_id, p_actor_email, 'comunicado.criar', 'comunicado', v_row.id::text,
      null, null, null, private.platform_announcement_audit_data(v_row)
    );

    return v_row.id;
  end if;

  select * into v_before
  from public.platform_announcements a
  where a.id = p_id
  for update;

  if not found then
    raise exception 'Comunicado não encontrado.' using errcode = 'P0002';
  end if;

  if v_before.ended_at is not null then
    raise exception 'Comunicado encerrado não pode ser editado.' using errcode = '22023';
  end if;

  update public.platform_announcements a
  set title = btrim(coalesce(p_title, '')),
      body = btrim(coalesce(p_body, '')),
      kind = p_kind,
      audience = p_audience,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      link_url = v_link_url,
      link_label = v_link_label
  where a.id = p_id
  returning * into v_row;

  perform private.record_platform_audit_event(
    p_actor_user_id, p_actor_email, 'comunicado.editar', 'comunicado', v_row.id::text,
    null, null, private.platform_announcement_audit_data(v_before),
    private.platform_announcement_audit_data(v_row)
  );

  return v_row.id;
end;
$$;

comment on function public.platform_save_announcement(text, uuid, text, text, text, text, text, timestamptz, timestamptz, text, text, uuid) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir o e-mail da equipe: cria (p_id null) ou edita um comunicado ainda não encerrado e grava comunicado.criar/comunicado.editar no registro do console na mesma transação. Erros: 42501 chave ou conta de quem agiu; 22023 fim no passado ou comunicado encerrado; P0002 comunicado inexistente; 23514 campo fora das regras.';

create or replace function public.platform_end_announcement(
  p_server_key text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_id uuid,
  p_reason text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.platform_announcements%rowtype;
  v_row public.platform_announcements%rowtype;
begin
  perform private.check_platform_server_key(p_server_key);

  select * into v_before
  from public.platform_announcements a
  where a.id = p_id
  for update;

  if not found then
    raise exception 'Comunicado não encontrado.' using errcode = 'P0002';
  end if;

  -- Já encerrado: nada muda e nada é registrado.
  if v_before.ended_at is not null then
    return v_before.ended_at;
  end if;

  update public.platform_announcements a
  set ended_at = now()
  where a.id = p_id
  returning * into v_row;

  perform private.record_platform_audit_event(
    p_actor_user_id, p_actor_email, 'comunicado.encerrar', 'comunicado', v_row.id::text,
    null, p_reason,
    jsonb_build_object('fim', v_before.ends_at, 'encerrado_em', null),
    jsonb_build_object('fim', v_row.ends_at, 'encerrado_em', v_row.ended_at)
  );

  return v_row.ended_at;
end;
$$;

comment on function public.platform_end_announcement(text, uuid, text, uuid, text) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir o e-mail da equipe: tira o comunicado do ar agora (ended_at) e grava comunicado.encerrar no registro do console. Já encerrado: devolve a data sem registrar de novo. Erros: 42501 chave ou conta; P0002 comunicado inexistente.';

-- -----------------------------------------------------------------------------
-- 3. Filtros do registro do console
-- -----------------------------------------------------------------------------
create or replace function public.platform_audit_event_filters(p_server_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_platform_server_key(p_server_key);

  return jsonb_build_object(
    'actions', coalesce((
      select jsonb_agg(jsonb_build_object('action', a.action, 'total', a.total) order by a.action)
      from (
        select e.action, count(*)::integer as total
        from private.platform_audit_events e
        group by e.action
      ) a
    ), '[]'::jsonb),
    'organizations', coalesce((
      select jsonb_agg(
        jsonb_build_object('organization_id', x.organization_id, 'name', o.name, 'total', x.total)
        order by o.name nulls last, x.organization_id
      )
      from (
        select e.organization_id, count(*)::integer as total
        from private.platform_audit_events e
        where e.organization_id is not null
        group by e.organization_id
      ) x
      left join public.organizations o on o.id = x.organization_id
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.platform_audit_event_filters(text) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY): ações e imobiliárias (id, nome atual ou null se apagada, total) presentes no registro do console, para os filtros de /plataforma/registro.';

-- -----------------------------------------------------------------------------
-- 4. Retenção do registro do console (LGPD: 2 anos)
-- -----------------------------------------------------------------------------
create or replace function private.platform_audit_retention_period()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '2 years';
$$;

comment on function private.platform_audit_retention_period() is
  'Prazo de guarda do registro do console (LGPD): 2 anos. Usado pelo gatilho só de acréscimo e pela rotina private.purge_platform_audit_events.';

revoke all on function private.platform_audit_retention_period() from public, anon, authenticated;

-- Continua só de acréscimo. Única exceção: DELETE de linha com mais de 2 anos
-- feito pela rotina de retenção, que liga private.platform_audit_purge na
-- própria transação. TRUNCATE segue recusado.
create or replace function private.platform_audit_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if coalesce(current_setting('private.platform_audit_purge', true), '') = 'on'
       and old.occurred_at < now() - private.platform_audit_retention_period() then
      return old;
    end if;
  end if;

  raise exception 'O registro do console só aceita novas linhas.' using errcode = '42501';
end;
$$;

comment on function private.platform_audit_events_append_only() is
  'Gatilho que torna private.platform_audit_events só de acréscimo (recusa UPDATE, DELETE e TRUNCATE). Exceção: a rotina de retenção apaga linhas com mais de 2 anos.';

create or replace function private.purge_platform_audit_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_batch constant integer := 5000;
  c_max_batches constant integer := 100;
  v_deleted integer;
  v_total integer := 0;
  v_round integer := 0;
  v_dismissals integer;
begin
  perform set_config('private.platform_audit_purge', 'on', true);

  loop
    delete from private.platform_audit_events e
    where e.id in (
      select x.id
      from private.platform_audit_events x
      where x.occurred_at < now() - private.platform_audit_retention_period()
      order by x.id
      limit c_batch
    );

    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
    v_round := v_round + 1;

    exit when v_deleted < c_batch or v_round >= c_max_batches;
  end loop;

  perform set_config('private.platform_audit_purge', 'off', true);

  -- A dispensa só serve enquanto o comunicado está no ar: 30 dias depois, sai.
  delete from public.platform_announcement_dismissals d
  using public.platform_announcements a
  where a.id = d.announcement_id
    and least(a.ended_at, a.ends_at) < now() - interval '30 days';

  get diagnostics v_dismissals = row_count;

  return v_total + v_dismissals;
end;
$$;

comment on function private.purge_platform_audit_events() is
  'Rotina agendada (pg_cron, job retencao-registro-console, domingo 04:35 UTC): apaga do registro do console as linhas com mais de 2 anos (LGPD; lotes de 5.000, até 100 por execução) e as dispensas de comunicados fora do ar há mais de 30 dias. Retorna quantas linhas apagou.';

revoke all on function private.purge_platform_audit_events() from public, anon, authenticated;

comment on table private.platform_audit_events is
  'Registro do Console da Plataforma: quem (e-mail e id da conta da equipe), o quê (ação), em quem (alvo e imobiliária), por quê (motivo), antes/depois (sem dado pessoal de cliente final) e quando. Só de acréscimo: UPDATE, DELETE e TRUNCATE são recusados por gatilho. Escrita só por private.record_platform_audit_event. Retenção (LGPD): 2 anos; a rotina semanal retencao-registro-console (private.purge_platform_audit_events, domingo 04:35 UTC) apaga o que passou disso, e só ela consegue apagar.';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'retencao-registro-console') then
    perform cron.unschedule('retencao-registro-console');
  end if;
end;
$$;

select cron.schedule(
  'retencao-registro-console',
  '35 4 * * 0',
  $cron$ select private.purge_platform_audit_events(); $cron$
);

-- -----------------------------------------------------------------------------
-- Privilégios: RPCs com chave do servidor só para anon (o servidor chama sem sessão)
-- -----------------------------------------------------------------------------
revoke all on function public.platform_ai_costs(text) from public, anon, authenticated;
revoke all on function public.platform_list_announcements(text, integer) from public, anon, authenticated;
revoke all on function public.platform_save_announcement(text, uuid, text, text, text, text, text, timestamptz, timestamptz, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.platform_end_announcement(text, uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.platform_audit_event_filters(text) from public, anon, authenticated;

grant execute on function public.platform_ai_costs(text) to anon;
grant execute on function public.platform_list_announcements(text, integer) to anon;
grant execute on function public.platform_save_announcement(text, uuid, text, text, text, text, text, timestamptz, timestamptz, text, text, uuid)
  to anon;
grant execute on function public.platform_end_announcement(text, uuid, text, uuid, text) to anon;
grant execute on function public.platform_audit_event_filters(text) to anon;
