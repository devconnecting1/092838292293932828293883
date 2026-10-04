-- =============================================================================
-- Teste do rodízio no lead que chega pela landing page (submit_landing_lead)
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- O que está sendo garantido:
--   * com o rodízio DESLIGADO nada muda: vale o responsável fixo da página
--     (`landing_pages.lead_assignee_id`), que é o comportamento de hoje;
--   * com o rodízio LIGADO e alguém de plantão, quem decide é a roleta, e o
--     histórico registra o canal (`landing_page`) e o motivo (`roulette`);
--   * sem ninguém de plantão e com `fallback_to_page_assignee`, o lead cai no
--     responsável fixo da página em vez de ficar sem dono;
--   * sem esse fallback, o lead espera a próxima janela (`routing_due_at`).
--
-- Resultado esperado (a ordem das chaves pode variar):
--   rodizio_desligado_usa_fixo     : "fixo"
--   rodizio_ligado_usa_roleta      : "b1"
--   motivo_landing_roleta          : "roulette"
--   canal_no_historico             : "landing_page"
--   sem_plantao_cai_no_fixo        : "fixo"
--   sem_fallback_vai_para_fila     : "fila"

do $$
declare
  r jsonb := '{}'::jsonb;
  lead_key text;
  u_owner uuid := gen_random_uuid();
  u_b1 uuid := gen_random_uuid();
  u_fixo uuid := gen_random_uuid();
  org uuid;
  page uuid;
  m1 uuid;
  v_weekday smallint;
  v_minute integer;
  v_text text;
begin
  select ds.decrypted_secret into lead_key
  from vault.decrypted_secrets ds
  where ds.name = 'lead_server_key';

  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-lp-dono@exemplo.invalid', now(), now(), now()),
    (u_b1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-lp-b1@exemplo.invalid', now(), now(), now()),
    (u_fixo, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-lp-fixo@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste LP', 'teste-rodizio-landing');

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_b1, 'broker', true), (org, u_fixo, 'broker', true);

  -- Modelo sem imóveis obrigatórios, para o teste não depender de cadastro.
  insert into public.landing_pages (
    organization_id, template, name, slug, status, published_at, lead_assignee_id, content
  )
  values (
    org, 'campaign_valuation', 'Campanha Teste', 'campanha-teste', 'published', now(), u_fixo,
    jsonb_build_object('headline', 'Avalie seu imovel', 'cta_label', 'Quero avaliar')
  )
  returning id into page;

  -- ---------------------------------------------------------------------------
  -- 1. Rodízio desligado: responsável fixo da página (comportamento de hoje)
  -- ---------------------------------------------------------------------------
  perform public.submit_landing_lead('teste-rodizio-landing', 'campanha-teste',
    jsonb_build_object('name', 'Visitante Um', 'phone', '11988880001', 'consent', 'true'),
    lead_key, repeat('n', 32), null);

  select case l.assigned_to when u_fixo then 'fixo' when u_b1 then 'b1' else 'sem' end
    into v_text
  from public.leads l
  where l.organization_id = org and l.name = 'Visitante Um';
  r := r || jsonb_build_object('rodizio_desligado_usa_fixo', v_text);

  -- ---------------------------------------------------------------------------
  -- 2. Rodízio ligado, corretor de plantão: a roleta manda
  -- ---------------------------------------------------------------------------
  insert into public.lead_routing_settings (organization_id, roulette_enabled, sla_minutes)
  values (org, true, 5);

  insert into public.lead_routing_members (organization_id, user_id)
  values (org, u_b1)
  returning id into m1;

  perform public.submit_landing_lead('teste-rodizio-landing', 'campanha-teste',
    jsonb_build_object('name', 'Visitante Dois', 'phone', '11988880002', 'consent', 'true'),
    lead_key, repeat('o', 32), null);

  select case l.assigned_to when u_fixo then 'fixo' when u_b1 then 'b1' else 'sem' end
    into v_text
  from public.leads l
  where l.organization_id = org and l.name = 'Visitante Dois';
  r := r || jsonb_build_object('rodizio_ligado_usa_roleta', v_text);

  select a.reason into v_text
  from public.lead_assignment_events a
  join public.leads l on l.id = a.lead_id
  where l.organization_id = org and l.name = 'Visitante Dois';
  r := r || jsonb_build_object('motivo_landing_roleta', v_text);

  select e.reason into v_text
  from public.lead_stage_events e
  join public.leads l on l.id = e.lead_id
  where l.organization_id = org and l.name = 'Visitante Dois';
  r := r || jsonb_build_object('canal_no_historico', v_text);

  -- ---------------------------------------------------------------------------
  -- 3. Ninguém de plantão: cai no responsável fixo da página
  -- ---------------------------------------------------------------------------
  select c.weekday, c.minute_of_day into v_weekday, v_minute
  from private.lead_routing_clock(now(), 'America/Sao_Paulo') c;

  -- Janela num dia da semana que não é hoje.
  insert into public.lead_routing_shifts (organization_id, member_id, weekday, start_minute, end_minute)
  values (org, m1, ((v_weekday + 3) % 7)::smallint, 600, 660);

  perform public.submit_landing_lead('teste-rodizio-landing', 'campanha-teste',
    jsonb_build_object('name', 'Visitante Tres', 'phone', '11988880003', 'consent', 'true'),
    lead_key, repeat('p', 32), null);

  select case l.assigned_to when u_fixo then 'fixo' when u_b1 then 'b1' else 'sem' end
    into v_text
  from public.leads l
  where l.organization_id = org and l.name = 'Visitante Tres';
  r := r || jsonb_build_object('sem_plantao_cai_no_fixo', v_text);

  -- ---------------------------------------------------------------------------
  -- 4. Sem fallback: o lead espera a próxima janela
  -- ---------------------------------------------------------------------------
  update public.lead_routing_settings
  set fallback_to_page_assignee = false
  where organization_id = org;

  perform public.submit_landing_lead('teste-rodizio-landing', 'campanha-teste',
    jsonb_build_object('name', 'Visitante Quatro', 'phone', '11988880004', 'consent', 'true'),
    lead_key, repeat('q', 32), null);

  select case
           when l.assigned_to is null and l.routing_due_at > now() then 'fila'
           else 'outro'
         end
    into v_text
  from public.leads l
  where l.organization_id = org and l.name = 'Visitante Quatro';
  r := r || jsonb_build_object('sem_fallback_vai_para_fila', v_text);

  raise exception 'RESULTADO: %', jsonb_pretty(r);
end;
$$;
