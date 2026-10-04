-- =============================================================================
-- Teste dos avisos de visita marcada por outra pessoa e do lembrete de tarefa
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
-- Usa a chave `notification_server_key` do Vault (sem imprimir).
--
-- O que está sendo garantido (migração visit_assigned_and_task_reminders):
--   1. visita marcada pela assistente para o corretor entra na fila; a que o
--      corretor marca para si não; remarcar abre um aviso novo; preferência
--      desligada não enfileira;
--   2. a sessão não lê as filas; chave errada não reserva; o servidor reserva
--      com os aparelhos do corretor UMA vez (o reenvio não repete o push);
--   3. visita cancelada sai da fila antes de reservar;
--   4. tarefa com horário em até 15 min e aparelho ligado entra na fila; tarefa
--      do dia todo (23:59), sem aparelho ou com lembrete desligado não;
--   5. settle confirma o envio; concluir a tarefa descarta o lembrete;
--   6. as preferências novas têm padrão (avisos ligados, letra normal).
--
-- Resultado esperado (a ordem das chaves pode variar):
--   assistente_marca_enfileira         : 1
--   corretor_para_si_nao_enfileira     : 0
--   editar_sem_mudar_nao_duplica       : 1
--   remarcar_abre_aviso_novo           : 2
--   preferencia_desligada_nao_enfileira: 0
--   sessao_nao_le_fila_visita          : "NEGADO:42501"
--   sessao_nao_le_fila_tarefa          : "NEGADO:42501"
--   chave_errada_nao_reserva           : "NEGADO:42501"
--   cancelada_sai_da_fila              : 1
--   reserva_aviso_visita               : 1
--   quem_marcou                        : "Julia Assistente"
--   aparelhos_na_primeira_reserva      : 1
--   aparelhos_no_reenvio               : 0
--   settle_visita                      : {"sent": 1, "failed": 0, "released": 0}
--   tarefas_enfileiradas               : 1
--   reserva_lembrete_tarefa            : 1
--   aparelhos_da_tarefa                : 1
--   settle_tarefa                      : {"sent": 1, "failed": 0, "released": 0}
--   concluida_descarta_lembrete        : 0
--   preferencias_padrao                : {"large_text": false, "task_reminders": true, "visit_assigned": true}

do $$
declare
  r jsonb := '{}'::jsonb;
  server_key text;
  u_owner uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  u_assistant uuid := gen_random_uuid();
  u_broker2 uuid := gen_random_uuid();
  org uuid;
  prop uuid;
  a_by_assistant uuid;
  a_own uuid;
  a_canceled uuid;
  a_pref_off uuid;
  t_soon uuid;
  t_all_day uuid;
  t_no_device uuid;
  k_p256dh text := 'B' || repeat('x', 86);
  k_auth text := repeat('a', 22);
  v_json jsonb;
  v_text text;
  v_int integer;
  v_ids uuid[];
  v_now timestamptz := date_trunc('minute', now());
begin
  select ds.decrypted_secret into server_key
  from vault.decrypted_secrets ds
  where ds.name = 'notification_server_key';

  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-avisos-dono@exemplo.invalid', now(), now(), now()),
    (u_broker, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-avisos-corretor@exemplo.invalid', now(), now(), now()),
    (u_assistant, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-avisos-assistente@exemplo.invalid', now(), now(), now()),
    (u_broker2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-avisos-corretor2@exemplo.invalid', now(), now(), now());

  update public.profiles set full_name = 'Julia Assistente' where id = u_assistant;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Avisos', 'teste-avisos-visita');

  update public.billing_accounts
  set limits = limits || '{"users": 20}'::jsonb
  where organization_id = org;

  insert into public.memberships (organization_id, user_id, role, active)
  values
    (org, u_broker, 'broker', true),
    (org, u_assistant, 'assistant', true),
    (org, u_broker2, 'broker', true);

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, captured_by, broker_id,
    street, street_number, neighborhood, city, state, address_display
  )
  values (
    org, 'Casa do teste de avisos', 'sale', 'house', 'active', 400000, 120, u_broker, u_broker,
    'Rua das Flores', '10', 'Centro', 'Ribeirao Preto', 'SP', 'street'
  )
  returning id into prop;

  -- Aparelho do corretor ligado (push).
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  perform public.register_push_subscription(
    'https://fcm.googleapis.com/fcm/send/teste-avisos-' || gen_random_uuid(), k_p256dh, k_auth,
    'Chrome no Android', null);

  -- ---------------------------------------------------------------------------
  -- 1. Enfileirar
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_assistant, 'role', 'authenticated')::text, true);

  insert into public.appointments (organization_id, property_id, broker_id, starts_at, ends_at)
  values (org, prop, u_broker, v_now + interval '1 day', v_now + interval '1 day 1 hour')
  returning id into a_by_assistant;

  select count(*)::integer into v_int
  from private.visit_assignment_notifications where appointment_id = a_by_assistant;
  r := r || jsonb_build_object('assistente_marca_enfileira', v_int);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);

  insert into public.appointments (organization_id, property_id, broker_id, starts_at, ends_at)
  values (org, prop, u_broker, v_now + interval '2 days', v_now + interval '2 days 1 hour')
  returning id into a_own;

  select count(*)::integer into v_int
  from private.visit_assignment_notifications where appointment_id = a_own;
  r := r || jsonb_build_object('corretor_para_si_nao_enfileira', v_int);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_assistant, 'role', 'authenticated')::text, true);

  update public.appointments set meeting_point = 'Portaria', status = 'scheduled'
  where id = a_by_assistant;

  select count(*)::integer into v_int
  from private.visit_assignment_notifications where appointment_id = a_by_assistant;
  r := r || jsonb_build_object('editar_sem_mudar_nao_duplica', v_int);

  update public.appointments
  set starts_at = v_now + interval '1 day 2 hours', ends_at = v_now + interval '1 day 3 hours'
  where id = a_by_assistant;

  select count(*)::integer into v_int
  from private.visit_assignment_notifications where appointment_id = a_by_assistant;
  r := r || jsonb_build_object('remarcar_abre_aviso_novo', v_int);

  insert into public.email_preferences (user_id, visit_assigned) values (u_broker2, false);

  insert into public.appointments (organization_id, property_id, broker_id, starts_at, ends_at)
  values (org, prop, u_broker2, v_now + interval '1 day', v_now + interval '1 day 1 hour')
  returning id into a_pref_off;

  select count(*)::integer into v_int
  from private.visit_assignment_notifications where appointment_id = a_pref_off;
  r := r || jsonb_build_object('preferencia_desligada_nao_enfileira', v_int);

  insert into public.appointments (organization_id, property_id, broker_id, starts_at, ends_at)
  values (org, prop, u_broker, v_now + interval '3 days', v_now + interval '3 days 1 hour')
  returning id into a_canceled;

  update public.appointments set status = 'canceled' where id = a_canceled;

  -- ---------------------------------------------------------------------------
  -- 2. Sessão e chave errada
  -- ---------------------------------------------------------------------------
  set local role authenticated;

  begin
    execute 'select count(*) from private.visit_assignment_notifications' into v_int;
    r := r || jsonb_build_object('sessao_nao_le_fila_visita', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('sessao_nao_le_fila_visita', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'select count(*) from private.task_reminder_notifications' into v_int;
    r := r || jsonb_build_object('sessao_nao_le_fila_tarefa', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('sessao_nao_le_fila_tarefa', 'NEGADO:' || sqlstate);
  end;

  reset role;

  perform set_config('request.jwt.claims', '', true);
  set local role anon;

  begin
    execute 'select count(*) from public.claim_visit_assignment_notices($1, 10)'
      into v_int using 'chave-errada';
    r := r || jsonb_build_object('chave_errada_nao_reserva', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('chave_errada_nao_reserva', 'NEGADO:' || sqlstate);
  end;

  -- ---------------------------------------------------------------------------
  -- 3. Reserva pelo servidor
  -- ---------------------------------------------------------------------------
  execute $q$
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
    from public.claim_visit_assignment_notices($1, 50) c
    where c.organization_id = $2
  $q$ into v_json using server_key, org;

  reset role;

  select count(*)::integer into v_int
  from private.visit_assignment_notifications where appointment_id = a_canceled;
  -- A visita cancelada nunca foi enfileirada como pendente válida: o aviso some.
  r := r || jsonb_build_object('cancelada_sai_da_fila', 1 - v_int);

  r := r || jsonb_build_object('reserva_aviso_visita', jsonb_array_length(v_json));
  r := r || jsonb_build_object('quem_marcou', v_json -> 0 ->> 'assigned_by_name');
  r := r || jsonb_build_object('aparelhos_na_primeira_reserva',
    jsonb_array_length(v_json -> 0 -> 'push_targets'));

  select array_agg((x ->> 'id')::uuid) into v_ids from jsonb_array_elements(v_json) x;

  set local role anon;
  execute 'select public.settle_visit_assignment_notices($1, $2, $3, $4)'
    into v_json using server_key, '{}'::uuid[], v_ids, '{}'::uuid[];

  -- Reenvio depois da falha: o e-mail volta, o push não.
  execute $q$
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
    from public.claim_visit_assignment_notices($1, 50) c
    where c.organization_id = $2
  $q$ into v_json using server_key, org;
  r := r || jsonb_build_object('aparelhos_no_reenvio',
    coalesce(jsonb_array_length(v_json -> 0 -> 'push_targets'), -1));

  select array_agg((x ->> 'id')::uuid) into v_ids from jsonb_array_elements(v_json) x;
  execute 'select public.settle_visit_assignment_notices($1, $2, $3, $4)'
    into v_json using server_key, v_ids, '{}'::uuid[], '{}'::uuid[];
  r := r || jsonb_build_object('settle_visita', v_json);
  reset role;

  -- ---------------------------------------------------------------------------
  -- 4. Lembrete de tarefa
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);

  insert into public.tasks (organization_id, title, assignee_id, due_at, status)
  values (org, 'Ligar para o proprietario', u_broker, v_now + interval '10 minutes', 'open')
  returning id into t_soon;

  -- "Do dia todo": 23:59 em Brasília (hoje, se ainda não passou; senão amanhã).
  insert into public.tasks (organization_id, title, assignee_id, due_at, status)
  values (org, 'Dia todo', u_broker,
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '23 hours 59 minutes')
      at time zone 'America/Sao_Paulo', 'open')
  returning id into t_all_day;

  -- Corretor 2 sem aparelho ligado.
  insert into public.tasks (organization_id, title, assignee_id, due_at, status)
  values (org, 'Sem aparelho', u_broker2, v_now + interval '10 minutes', 'open')
  returning id into t_no_device;

  perform private.enqueue_task_reminders();

  select count(*)::integer into v_int
  from private.task_reminder_notifications
  where organization_id = org;
  r := r || jsonb_build_object('tarefas_enfileiradas', v_int);

  set local role anon;
  execute $q$
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
    from public.claim_task_reminders($1, 50) c
    where c.organization_id = $2
  $q$ into v_json using server_key, org;
  r := r || jsonb_build_object('reserva_lembrete_tarefa', jsonb_array_length(v_json));
  r := r || jsonb_build_object('aparelhos_da_tarefa',
    coalesce(jsonb_array_length(v_json -> 0 -> 'push_targets'), -1));

  select array_agg((x ->> 'id')::uuid) into v_ids from jsonb_array_elements(v_json) x;
  execute 'select public.settle_task_reminders($1, $2, $3, $4)'
    into v_json using server_key, v_ids, '{}'::uuid[], '{}'::uuid[];
  r := r || jsonb_build_object('settle_tarefa', v_json);
  reset role;

  -- Nova tarefa, concluída antes do lembrete: descartada na reserva.
  insert into public.tasks (organization_id, title, assignee_id, due_at, status)
  values (org, 'Concluida antes', u_broker, v_now + interval '12 minutes', 'open')
  returning id into t_soon;
  perform private.enqueue_task_reminders();
  update public.tasks set status = 'done' where id = t_soon;

  set local role anon;
  execute $q$
    select count(*)::integer
    from public.claim_task_reminders($1, 50) c
    where c.task_id = $2
  $q$ into v_int using server_key, t_soon;
  r := r || jsonb_build_object('concluida_descarta_lembrete', v_int);
  reset role;

  -- ---------------------------------------------------------------------------
  -- 6. Padrões das preferências novas
  -- ---------------------------------------------------------------------------
  insert into public.email_preferences (user_id) values (u_owner);
  select jsonb_build_object(
    'large_text', ep.large_text,
    'task_reminders', ep.task_reminders,
    'visit_assigned', ep.visit_assigned
  ) into v_json
  from public.email_preferences ep where ep.user_id = u_owner;
  r := r || jsonb_build_object('preferencias_padrao', v_json);

  raise exception 'TESTE avisos_visita_tarefa (rollback): %', r;
end;
$$;
