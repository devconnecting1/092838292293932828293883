-- =============================================================================
-- Teste dos lembretes: resumo diário, lembrete de visita, relatório semanal,
-- aniversariantes do Painel e preferências de e-mail
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- Cenário (hoje = data de São Paulo):
--   corretor: tarefa atrasada, tarefa de hoje, tarefa de amanhã, tarefa
--             concluída; visita hoje às 23:30 e visita daqui a 90 min (cliente
--             dele, "Maria"); lead parado há 5 dias, lead contatado ontem, lead
--             ganho e lead recebido e contatado na semana passada (também
--             parado); cliente dele que faz 30 anos hoje; visita realizada na
--             semana passada
--   dono:     cliente que faz aniversário em 3 dias (nada para o resumo)
--   gerente:  resumo diário desligado nas preferências
--   corretor2: nada para contar
--
-- Resultado esperado (a ordem das chaves pode variar):
--   aniversario_29_fev_ano_comum        : "2027-02-28"
--   proximo_aniversario_29_fev          : "2028-02-29"
--   codigos_janela_ano_comum            : "227,228,229"
--   codigos_janela_bissexto             : "227,228,229"
--   painel_total                        : 2
--   painel_primeiro_hoje_30_anos        : true
--   painel_estranho                     : 0
--   visitas_relatorio_corretor_linhas   : 1
--   preferencia_propria_gravada         : true
--   preferencia_alheia_invisivel        : 0
--   resumo_linhas                       : 1
--   resumo_tarefas                      : "1/1"
--   resumo_visita_23h30                 : true
--   resumo_endereco_cru                 : "street:Rua das Flores"
--   resumo_cliente_primeiro_nome        : true
--   resumo_leads_parados                : 2
--   resumo_aniversario                  : "1:30"
--   resumo_pulados                      : 2
--   resumo_preferencia_desligada        : 0
--   resumo_reserva_repetida             : 0
--   resumo_settle                       : {"sent": 1, "failed": 0, "released": 0}
--   resumo_nao_repete_no_dia            : 0
--   lembrete_enfileirado                : 1
--   lembrete_idempotente                : 1
--   lembrete_reservado                  : "1:Maria:street"
--   lembrete_settle                     : {"sent": 1, "failed": 0, "released": 0}
--   lembrete_nao_repete                 : 0
--   lembrete_remarcado_abre_novo        : 2
--   lembrete_cancelado_sai_da_fila      : "0:0"
--   semanal_linhas                      : 2
--   semanal_semana                      : true
--   semanal_totais                      : "1/1"
--   semanal_igual_a_tela                : true
--   semanal_identidade_restaurada       : true
--   semanal_nao_repete                  : 0
--   semanal_sem_numeros_pulado          : "0:1"
--   rpc_sem_chave                       : "NEGADO:42501"
--   grants_claim_anon                   : true
--   grants_claim_authenticated          : false
--   grant_painel_anon                   : false
--   grant_visitas_anon                  : false

do $$
declare
  r jsonb := '{}'::jsonb;
  key text;
  u_owner uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  u_manager uuid := gen_random_uuid();
  u_broker2 uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  org uuid;
  org2 uuid;
  prop uuid;
  c_maria uuid;
  c_dono uuid;
  a_reminder uuid;
  a_tonight uuid;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_monday date;
  v_week_start date;
  v_from timestamptz;
  v_to timestamptz;
  v_text text;
  v_int integer;
  v_bool boolean;
  v_id uuid;
  v_claims text;
  res jsonb;
begin
  select ds.decrypted_secret into key
  from vault.decrypted_secrets ds
  where ds.name = 'notification_server_key';

  v_monday := v_today - (extract(isodow from v_today)::integer - 1);
  v_week_start := v_monday - 7;
  v_from := v_week_start::timestamp at time zone 'America/Sao_Paulo';
  v_to := v_monday::timestamp at time zone 'America/Sao_Paulo';

  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-lembretes-dono@exemplo.invalid', now(), now(), now()),
    (u_broker, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-lembretes-corretor@exemplo.invalid', now(), now(), now()),
    (u_manager, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-lembretes-gerente@exemplo.invalid', now(), now(), now()),
    (u_broker2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-lembretes-corretor2@exemplo.invalid', now(), now(), now()),
    (u_stranger, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-lembretes-estranho@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Lembretes', 'teste-lembretes-resumo');

  insert into public.memberships (organization_id, user_id, role, active)
  values
    (org, u_broker, 'broker', true),
    (org, u_manager, 'manager', true),
    (org, u_broker2, 'broker', true);

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, captured_by, broker_id,
    street, street_number, neighborhood, city, state, address_display
  )
  values (
    org, 'Apartamento do teste', 'sale', 'apartment', 'active', 500000, 80, u_broker, u_broker,
    'Rua das Flores', '123', 'Centro', 'Sao Paulo', 'SP', 'street'
  )
  returning id into prop;

  insert into public.clients (organization_id, kind, name, birth_date, assigned_to)
  values (org, 'pf', 'Maria Teste da Silva', make_date(extract(year from v_today)::integer - 30,
    extract(month from v_today)::integer, extract(day from v_today)::integer), u_broker)
  returning id into c_maria;

  insert into public.clients (organization_id, kind, name, birth_date, assigned_to)
  values (org, 'pf', 'Cliente do Dono', (v_today + 3) - interval '40 years', u_owner)
  returning id into c_dono;

  -- Tarefas do corretor.
  insert into public.tasks (organization_id, title, assignee_id, due_at, status)
  values
    (org, 'Atrasada', u_broker, (v_today - 1)::timestamp at time zone 'America/Sao_Paulo' + interval '10 hours', 'open'),
    (org, 'De hoje', u_broker, v_today::timestamp at time zone 'America/Sao_Paulo' + interval '23 hours 59 minutes', 'open'),
    (org, 'De amanha', u_broker, (v_today + 1)::timestamp at time zone 'America/Sao_Paulo' + interval '10 hours', 'open'),
    (org, 'Concluida', u_broker, v_today::timestamp at time zone 'America/Sao_Paulo' + interval '9 hours', 'done');

  -- Visitas do corretor.
  insert into public.appointments (organization_id, property_id, client_id, broker_id, starts_at, ends_at)
  values (org, prop, c_maria, u_broker,
    v_today::timestamp at time zone 'America/Sao_Paulo' + interval '23 hours 30 minutes',
    v_today::timestamp at time zone 'America/Sao_Paulo' + interval '23 hours 50 minutes')
  returning id into a_tonight;

  insert into public.appointments (organization_id, property_id, client_id, broker_id, starts_at, ends_at)
  values (org, prop, c_maria, u_broker, date_trunc('minute', now()) + interval '90 minutes',
    date_trunc('minute', now()) + interval '150 minutes')
  returning id into a_reminder;

  insert into public.appointments (organization_id, property_id, client_id, broker_id, starts_at, ends_at, status, rating)
  values (org, prop, c_maria, u_broker, v_from + interval '1 day 10 hours',
    v_from + interval '1 day 11 hours', 'done', 5);

  -- Leads do corretor.
  insert into public.leads (organization_id, name, source, stage, assigned_to, last_contact_at)
  values
    (org, 'Lead parado', 'manual', 'contacted', u_broker, now() - interval '5 days'),
    (org, 'Lead de ontem', 'manual', 'contacted', u_broker, now() - interval '1 day');
  insert into public.leads (organization_id, name, source, stage, assigned_to, last_contact_at)
  values (org, 'Lead ganho', 'manual', 'won', u_broker, now() - interval '20 days');
  -- Lead recebido e contatado na semana passada (entra no relatório semanal).
  insert into public.leads (organization_id, name, source, stage, assigned_to, last_contact_at)
  values (org, 'Lead da semana passada', 'manual', 'qualified', u_broker, v_from + interval '2 days 1 hour')
  returning id into v_id;
  update public.leads
  set assigned_at = v_from + interval '2 days', created_at = v_from + interval '2 days'
  where id = v_id;

  -- ---------------------------------------------------------------------------
  -- 1. Ajudantes de aniversário
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'aniversario_29_fev_ano_comum', private.birthday_in_year(date '2000-02-29', 2027)::text,
    'proximo_aniversario_29_fev', private.next_birthday(date '2000-02-29', date '2027-03-01')::text,
    'codigos_janela_ano_comum', array_to_string(
      array(select unnest(private.birthday_codes(date '2027-02-27', 2)) order by 1), ','),
    'codigos_janela_bissexto', array_to_string(
      array(select unnest(private.birthday_codes(date '2028-02-27', 3)) order by 1), ',')
  );

  -- ---------------------------------------------------------------------------
  -- 2. Sessão: Painel, relatório de visitas e preferências (RLS)
  -- ---------------------------------------------------------------------------
  begin
    execute 'set local role authenticated';

    res := public.dashboard_client_birthdays(org, 7, 8);
    r := r || jsonb_build_object('painel_total', (res ->> 'total')::integer);
    r := r || jsonb_build_object(
      'painel_primeiro_hoje_30_anos',
      (res #>> '{items,0,client_id}')::uuid = c_maria
        and (res #>> '{items,0,days_until}')::integer = 0
        and (res #>> '{items,0,turning_age}')::integer = 30
    );

    insert into public.email_preferences (user_id, daily_digest) values (u_owner, true);

    perform set_config('request.jwt.claims',
      json_build_object('sub', u_manager, 'role', 'authenticated')::text, true);
    insert into public.email_preferences (user_id, daily_digest) values (u_manager, false);

    perform set_config('request.jwt.claims',
      json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
    select count(*)::integer into v_int from public.report_broker_visits(org, v_from, v_to);
    r := r || jsonb_build_object('visitas_relatorio_corretor_linhas', v_int);

    perform set_config('request.jwt.claims',
      json_build_object('sub', u_manager, 'role', 'authenticated')::text, true);
    select exists (select 1 from public.email_preferences where user_id = u_manager and not daily_digest)
      into v_bool;
    r := r || jsonb_build_object('preferencia_propria_gravada', v_bool);
    select count(*)::integer into v_int from public.email_preferences where user_id = u_owner;
    r := r || jsonb_build_object('preferencia_alheia_invisivel', v_int);

    perform set_config('request.jwt.claims',
      json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
    res := public.dashboard_client_birthdays(org, 7, 8);
    r := r || jsonb_build_object('painel_estranho', (res ->> 'total')::integer);

    execute 'reset role';
  exception when others then
    execute 'reset role';
    r := r || jsonb_build_object('sessao_erro', sqlstate || ' ' || sqlerrm);
  end;

  perform set_config('request.jwt.claims', '', true);

  -- ---------------------------------------------------------------------------
  -- 3. Resumo diário
  -- ---------------------------------------------------------------------------
  create temporary table teste_resumo on commit drop as
  select * from public.claim_daily_digests(key, 100, 3, org);

  select count(*)::integer into v_int from teste_resumo;
  r := r || jsonb_build_object('resumo_linhas', v_int);

  select content into res from teste_resumo where recipient_user_id = u_broker;

  r := r || jsonb_build_object(
    'resumo_tarefas', (res ->> 'tasks_overdue_total') || '/' || (res ->> 'tasks_today_total'),
    'resumo_visita_23h30', exists (
      select 1 from jsonb_array_elements(res -> 'visits') v where (v ->> 'id')::uuid = a_tonight
    ),
    'resumo_endereco_cru',
      (res #>> '{visits,0,property,address_display}') || ':' || (res #>> '{visits,0,property,street}'),
    'resumo_cliente_primeiro_nome', res #>> '{visits,0,client_first_name}' = 'Maria',
    'resumo_leads_parados', (res ->> 'stale_leads_total')::integer,
    'resumo_aniversario', (res ->> 'birthdays_total') || ':' || (res #>> '{birthdays,0,age}')
  );

  select count(*)::integer into v_int
  from private.daily_digest_deliveries d
  where d.organization_id = org and d.skipped_at is not null;
  r := r || jsonb_build_object('resumo_pulados', v_int);

  select count(*)::integer into v_int
  from private.daily_digest_deliveries d
  where d.organization_id = org and d.user_id = u_manager;
  r := r || jsonb_build_object('resumo_preferencia_desligada', v_int);

  select count(*)::integer into v_int from public.claim_daily_digests(key, 100, 3, org);
  r := r || jsonb_build_object('resumo_reserva_repetida', v_int);

  select id into v_id from teste_resumo where recipient_user_id = u_broker;
  res := public.settle_daily_digests(key, array[v_id], '{}'::uuid[], '{}'::uuid[]);
  r := r || jsonb_build_object('resumo_settle', res);

  update private.daily_digest_deliveries d
  set claimed_at = now() - interval '1 hour'
  where d.organization_id = org;
  select count(*)::integer into v_int from public.claim_daily_digests(key, 100, 3, org);
  r := r || jsonb_build_object('resumo_nao_repete_no_dia', v_int);

  -- ---------------------------------------------------------------------------
  -- 4. Lembrete de visita
  -- ---------------------------------------------------------------------------
  perform private.enqueue_visit_reminders();
  select count(*)::integer into v_int
  from private.visit_reminder_notifications n where n.appointment_id = a_reminder;
  r := r || jsonb_build_object('lembrete_enfileirado', v_int);

  perform private.enqueue_visit_reminders();
  select count(*)::integer into v_int
  from private.visit_reminder_notifications n where n.appointment_id = a_reminder;
  r := r || jsonb_build_object('lembrete_idempotente', v_int);

  create temporary table teste_lembrete on commit drop as
  select * from public.claim_visit_reminders(key, 100) c where c.appointment_id = a_reminder;

  select count(*)::text || ':' || coalesce(max(client_first_name), '-') || ':' || coalesce(max(address_display::text), '-')
    into v_text
  from teste_lembrete;
  r := r || jsonb_build_object('lembrete_reservado', v_text);

  select id into v_id from teste_lembrete limit 1;
  res := public.settle_visit_reminders(key, array[v_id], '{}'::uuid[], '{}'::uuid[]);
  r := r || jsonb_build_object('lembrete_settle', res);

  perform private.enqueue_visit_reminders();
  select count(*)::integer into v_int
  from public.claim_visit_reminders(key, 100) c where c.appointment_id = a_reminder;
  r := r || jsonb_build_object('lembrete_nao_repete', v_int);

  -- Remarcar abre um lembrete novo; cancelar tira o pendente da fila.
  update public.appointments
  set starts_at = starts_at + interval '5 minutes', ends_at = ends_at + interval '5 minutes'
  where id = a_reminder;
  perform private.enqueue_visit_reminders();
  select count(*)::integer into v_int
  from private.visit_reminder_notifications n where n.appointment_id = a_reminder;
  r := r || jsonb_build_object('lembrete_remarcado_abre_novo', v_int);

  update public.appointments set status = 'canceled' where id = a_reminder;
  select count(*)::integer into v_int
  from public.claim_visit_reminders(key, 100) c where c.appointment_id = a_reminder;
  select v_int::text || ':' || count(*)::text into v_text
  from private.visit_reminder_notifications n
  where n.appointment_id = a_reminder and n.sent_at is null;
  r := r || jsonb_build_object('lembrete_cancelado_sai_da_fila', v_text);

  -- ---------------------------------------------------------------------------
  -- 5. Relatório semanal
  -- ---------------------------------------------------------------------------
  v_claims := json_build_object('sub', u_stranger, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);

  create temporary table teste_semanal on commit drop as
  select * from public.claim_weekly_reports(key, 50, org);

  r := r || jsonb_build_object(
    'semanal_identidade_restaurada', current_setting('request.jwt.claims', true) = v_claims
  );

  select count(*)::integer into v_int from teste_semanal;
  r := r || jsonb_build_object('semanal_linhas', v_int);

  select bool_and(week_start = v_week_start and week_end = v_week_start + 6) into v_bool from teste_semanal;
  r := r || jsonb_build_object('semanal_semana', coalesce(v_bool, false));

  select (report #>> '{totals,leads_received}') || '/' || (report #>> '{totals,visits_done}')
    into v_text
  from teste_semanal limit 1;
  r := r || jsonb_build_object('semanal_totais', v_text);

  -- Mesmos números da tela: a função de relatório com a sessão do dono.
  select report into res from teste_semanal limit 1;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';

    select
      (select coalesce(sum(b.leads_received), 0) from public.report_broker_performance(org, v_from, v_to) b)
        = (res #>> '{totals,leads_received}')::numeric
      and (select coalesce(sum(v.visits_done), 0) from public.report_broker_visits(org, v_from, v_to) v)
        = (res #>> '{totals,visits_done}')::numeric
      and (select coalesce(sum(b.proposals_made), 0) from public.report_broker_performance(org, v_from, v_to) b)
        = (res #>> '{totals,proposals_made}')::numeric
      into v_bool;
    r := r || jsonb_build_object('semanal_igual_a_tela', coalesce(v_bool, false));

    execute 'reset role';
  exception when others then
    execute 'reset role';
    r := r || jsonb_build_object('semanal_sessao_erro', sqlstate || ' ' || sqlerrm);
  end;

  perform set_config('request.jwt.claims', '', true);

  select count(*)::integer into v_int from public.claim_weekly_reports(key, 50, org);
  r := r || jsonb_build_object('semanal_nao_repete', v_int);

  -- Imobiliária sem nenhum número na semana: não envia e marca como pulada.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  org2 := public.create_organization('Imobiliaria Teste Semana Vazia', 'teste-lembretes-vazia');
  perform set_config('request.jwt.claims', '', true);

  select count(*)::integer into v_int from public.claim_weekly_reports(key, 50, org2);
  select v_int::text || ':' || count(*)::text into v_text
  from private.weekly_report_deliveries d
  where d.organization_id = org2 and d.skipped_at is not null;
  r := r || jsonb_build_object('semanal_sem_numeros_pulado', v_text);

  -- ---------------------------------------------------------------------------
  -- 6. Permissões
  -- ---------------------------------------------------------------------------
  begin
    perform public.claim_daily_digests('chave-errada', 10, 3, org);
    r := r || jsonb_build_object('rpc_sem_chave', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('rpc_sem_chave', 'NEGADO:' || sqlstate);
  end;

  r := r || jsonb_build_object(
    'grants_claim_anon',
    has_function_privilege('anon', 'public.claim_daily_digests(text, integer, integer, uuid)', 'execute')
      and has_function_privilege('anon', 'public.settle_daily_digests(text, uuid[], uuid[], uuid[])', 'execute')
      and has_function_privilege('anon', 'public.claim_visit_reminders(text, integer)', 'execute')
      and has_function_privilege('anon', 'public.settle_visit_reminders(text, uuid[], uuid[], uuid[])', 'execute')
      and has_function_privilege('anon', 'public.claim_weekly_reports(text, integer, uuid)', 'execute')
      and has_function_privilege('anon', 'public.settle_weekly_reports(text, uuid[], uuid[], uuid[])', 'execute'),
    'grants_claim_authenticated',
    has_function_privilege('authenticated', 'public.claim_daily_digests(text, integer, integer, uuid)', 'execute')
      or has_function_privilege('authenticated', 'public.settle_daily_digests(text, uuid[], uuid[], uuid[])', 'execute')
      or has_function_privilege('authenticated', 'public.claim_visit_reminders(text, integer)', 'execute')
      or has_function_privilege('authenticated', 'public.settle_visit_reminders(text, uuid[], uuid[], uuid[])', 'execute')
      or has_function_privilege('authenticated', 'public.claim_weekly_reports(text, integer, uuid)', 'execute')
      or has_function_privilege('authenticated', 'public.settle_weekly_reports(text, uuid[], uuid[], uuid[])', 'execute'),
    'grant_painel_anon',
    has_function_privilege('anon', 'public.dashboard_client_birthdays(uuid, integer, integer)', 'execute'),
    'grant_visitas_anon',
    has_function_privilege('anon', 'public.report_broker_visits(uuid, timestamptz, timestamptz)', 'execute')
  );

  raise exception 'TESTE lembretes (rollback): %', jsonb_pretty(r);
end;
$$;
