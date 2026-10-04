-- =============================================================================
-- Teste do rodízio de leads, do plantão, do SLA e do histórico de etapa
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- A imobiliária de teste liga o rodízio com prazo de 1 min, aviso em 50% e no
-- máximo 1 redistribuição, só para o ciclo inteiro acontecer rápido.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   rodizio_sem_repetir            : 3
--   prazo_calculado                : true
--   evento_de_criacao              : "new/created"
--   evento_de_atribuicao           : "roulette"
--   limite_diario_pula_corretor    : true
--   ferias_pula_corretor           : true
--   fora_do_plantao_enfileira      : true
--   janela_aberta_entrega          : true
--   aviso_de_prazo                 : 1
--   aviso_so_uma_vez               : 0
--   redistribuiu                   : 1
--   novo_responsavel_diferente     : true
--   motivo_da_redistribuicao       : "sla_reassign"
--   aviso_perdeu_o_lead            : true
--   aviso_recebeu_por_sla          : true
--   teto_de_redistribuicoes        : 0
--   contato_zera_o_prazo           : true
--   historico_de_etapa             : "new>contacted"
--   fila_de_avisos_reivindicada    : true
--   fila_de_avisos_confirmada      : true
--   transferencia_em_massa         : true
--   devolucao_para_a_roleta        : true
--   painel_do_rodizio              : true
--   metricas_por_etapa             : true
--   estranho_no_painel             : "NEGADO:42501"
--   corretor_edita_config          : "NEGADO:42501"
--   corretor_escreve_historico     : "NEGADO:42501"
--   rpc_avisos_sem_chave           : "NEGADO:42501"
--   grant_roleta_anon              : false
--   grant_roleta_authenticated     : true

do $$
declare
  r jsonb := '{}'::jsonb;
  key text;
  u_owner uuid := gen_random_uuid();
  u_b1 uuid := gen_random_uuid();
  u_b2 uuid := gen_random_uuid();
  u_b3 uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  org uuid;
  m1 uuid;
  m2 uuid;
  m3 uuid;
  lead1 uuid;
  lead2 uuid;
  lead3 uuid;
  lead_off uuid;
  lead_sla uuid;
  v_ids uuid[];
  res jsonb;
  v_text text;
  v_int integer;
  v_bool boolean;
  v_uuid uuid;
  v_weekday smallint;
  v_minute integer;
  v_zone text := 'America/Sao_Paulo';
  v_claim record;
begin
  select ds.decrypted_secret into key
  from vault.decrypted_secrets ds
  where ds.name = 'notification_server_key';

  -- ---------------------------------------------------------------------------
  -- Cenário: 1 dono e 3 corretores, todos com e-mail confirmado (para os avisos)
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-rodizio-dono@exemplo.invalid', now(), now(), now()),
    (u_b1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-rodizio-b1@exemplo.invalid', now(), now(), now()),
    (u_b2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-rodizio-b2@exemplo.invalid', now(), now(), now()),
    (u_b3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-rodizio-b3@exemplo.invalid', now(), now(), now()),
    (u_stranger, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-rodizio-estranho@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Rodizio', 'teste-rodizio-leads');

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_b1, 'broker', true), (org, u_b2, 'broker', true), (org, u_b3, 'broker', true);

  -- Prazo curto e teto baixo: o ciclo inteiro cabe no teste.
  insert into public.lead_routing_settings (
    organization_id, roulette_enabled, respect_schedule, fallback_to_page_assignee,
    sla_minutes, sla_reassign_enabled, sla_warning_percent, max_reassignments, time_zone
  )
  values (org, true, true, true, 1, true, 50, 1, v_zone);

  insert into public.lead_routing_members (organization_id, user_id, active, weight)
  values (org, u_b1, true, 1), (org, u_b2, true, 1), (org, u_b3, true, 1);

  select id into m1 from public.lead_routing_members where organization_id = org and user_id = u_b1;
  select id into m2 from public.lead_routing_members where organization_id = org and user_id = u_b2;
  select id into m3 from public.lead_routing_members where organization_id = org and user_id = u_b3;

  select c.weekday, c.minute_of_day into v_weekday, v_minute
  from private.lead_routing_clock(now(), v_zone) c;

  -- ---------------------------------------------------------------------------
  -- 1. Rodízio: três leads seguidos vão para três corretores diferentes
  -- ---------------------------------------------------------------------------
  insert into public.leads (organization_id, name, phone, source, stage)
  values (org, 'Lead Um', '11999990001', 'manual', 'new') returning id into lead1;
  insert into public.leads (organization_id, name, phone, source, stage)
  values (org, 'Lead Dois', '11999990002', 'manual', 'new') returning id into lead2;
  insert into public.leads (organization_id, name, phone, source, stage)
  values (org, 'Lead Tres', '11999990003', 'manual', 'new') returning id into lead3;

  -- Tres leads seguidos: um para cada corretor da fila (nenhum repete).
  select count(distinct l.assigned_to)::integer into v_int
  from public.leads l
  where l.id in (lead1, lead2, lead3) and l.assigned_to is not null;

  r := r || jsonb_build_object('rodizio_sem_repetir', v_int);

  -- Prazo do primeiro contato calculado a partir de quem recebeu (1 min).
  select l.first_response_due_at = l.assigned_at + interval '1 minute'
     and l.assigned_at is not null
    into v_bool
  from public.leads l where l.id = lead1;
  r := r || jsonb_build_object('prazo_calculado', coalesce(v_bool, false));

  -- ---------------------------------------------------------------------------
  -- 2. Histórico alimentado por trigger
  -- ---------------------------------------------------------------------------
  select e.to_stage::text || '/' || coalesce(e.reason, 'sem')
    into v_text
  from public.lead_stage_events e
  where e.lead_id = lead1;
  r := r || jsonb_build_object('evento_de_criacao', v_text);

  select a.reason into v_text
  from public.lead_assignment_events a
  where a.lead_id = lead1;
  r := r || jsonb_build_object('evento_de_atribuicao', v_text);

  -- ---------------------------------------------------------------------------
  -- 3. Limite diário e férias tiram o corretor da roda
  -- ---------------------------------------------------------------------------
  update public.lead_routing_members set daily_limit = 1 where organization_id = org;
  v_uuid := private.lead_routing_pick(org, now(), '{}'::uuid[]);
  r := r || jsonb_build_object('limite_diario_pula_corretor', v_uuid is null);
  update public.lead_routing_members set daily_limit = null where organization_id = org;

  update public.lead_routing_members
  set away_from = now() - interval '1 day', away_until = now() + interval '1 day'
  where organization_id = org and user_id in (u_b1, u_b2);
  v_uuid := private.lead_routing_pick(org, now(), '{}'::uuid[]);
  r := r || jsonb_build_object('ferias_pula_corretor', v_uuid = u_b3);
  update public.lead_routing_members
  set away_from = null, away_until = null
  where organization_id = org;

  -- ---------------------------------------------------------------------------
  -- 4. Plantão: fora da janela o lead espera; na janela ele é entregue
  -- ---------------------------------------------------------------------------
  -- Janela de 1 minuto num horário que com certeza já passou hoje (ou amanhã).
  insert into public.lead_routing_shifts (organization_id, member_id, weekday, start_minute, end_minute)
  select org, m.id, ((v_weekday + 1) % 7)::smallint, 600, 660
  from public.lead_routing_members m
  where m.organization_id = org;

  insert into public.leads (organization_id, name, phone, source, stage)
  values (org, 'Lead Fora de Hora', '11999990004', 'manual', 'new') returning id into lead_off;

  select l.assigned_to is null and l.routing_due_at is not null and l.routing_due_at > now()
    into v_bool
  from public.leads l where l.id = lead_off;
  r := r || jsonb_build_object('fora_do_plantao_enfileira', coalesce(v_bool, false));

  -- Abre a janela agora e roda a passada: o lead sai da fila de espera.
  update public.lead_routing_shifts
  set weekday = v_weekday,
      start_minute = greatest(v_minute - 30, 0)::smallint,
      end_minute = least(v_minute + 30, 1440)::smallint
  where organization_id = org;
  update public.leads set routing_due_at = now() - interval '1 second' where id = lead_off;

  res := private.run_lead_routing_pass(100);

  select l.assigned_to is not null and l.routing_due_at is null
    into v_bool
  from public.leads l where l.id = lead_off;
  r := r || jsonb_build_object('janela_aberta_entrega', coalesce(v_bool, false));

  delete from public.lead_routing_shifts where organization_id = org;

  -- ---------------------------------------------------------------------------
  -- 5. SLA: aviso antes de estourar e redistribuição depois
  -- ---------------------------------------------------------------------------
  insert into public.leads (organization_id, name, phone, source, stage)
  values (org, 'Lead Do Prazo', '11999990005', 'manual', 'new') returning id into lead_sla;

  select l.assigned_to into v_uuid from public.leads l where l.id = lead_sla;

  -- Já passou de 50% do prazo, mas ainda não estourou.
  update public.leads
  set assigned_at = now() - interval '40 seconds',
      first_response_due_at = now() + interval '20 seconds'
  where id = lead_sla;

  res := private.run_lead_routing_pass(100);
  r := r || jsonb_build_object('aviso_de_prazo', (res ->> 'warned')::integer);

  res := private.run_lead_routing_pass(100);
  r := r || jsonb_build_object('aviso_so_uma_vez', (res ->> 'warned')::integer);

  -- Agora o prazo estourou.
  update public.leads
  set assigned_at = now() - interval '2 minutes',
      first_response_due_at = now() - interval '1 minute'
  where id = lead_sla;

  res := private.run_lead_routing_pass(100);
  r := r || jsonb_build_object('redistribuiu', (res ->> 'reassigned')::integer);

  select l.assigned_to <> v_uuid and l.sla_reassignments = 1 and l.sla_warned_at is null
    into v_bool
  from public.leads l where l.id = lead_sla;
  r := r || jsonb_build_object('novo_responsavel_diferente', coalesce(v_bool, false));

  select a.reason into v_text
  from public.lead_assignment_events a
  where a.lead_id = lead_sla
  order by a.created_at desc, a.id desc
  limit 1;
  r := r || jsonb_build_object('motivo_da_redistribuicao', v_text);

  r := r || jsonb_build_object('aviso_perdeu_o_lead', exists (
    select 1 from private.lead_notifications n
    where n.lead_id = lead_sla and n.user_id = v_uuid and n.kind = 'sla_lost'
  ));
  r := r || jsonb_build_object('aviso_recebeu_por_sla', exists (
    select 1 from private.lead_notifications n
    where n.lead_id = lead_sla and n.kind = 'sla_reassigned'
  ));

  -- Teto de redistribuições (max_reassignments = 1): não gira de novo.
  update public.leads
  set assigned_at = now() - interval '2 minutes',
      first_response_due_at = now() - interval '1 minute'
  where id = lead_sla;
  res := private.run_lead_routing_pass(100);
  r := r || jsonb_build_object('teto_de_redistribuicoes', (res ->> 'reassigned')::integer);

  -- Contato registrado encerra o prazo.
  update public.leads set last_contact_at = now(), stage = 'contacted' where id = lead_sla;
  select l.first_response_due_at is null into v_bool
  from public.leads l where l.id = lead_sla;
  r := r || jsonb_build_object('contato_zera_o_prazo', coalesce(v_bool, false));

  select e.from_stage::text || '>' || e.to_stage::text into v_text
  from public.lead_stage_events e
  where e.lead_id = lead_sla and e.from_stage is not null
  order by e.created_at desc, e.id desc
  limit 1;
  r := r || jsonb_build_object('historico_de_etapa', v_text);

  -- ---------------------------------------------------------------------------
  -- 6. Fila de avisos: reivindicar e confirmar
  -- ---------------------------------------------------------------------------
  select count(*)::integer into v_int
  from public.claim_lead_notifications(key, 50) c
  where c.organization_id = org;
  r := r || jsonb_build_object('fila_de_avisos_reivindicada', v_int > 0);

  select coalesce(array_agg(n.id), '{}'::uuid[]) into v_ids
  from private.lead_notifications n
  where n.organization_id = org and n.claimed_at is not null and n.sent_at is null;

  res := public.settle_lead_notifications(key, v_ids, '{}'::uuid[]);
  r := r || jsonb_build_object(
    'fila_de_avisos_confirmada',
    (res ->> 'sent')::integer = cardinality(v_ids) and cardinality(v_ids) > 0
  );

  -- ---------------------------------------------------------------------------
  -- 7. Reatribuição em massa
  -- ---------------------------------------------------------------------------
  update public.leads set assigned_to = u_b1
  where organization_id = org and stage not in ('won', 'lost');

  res := public.bulk_reassign_leads(org, u_b1, u_b2, false);
  r := r || jsonb_build_object(
    'transferencia_em_massa',
    (res ->> 'mode') = 'transfer'
      and (res ->> 'moved')::integer > 0
      and not exists (
        select 1 from public.leads l
        where l.organization_id = org and l.assigned_to = u_b1 and l.stage not in ('won', 'lost')
      )
  );

  res := public.bulk_reassign_leads(org, u_b2, null, false);
  r := r || jsonb_build_object(
    'devolucao_para_a_roleta',
    (res ->> 'mode') = 'roulette' and (res ->> 'moved')::integer > 0
  );

  -- ---------------------------------------------------------------------------
  -- 8. Painel e métricas (agregação toda no banco)
  -- ---------------------------------------------------------------------------
  res := public.get_lead_routing_overview(org);
  r := r || jsonb_build_object(
    'painel_do_rodizio',
    (res #>> '{settings,roulette_enabled}')::boolean
      and jsonb_array_length(res -> 'members') = 3
      and (res #>> '{totals,leads_today}')::integer >= 5
  );

  res := public.get_lead_stage_metrics(org, 30);
  r := r || jsonb_build_object(
    'metricas_por_etapa',
    jsonb_array_length(res -> 'stages') >= 1
      and (res #>> '{totals,leads}')::integer >= 5
  );

  -- ---------------------------------------------------------------------------
  -- 9. Permissões
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  begin
    perform public.get_lead_routing_overview(org);
    r := r || jsonb_build_object('estranho_no_painel', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('estranho_no_painel', 'NEGADO:' || sqlstate);
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_b1, 'role', 'authenticated')::text, true);

  begin
    execute 'set local role authenticated';
    begin
      update public.lead_routing_settings set roulette_enabled = false where organization_id = org;
      if found then
        r := r || jsonb_build_object('corretor_edita_config', 'PASSOU');
      else
        r := r || jsonb_build_object('corretor_edita_config', 'NEGADO:42501');
      end if;
    exception when others then
      r := r || jsonb_build_object('corretor_edita_config', 'NEGADO:' || sqlstate);
    end;

    begin
      insert into public.lead_stage_events (organization_id, lead_id, to_stage)
      values (org, lead1, 'won');
      r := r || jsonb_build_object('corretor_escreve_historico', 'PASSOU');
    exception when others then
      r := r || jsonb_build_object('corretor_escreve_historico', 'NEGADO:' || sqlstate);
    end;

    begin
      perform public.claim_lead_notifications('chave-errada', 10);
      r := r || jsonb_build_object('rpc_avisos_sem_chave', 'PASSOU');
    exception when others then
      r := r || jsonb_build_object('rpc_avisos_sem_chave', 'NEGADO:' || sqlstate);
    end;

    execute 'reset role';
  exception when others then
    execute 'reset role';
    r := r || jsonb_build_object('permissoes_erro', sqlstate);
  end;

  r := r || jsonb_build_object(
    'grant_roleta_anon',
    has_function_privilege('anon', 'public.assign_lead_from_roulette(uuid, uuid)', 'execute')
  );
  r := r || jsonb_build_object(
    'grant_roleta_authenticated',
    has_function_privilege('authenticated', 'public.assign_lead_from_roulette(uuid, uuid)', 'execute')
  );

  raise exception 'RESULTADO: %', jsonb_pretty(r);
end;
$$;
