-- =============================================================================
-- Teste da cota diária de e-mail com prioridade (20260917135409)
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto (ou pelo MCP execute_sql).
--
-- Os tetos são relativos ao uso real de hoje (base), então o teste funciona
-- mesmo com e-mails de verdade já contados no dia.
--
-- Resultado esperado:
--   resumo_1_reservado / resumo_2_reservado  : true / true
--   resumo_3_negado_pelo_teto                 : false
--   lead_passa_acima_do_teto_do_resumo        : true
--   falha_devolve_a_reserva                   : true
--   contador_resumo                           : "1:1:1:1" (reservado:enviado:falhou:negado)
--   painel_dono                               : 2 (1 cota + 1 limite do provedor)
--   painel_motivos                            : "daily_quota,rate_limited"
--   painel_depois_da_repescagem               : 1
--   painel_corretor / painel_estranho         : 0 / 0
--   console_prioridade_5_enviados             : 2
--   console_imobiliarias_afetadas_min_1       : true
--   chave_errada / prioridade_invalida / motivo_invalido : "42501" / "22023" / "22023"
--   grants_anon_ok / grants_authenticated_ok  : true / true
--   politicas_restritivas                     : 2
--   semanal_sem_teto_de_20                    : true
-- =============================================================================
do $$
declare
  key text;
  pkey text;
  u_owner uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  org uuid;
  slug text := 'teste-cota-email-prioridade';
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  base integer;
  k1 uuid := gen_random_uuid();
  k2 uuid := gen_random_uuid();
  k3 uuid := gen_random_uuid();
  k4 uuid := gen_random_uuid();
  k5 uuid := gen_random_uuid();
  r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb; r5 jsonb;
  v_text text;
  v_int integer;
  console jsonb;
  r jsonb := '{}'::jsonb;
begin
  select ds.decrypted_secret into key
  from vault.decrypted_secrets ds where ds.name = 'notification_server_key';
  select ds.decrypted_secret into pkey
  from vault.decrypted_secrets ds where ds.name = 'platform_server_key';

  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-cota-dono@exemplo.invalid', now(), now(), now()),
    (u_broker, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-cota-corretor@exemplo.invalid', now(), now(), now()),
    (u_stranger, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-cota-estranho@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Cota', slug);
  select o.slug into slug from public.organizations o where o.id = org;

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_broker, 'broker', true);

  perform set_config('request.jwt.claims', '', true);

  select coalesce(sum(q.reserved + q.sent), 0)::integer into base
  from private.email_daily_quota q where q.day = v_today;

  -- Classe 5 (resumo) com teto base+2: duas reservas passam, a terceira não.
  r1 := public.reserve_email_send(key, 5, base + 2, 'daily_digest', k1, slug);
  r2 := public.reserve_email_send(key, 5, base + 2, 'daily_digest', k2, slug);
  r3 := public.reserve_email_send(key, 5, base + 2, 'daily_digest', k3, slug);
  -- Classe 1 (lead) tem teto maior: ainda passa.
  r4 := public.reserve_email_send(key, 1, base + 3, 'new_lead', k4, slug);

  perform public.settle_email_send(key, v_today, 5, 'daily_digest', k1, slug, true, null);
  perform public.settle_email_send(key, v_today, 5, 'daily_digest', k2, slug, false, 'rate_limited');
  perform public.settle_email_send(key, v_today, 1, 'new_lead', k4, slug, true, null);

  -- A falha devolveu a reserva: com o mesmo teto (base+3) cabe mais um.
  r5 := public.reserve_email_send(key, 5, base + 3, 'daily_digest', k5, slug);

  r := r || jsonb_build_object(
    'resumo_1_reservado', r1 -> 'ok',
    'resumo_2_reservado', r2 -> 'ok',
    'resumo_3_negado_pelo_teto', r3 -> 'ok',
    'lead_passa_acima_do_teto_do_resumo', r4 -> 'ok',
    'falha_devolve_a_reserva', r5 -> 'ok'
  );

  select format('%s:%s:%s:%s', q.reserved, q.sent, q.failed, q.denied) into v_text
  from private.email_daily_quota q where q.day = v_today and q.priority = 5;
  r := r || jsonb_build_object('contador_resumo', v_text);

  -- Painel: dono vê contagens; corretor e estranho, nada.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  select coalesce(sum(d.notices), 0)::integer, string_agg(d.reason, ',' order by d.reason)
    into v_int, v_text
  from public.dashboard_undelivered_emails(org) d;
  r := r || jsonb_build_object('painel_dono', v_int, 'painel_motivos', v_text);

  -- Repescagem: o aviso negado (k3) sai numa nova tentativa e some do cartão.
  perform set_config('request.jwt.claims', '', true);
  perform public.reserve_email_send(key, 5, base + 100, 'daily_digest', k3, slug);
  perform public.settle_email_send(key, v_today, 5, 'daily_digest', k3, slug, true, null);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  select coalesce(sum(d.notices), 0)::integer into v_int from public.dashboard_undelivered_emails(org) d;
  r := r || jsonb_build_object('painel_depois_da_repescagem', v_int);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  select count(*)::integer into v_int from public.dashboard_undelivered_emails(org);
  r := r || jsonb_build_object('painel_corretor', v_int);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  select count(*)::integer into v_int from public.dashboard_undelivered_emails(org);
  r := r || jsonb_build_object('painel_estranho', v_int);
  perform set_config('request.jwt.claims', '', true);

  -- Console: contagens globais.
  console := public.platform_email_quota(pkey);
  r := r || jsonb_build_object(
    'console_prioridade_5_enviados', (
      select (x ->> 'sent')::integer
      from jsonb_array_elements(console -> 'by_priority') x
      where (x ->> 'priority')::integer = 5
    ),
    'console_imobiliarias_afetadas_min_1', (console ->> 'undelivered_organizations')::integer >= 1
  );

  -- Validações.
  begin
    perform public.reserve_email_send('chave-errada', 1, 10, 'new_lead', gen_random_uuid(), null);
    r := r || jsonb_build_object('chave_errada', 'passou');
  exception when others then
    r := r || jsonb_build_object('chave_errada', sqlstate);
  end;

  begin
    perform public.reserve_email_send(key, 7, 10, 'new_lead', gen_random_uuid(), null);
    r := r || jsonb_build_object('prioridade_invalida', 'passou');
  exception when others then
    r := r || jsonb_build_object('prioridade_invalida', sqlstate);
  end;

  begin
    perform public.settle_email_send(key, v_today, 1, 'new_lead', gen_random_uuid(), null, false, 'daily_quota');
    r := r || jsonb_build_object('motivo_invalido', 'passou');
  exception when others then
    r := r || jsonb_build_object('motivo_invalido', sqlstate);
  end;

  r := r || jsonb_build_object(
    'grants_anon_ok',
    has_function_privilege('anon', 'public.reserve_email_send(text, integer, integer, text, uuid, text)', 'execute')
      and has_function_privilege('anon', 'public.settle_email_send(text, date, integer, text, uuid, text, boolean, text)', 'execute')
      and has_function_privilege('anon', 'public.platform_email_quota(text)', 'execute')
      and not has_function_privilege('anon', 'public.dashboard_undelivered_emails(uuid)', 'execute'),
    'grants_authenticated_ok',
    has_function_privilege('authenticated', 'public.dashboard_undelivered_emails(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.reserve_email_send(text, integer, integer, text, uuid, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.settle_email_send(text, date, integer, text, uuid, text, boolean, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.platform_email_quota(text)', 'execute'),
    'politicas_restritivas', (
      select count(*)
      from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid = p.polrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'private'
        and c.relname in ('email_daily_quota', 'email_undelivered_notices')
        and not p.polpermissive
        and c.relrowsecurity
    ),
    'semanal_sem_teto_de_20',
    position('limit 500) x' in pg_get_functiondef('public.claim_weekly_reports(text, integer, uuid)'::regprocedure)) > 0
      and position('limit 20) x' in pg_get_functiondef('public.claim_weekly_reports(text, integer, uuid)'::regprocedure)) = 0
  );

  raise exception 'TESTE cota de e-mail (rollback): %', jsonb_pretty(r);
end;
$$;
