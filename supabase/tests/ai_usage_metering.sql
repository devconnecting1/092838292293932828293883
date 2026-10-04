-- =============================================================================
-- Teste da medição e do corte de IA (tetos, franquia, janelas e permissões)
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- A imobiliária de teste usa o plano Imobiliária (teto de R$ 34,56 por ciclo,
-- migração ai_trial_without_ai_model_pricing_batch) com a franquia reduzida para
-- 3 conversas, só para o corte acontecer rápido. As chamadas usam a assinatura
-- antiga (sem p_model/p_batch), que continua valendo e mede como Sonnet 5.
--
-- Resultado esperado (ordem das chaves pode variar):
--   ciclo_de_um_mes                : true
--   reserva_1                      : "true/1"      (permitida, 1 conversa)
--   acerto_1                       : true
--   acerto_repetido                : "already_settled"
--   mesma_conversa_24h             : "true/1"      (não consome franquia nova)
--   avulsa_conta_1                 : "true/2"
--   dedup_devolve_resposta         : "texto guardado"
--   dedup_nao_cobra                : true
--   requisicao_grande              : "request_too_large"
--   ultima_da_franquia             : "true/3"
--   franquia_cheia                 : "quota_exhausted"
--   aviso_100                      : "100"
--   aviso_100_so_uma_vez           : "NULL"
--   excedente_recusado             : "NEGADO:23514" (travado em zero)
--   teto_do_ciclo                  : "cycle_cost_cap"
--   teto_do_dia                    : "daily_cost_cap"
--   teto_da_semana                 : "weekly_cost_cap"
--   rajada_por_usuario             : "rate_limited_user"
--   rajada_por_organizacao         : "rate_limited_organization"
--   assinatura_cancelada           : "billing_blocked"
--   sessao_le_consumo              : true
--   sessao_escreve_consumo         : "NEGADO:42501"
--   sessao_le_reservas             : "NEGADO:42501"
--   dono_define_teto_zero          : true
--   dono_liga_excedente            : "NEGADO:22023" (sem cobrança, sem excedente)
--   estranho_define_teto           : "NEGADO:42501"
--   teto_acima_do_maximo           : "NEGADO:22023"
--   rpc_sem_chave                  : "NEGADO:42501"
--   grant_reserve_anon             : true
--   grant_reserve_authenticated    : false

do $$
declare
  r jsonb := '{}'::jsonb;
  key text;
  u_owner uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  org uuid;
  contato_a text := repeat('a', 64);
  contato_b text := repeat('b', 64);
  contato_c text := repeat('c', 64);
  hash_pedido text := repeat('d', 64);
  ctx record;
  res jsonb;
  res2 jsonb;
  reserva uuid;
  v text;
  i integer;
begin
  select ds.decrypted_secret into key
  from vault.decrypted_secrets ds
  where ds.name = 'billing_server_key';

  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-ia-dono@exemplo.invalid', now(), now()),
    (u_stranger, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-ia-estranho@exemplo.invalid', now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste IA', 'teste-ia-medicao');

  -- Plano pago, ciclo aberto e franquia curta (3 conversas).
  update public.billing_accounts
  set status = 'active',
      plan_key = 'imobiliaria',
      billing_interval = 'month',
      current_period_end = now() + interval '20 days',
      limits = limits || '{"ai_conversations": 3}'::jsonb
  where organization_id = org;

  -- ---------------------------------------------------------------------------
  -- 1. Ciclo mensal ancorado na assinatura
  -- ---------------------------------------------------------------------------
  select * into ctx from private.ai_quota_context(org, now());
  r := r || jsonb_build_object(
    'ciclo_de_um_mes',
    ctx.period_end = ctx.period_start + interval '1 month'
      and now() >= ctx.period_start and now() < ctx.period_end);

  -- ---------------------------------------------------------------------------
  -- 2. Reserva, acerto e janela de 24 h por contato
  -- ---------------------------------------------------------------------------
  res := public.reserve_ai_usage(key, org, 'conversation', 1, null, contato_a, null, 600, 250, 0, 2000);
  reserva := (res ->> 'reservation_id')::uuid;
  r := r || jsonb_build_object('reserva_1',
    (res ->> 'allowed') || '/' || (res ->> 'conversations_used'));

  res2 := public.settle_ai_usage(key, org, reserva, 620, 240, 0, 2000, 'ok', null);
  r := r || jsonb_build_object('acerto_1', (res2 ->> 'settled')::boolean);

  res2 := public.settle_ai_usage(key, org, reserva, 620, 240, 0, 2000, 'ok', null);
  r := r || jsonb_build_object('acerto_repetido', res2 ->> 'reason');

  -- Mesmo contato dentro das 24 h: não abre conversa nova.
  res := public.reserve_ai_usage(key, org, 'conversation', 1, null, contato_a, null, 600, 250, 2000, 0);
  r := r || jsonb_build_object('mesma_conversa_24h',
    (res ->> 'allowed') || '/' || (res ->> 'conversations_used'));

  -- ---------------------------------------------------------------------------
  -- 3. Requisição avulsa, deduplicação e tamanho máximo
  -- ---------------------------------------------------------------------------
  res := public.reserve_ai_usage(key, org, 'listing_copy', 1, null, null, hash_pedido, 1500, 500, 0, 0);
  reserva := (res ->> 'reservation_id')::uuid;
  r := r || jsonb_build_object('avulsa_conta_1',
    (res ->> 'allowed') || '/' || (res ->> 'conversations_used'));
  perform public.settle_ai_usage(key, org, reserva, 1500, 480, 0, 0, 'ok', 'texto guardado');

  select p.cost_millicents into i from public.ai_usage_periods p
  where p.organization_id = org and p.period_start = ctx.period_start;

  res := public.reserve_ai_usage(key, org, 'listing_copy', 1, null, null, hash_pedido, 1500, 500, 0, 0);
  r := r || jsonb_build_object('dedup_devolve_resposta', res ->> 'response');

  r := r || jsonb_build_object('dedup_nao_cobra', (
    select p.cost_millicents = i from public.ai_usage_periods p
    where p.organization_id = org and p.period_start = ctx.period_start));

  res := public.reserve_ai_usage(key, org, 'listing_copy', 1, null, null, null, 50000, 500, 0, 0);
  r := r || jsonb_build_object('requisicao_grande', res ->> 'reason');

  -- ---------------------------------------------------------------------------
  -- 4. Franquia: última liberada, próxima bloqueada, aviso de 100% uma vez só
  -- ---------------------------------------------------------------------------
  res := public.reserve_ai_usage(key, org, 'conversation', 1, null, contato_b, null, 600, 250, 0, 2000);
  r := r || jsonb_build_object('ultima_da_franquia',
    (res ->> 'allowed') || '/' || (res ->> 'conversations_used'));
  r := r || jsonb_build_object('aviso_100', coalesce(res ->> 'notify', 'NULL'));

  res := public.reserve_ai_usage(key, org, 'conversation', 1, null, contato_c, null, 600, 250, 0, 2000);
  r := r || jsonb_build_object('franquia_cheia', res ->> 'reason');
  r := r || jsonb_build_object('aviso_100_so_uma_vez', coalesce(res ->> 'notify', 'NULL'));

  -- ---------------------------------------------------------------------------
  -- 5. Excedente travado em zero e teto do ciclo como limite absoluto
  -- ---------------------------------------------------------------------------
  -- Sem cobrança do excedente, o banco recusa qualquer valor diferente de zero.
  begin
    update public.billing_accounts set ai_overage_cap_cents = 1000 where organization_id = org;
    r := r || jsonb_build_object('excedente_recusado', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('excedente_recusado', 'NEGADO:' || sqlstate);
  end;

  -- Franquia liberada para o corte vir só do teto em reais.
  update public.billing_accounts
  set limits = limits || '{"ai_conversations": -1}'::jsonb
  where organization_id = org;

  update public.ai_usage_periods
  set cost_millicents = private.ai_cost_cap_cents('imobiliaria')::bigint * 1000
  where organization_id = org and period_start = ctx.period_start;

  res := public.reserve_ai_usage(key, org, 'conversation', 1, null, contato_c, null, 600, 250, 0, 2000);
  r := r || jsonb_build_object('teto_do_ciclo', res ->> 'reason');

  -- ---------------------------------------------------------------------------
  -- 6. Janelas curtas: dia e semana bloqueiam sozinhas
  -- ---------------------------------------------------------------------------
  update public.ai_usage_periods
  set cost_millicents = 0,
      day_start = (now() at time zone 'America/Sao_Paulo')::date,
      day_cost_millicents = (private.ai_daily_cap_cents(private.ai_cost_cap_cents('imobiliaria')))::bigint * 1000,
      week_start = (date_trunc('week', now() at time zone 'America/Sao_Paulo'))::date,
      week_cost_millicents = 0
  where organization_id = org and period_start = ctx.period_start;

  res := public.reserve_ai_usage(key, org, 'conversation', 1, null, contato_c, null, 600, 250, 0, 2000);
  r := r || jsonb_build_object('teto_do_dia', res ->> 'reason');

  update public.ai_usage_periods
  set day_cost_millicents = 0,
      week_cost_millicents = (private.ai_weekly_cap_cents(private.ai_cost_cap_cents('imobiliaria')))::bigint * 1000
  where organization_id = org and period_start = ctx.period_start;

  res := public.reserve_ai_usage(key, org, 'conversation', 1, null, contato_c, null, 600, 250, 0, 2000);
  r := r || jsonb_build_object('teto_da_semana', res ->> 'reason');

  -- ---------------------------------------------------------------------------
  -- 7. Rajada por usuário e por organização
  -- ---------------------------------------------------------------------------
  update public.ai_usage_periods
  set cost_millicents = 0, day_cost_millicents = 0, week_cost_millicents = 0
  where organization_id = org and period_start = ctx.period_start;
  delete from private.ai_usage_requests where organization_id = org;

  for i in 1..4 loop
    perform public.reserve_ai_usage(key, org, 'reply_suggestion', 1, u_owner, null, null, 600, 250, 0, 0);
  end loop;

  res := public.reserve_ai_usage(key, org, 'reply_suggestion', 1, u_owner, null, null, 600, 250, 0, 0);
  r := r || jsonb_build_object('rajada_por_usuario', res ->> 'reason');

  delete from private.ai_usage_requests where organization_id = org;

  for i in 1..10 loop
    perform public.reserve_ai_usage(key, org, 'reply_suggestion', 1, null, null, null, 600, 250, 0, 0);
  end loop;

  res := public.reserve_ai_usage(key, org, 'reply_suggestion', 1, null, null, null, 600, 250, 0, 0);
  r := r || jsonb_build_object('rajada_por_organizacao', res ->> 'reason');

  -- ---------------------------------------------------------------------------
  -- 8. Assinatura fora de trialing/active: IA bloqueada
  -- ---------------------------------------------------------------------------
  delete from private.ai_usage_requests where organization_id = org;
  update public.billing_accounts set status = 'canceled' where organization_id = org;

  res := public.reserve_ai_usage(key, org, 'listing_copy', 1, null, null, null, 600, 250, 0, 0);
  r := r || jsonb_build_object('assinatura_cancelada', res ->> 'reason');

  update public.billing_accounts set status = 'active' where organization_id = org;

  -- ---------------------------------------------------------------------------
  -- 9. Permissões com sessão de usuário
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    execute 'select count(*)::text from public.ai_usage_periods where organization_id = $1'
      into v using org;
    r := r || jsonb_build_object('sessao_le_consumo', v::integer > 0);
  exception when others then
    r := r || jsonb_build_object('sessao_le_consumo', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'insert into public.ai_usage_periods (organization_id, period_start, period_end)
             values ($1, now() - interval ''2 months'', now() - interval ''1 month'')' using org;
    r := r || jsonb_build_object('sessao_escreve_consumo', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('sessao_escreve_consumo', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'select count(*)::text from private.ai_usage_requests' into v;
    r := r || jsonb_build_object('sessao_le_reservas', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('sessao_le_reservas', 'NEGADO:' || sqlstate);
  end;

  begin
    r := r || jsonb_build_object('dono_define_teto_zero',
      public.set_ai_overage_cap(org, 0) = 0);
  exception when others then
    r := r || jsonb_build_object('dono_define_teto_zero', 'NEGADO:' || sqlstate);
  end;

  begin
    perform public.set_ai_overage_cap(org, 2500);
    r := r || jsonb_build_object('dono_liga_excedente', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('dono_liga_excedente', 'NEGADO:' || sqlstate);
  end;

  begin
    perform public.set_ai_overage_cap(org, 999999999);
    r := r || jsonb_build_object('teto_acima_do_maximo', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('teto_acima_do_maximo', 'NEGADO:' || sqlstate);
  end;

  begin
    perform public.reserve_ai_usage(null, org, 'listing_copy');
    r := r || jsonb_build_object('rpc_sem_chave', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('rpc_sem_chave', 'NEGADO:' || sqlstate);
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);

  begin
    perform public.set_ai_overage_cap(org, 100);
    r := r || jsonb_build_object('estranho_define_teto', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('estranho_define_teto', 'NEGADO:' || sqlstate);
  end;

  reset role;

  -- ---------------------------------------------------------------------------
  -- 10. Grants das RPCs do servidor
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object('grant_reserve_anon', has_function_privilege(
    'anon',
    'public.reserve_ai_usage(text, uuid, text, integer, uuid, text, text, integer, integer, integer, integer, text, boolean)',
    'execute'));
  r := r || jsonb_build_object('grant_reserve_authenticated', has_function_privilege(
    'authenticated',
    'public.reserve_ai_usage(text, uuid, text, integer, uuid, text, text, integer, integer, integer, integer, text, boolean)',
    'execute'));

  raise exception 'TESTE DE IA (rollback): %', jsonb_pretty(r);
end;
$$;
