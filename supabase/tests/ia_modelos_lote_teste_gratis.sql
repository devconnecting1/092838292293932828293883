-- =============================================================================
-- Teste de IA: teste grátis sem IA, preço por modelo, Batch API e novos tetos
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- O que está sendo provado (migração ai_trial_without_ai_model_pricing_batch):
--   1. teste grátis (local e criado na Stripe) não tem IA: franquia 0, teto 0 e
--      reserve_ai_usage recusa com feature_unavailable sem criar linha de consumo;
--   2. custo por modelo (Sonnet 5 x Haiku 4.5) e com desconto da Batch API,
--      com os mesmos números do core (packages/core/src/billing/ai-usage.test.ts);
--   3. modelo desconhecido é recusado na conta, na reserva e no acerto (22023);
--   4. chamada antiga (sem p_model/p_batch) continua valendo e é medida como
--      Sonnet 5 sem lote; o acerto usa o modelo e o lote gravados na reserva;
--   5. tetos por plano (valores da migração plan_prices_increase_ai_caps, que
--      recalculou o teto depois do aumento de preço de 17/09/2026) e grants das
--      novas assinaturas.
--
-- Resultado esperado (ordem das chaves pode variar):
--   trial_defaults_sem_ia          : true
--   trial_contexto_zerado          : true
--   trial_local_recusado           : "feature_unavailable"
--   trial_nao_cria_consumo         : true
--   trial_stripe_recusado          : "feature_unavailable"
--   custo_sonnet_milhao_entrada    : 1133500
--   custo_haiku_milhao_entrada     : 566750
--   custo_sonnet_lote              : 566750
--   custo_haiku_lote_saida         : 1416875
--   conversa_tipica_sonnet         : 55293
--   avulsa_tipica_sonnet           : 7368
--   avulsa_tipica_haiku            : 3684
--   avulsa_tipica_sonnet_lote      : 3684
--   avulsa_tipica_haiku_lote       : 1842
--   sem_modelo_igual_sonnet        : true
--   custo_modelo_desconhecido      : "NEGADO:22023"
--   reserva_modelo_desconhecido    : "NEGADO:22023"
--   reserva_modelo_vazio           : "NEGADO:22023"
--   acerto_modelo_desconhecido     : "NEGADO:22023"
--   chamada_antiga_liberada        : true
--   chamada_antiga_grava_sonnet    : "claude-sonnet-5/false"
--   chamada_antiga_estimativa      : true
--   acerto_antigo_preco_sonnet     : true
--   reserva_haiku_lote             : "claude-haiku-4-5/true"
--   reserva_haiku_estima_menos     : true
--   acerto_usa_modelo_da_reserva   : true
--   acerto_troca_modelo            : true
--   teto_trial                     : 0
--   teto_corretor                  : 0
--   teto_imobiliaria               : 3456
--   teto_equipe                    : 13824
--   teto_rede                      : 34559
--   teto_desconhecido              : 0
--   contexto_imobiliaria_teto      : 3456000
--   assinatura_antiga_removida     : true
--   grant_reserve_anon             : true
--   grant_reserve_authenticated    : false
--   grant_settle_anon              : true
--   grant_settle_authenticated     : false
--   grant_pricing_anon             : false

do $$
declare
  r jsonb := '{}'::jsonb;
  key text;
  u_owner uuid := gen_random_uuid();
  org uuid;
  org_stripe uuid;
  ctx record;
  res jsonb;
  res2 jsonb;
  reserva uuid;
  pedido private.ai_usage_requests%rowtype;
  custo_antes bigint;
  custo_depois bigint;
begin
  select ds.decrypted_secret into key
  from vault.decrypted_secrets ds
  where ds.name = 'billing_server_key';

  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-ia-modelos@exemplo.invalid', now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);

  -- ---------------------------------------------------------------------------
  -- 1. Teste grátis sem IA
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object('trial_defaults_sem_ia',
    (select d.limits -> 'ai_conversations' = '0'::jsonb from private.billing_trial_defaults() d));

  -- Imobiliária nova começa no teste grátis local.
  org := public.create_organization('Imobiliaria Teste IA Modelos', 'teste-ia-modelos');

  select * into ctx from private.ai_quota_context(org, now());
  r := r || jsonb_build_object('trial_contexto_zerado',
    ctx.billing_state = 'trialing' and ctx.conversations_limit = 0
      and ctx.plan_cap_millicents = 0 and ctx.effective_cap_millicents = 0
      and ctx.day_cap_millicents = 0 and ctx.week_cap_millicents = 0);

  res := public.reserve_ai_usage(key, org, 'conversation', 1, null, repeat('a', 64), null, 600, 250, 0, 2000);
  r := r || jsonb_build_object('trial_local_recusado', res ->> 'reason');
  r := r || jsonb_build_object('trial_nao_cria_consumo',
    not exists (select 1 from public.ai_usage_periods p where p.organization_id = org)
      and not exists (select 1 from private.ai_usage_requests q where q.organization_id = org));

  -- Teste criado na Stripe num plano pago, com franquia gravada: também sem IA.
  org_stripe := public.create_organization('Imobiliaria Teste IA Stripe', 'teste-ia-modelos-stripe');

  update public.billing_accounts
  set status = 'trialing',
      plan_key = 'equipe',
      billing_interval = 'month',
      current_period_end = now() + interval '10 days',
      limits = limits || '{"ai_conversations": 200}'::jsonb
  where organization_id = org_stripe;

  res := public.reserve_ai_usage(key, org_stripe, 'listing_copy', 1, null, null, null, 1500, 500, 0, 0);
  r := r || jsonb_build_object('trial_stripe_recusado', res ->> 'reason');

  -- ---------------------------------------------------------------------------
  -- 2. Custo por modelo e Batch API (câmbio 5,6675)
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'custo_sonnet_milhao_entrada', private.ai_cost_millicents(1000000, 0, 0, 0, 'claude-sonnet-5', false),
    'custo_haiku_milhao_entrada', private.ai_cost_millicents(1000000, 0, 0, 0, 'claude-haiku-4-5', false),
    'custo_sonnet_lote', private.ai_cost_millicents(1000000, 0, 0, 0, 'claude-sonnet-5', true),
    'custo_haiku_lote_saida', private.ai_cost_millicents(0, 1000000, 0, 0, 'claude-haiku-4-5', true),
    -- Conversa típica do core: 1.200 entrada, 3.560 saída, 37.800 lidos, 20.800 gravados.
    'conversa_tipica_sonnet', private.ai_cost_millicents(1200, 3560, 37800, 20800, 'claude-sonnet-5', false),
    -- Avulsa típica do core: 2.000 entrada, 900 saída.
    'avulsa_tipica_sonnet', private.ai_cost_millicents(2000, 900, 0, 0, 'claude-sonnet-5', false),
    'avulsa_tipica_haiku', private.ai_cost_millicents(2000, 900, 0, 0, 'claude-haiku-4-5', false),
    'avulsa_tipica_sonnet_lote', private.ai_cost_millicents(2000, 900, 0, 0, 'claude-sonnet-5', true),
    'avulsa_tipica_haiku_lote', private.ai_cost_millicents(2000, 900, 0, 0, 'claude-haiku-4-5', true),
    'sem_modelo_igual_sonnet',
      private.ai_cost_millicents(2000, 900, 300, 400)
        = private.ai_cost_millicents(2000, 900, 300, 400, 'claude-sonnet-5', false)
  );

  -- ---------------------------------------------------------------------------
  -- 3. Modelo desconhecido é recusado (nunca subcobrar)
  -- ---------------------------------------------------------------------------
  begin
    perform private.ai_cost_millicents(1000, 0, 0, 0, 'claude-inexistente', false);
    r := r || jsonb_build_object('custo_modelo_desconhecido', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('custo_modelo_desconhecido', 'NEGADO:' || sqlstate);
  end;

  -- Plano pago e ativo para as reservas passarem pelo corte do teste grátis.
  update public.billing_accounts
  set status = 'active',
      plan_key = 'imobiliaria',
      billing_interval = 'month',
      current_period_end = now() + interval '20 days',
      limits = limits || '{"ai_conversations": 50}'::jsonb
  where organization_id = org;

  begin
    perform public.reserve_ai_usage(key, org, 'reply_suggestion', 1, null, null, null,
      600, 250, 0, 0, 'gpt-4o', false);
    r := r || jsonb_build_object('reserva_modelo_desconhecido', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('reserva_modelo_desconhecido', 'NEGADO:' || sqlstate);
  end;

  begin
    perform public.reserve_ai_usage(key, org, 'reply_suggestion', 1, null, null, null,
      600, 250, 0, 0, '', false);
    r := r || jsonb_build_object('reserva_modelo_vazio', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('reserva_modelo_vazio', 'NEGADO:' || sqlstate);
  end;

  -- ---------------------------------------------------------------------------
  -- 4. Compatibilidade da chamada antiga e acerto pelo modelo da reserva
  -- ---------------------------------------------------------------------------
  -- Exatamente os 11 argumentos da assinatura antiga.
  res := public.reserve_ai_usage(key, org, 'listing_copy', 1, null, null, null, 1500, 500, 0, 0);
  reserva := (res ->> 'reservation_id')::uuid;
  select * into pedido from private.ai_usage_requests q where q.id = reserva;

  r := r || jsonb_build_object(
    'chamada_antiga_liberada', (res ->> 'allowed')::boolean,
    'chamada_antiga_grava_sonnet', pedido.model || '/' || pedido.batch::text,
    'chamada_antiga_estimativa',
      pedido.estimated_millicents = greatest(
        private.ai_cost_millicents(1500, 500, 0, 0, 'claude-sonnet-5', false),
        (select l.min_reservation_millicents from private.ai_limits() l))
  );

  begin
    perform public.settle_ai_usage(key, org, reserva, 1500, 480, 0, 0, 'ok', null, 'modelo-falso', null);
    r := r || jsonb_build_object('acerto_modelo_desconhecido', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('acerto_modelo_desconhecido', 'NEGADO:' || sqlstate);
  end;

  select p.cost_millicents into custo_antes
  from public.ai_usage_periods p where p.organization_id = org;

  -- Exatamente os 9 argumentos da assinatura antiga.
  res2 := public.settle_ai_usage(key, org, reserva, 1500, 480, 0, 0, 'ok', null);

  select p.cost_millicents into custo_depois
  from public.ai_usage_periods p where p.organization_id = org;

  r := r || jsonb_build_object('acerto_antigo_preco_sonnet',
    (res2 ->> 'model') = 'claude-sonnet-5'
      and custo_depois - custo_antes
        = private.ai_cost_millicents(1500, 480, 0, 0, 'claude-sonnet-5', false) - pedido.estimated_millicents);

  -- Haiku 4.5 pela Batch API: grava modelo e lote e estima menos que o Sonnet 5.
  res := public.reserve_ai_usage(key, org, 'conversation_summary', 1, null, null, null,
    6000, 1200, 0, 0, 'claude-haiku-4-5', true);
  reserva := (res ->> 'reservation_id')::uuid;
  select * into pedido from private.ai_usage_requests q where q.id = reserva;

  r := r || jsonb_build_object(
    'reserva_haiku_lote', pedido.model || '/' || pedido.batch::text,
    'reserva_haiku_estima_menos',
      pedido.estimated_millicents = private.ai_cost_millicents(6000, 1200, 0, 0, 'claude-haiku-4-5', true)
        and pedido.estimated_millicents < private.ai_cost_millicents(6000, 1200, 0, 0, 'claude-sonnet-5', false)
  );

  -- Acerto sem modelo: vale o modelo e o lote gravados na reserva.
  select p.cost_millicents into custo_antes
  from public.ai_usage_periods p where p.organization_id = org;

  res2 := public.settle_ai_usage(key, org, reserva, 6000, 1100, 0, 0, 'ok', null);

  select p.cost_millicents into custo_depois
  from public.ai_usage_periods p where p.organization_id = org;

  r := r || jsonb_build_object('acerto_usa_modelo_da_reserva',
    (res2 ->> 'model') = 'claude-haiku-4-5' and (res2 ->> 'batch')::boolean
      and custo_depois - custo_antes
        = private.ai_cost_millicents(6000, 1100, 0, 0, 'claude-haiku-4-5', true) - pedido.estimated_millicents);

  -- Acerto informando o modelo realmente usado: vale o informado.
  res := public.reserve_ai_usage(key, org, 'reply_suggestion', 1, null, null, null,
    3000, 400, 0, 0, 'claude-haiku-4-5', false);
  reserva := (res ->> 'reservation_id')::uuid;
  select * into pedido from private.ai_usage_requests q where q.id = reserva;

  select p.cost_millicents into custo_antes
  from public.ai_usage_periods p where p.organization_id = org;

  res2 := public.settle_ai_usage(key, org, reserva, 3000, 400, 0, 0, 'ok', null, 'claude-sonnet-5', false);

  select p.cost_millicents into custo_depois
  from public.ai_usage_periods p where p.organization_id = org;

  r := r || jsonb_build_object('acerto_troca_modelo',
    (select q.model from private.ai_usage_requests q where q.id = reserva) = 'claude-sonnet-5'
      and custo_depois - custo_antes
        = private.ai_cost_millicents(3000, 400, 0, 0, 'claude-sonnet-5', false) - pedido.estimated_millicents);

  -- ---------------------------------------------------------------------------
  -- 5. Tetos novos e grants
  -- ---------------------------------------------------------------------------
  select * into ctx from private.ai_quota_context(org, now());

  r := r || jsonb_build_object(
    'teto_trial', private.ai_cost_cap_cents('trial'),
    'teto_corretor', private.ai_cost_cap_cents('corretor'),
    'teto_imobiliaria', private.ai_cost_cap_cents('imobiliaria'),
    'teto_equipe', private.ai_cost_cap_cents('equipe'),
    'teto_rede', private.ai_cost_cap_cents('rede'),
    'teto_desconhecido', private.ai_cost_cap_cents('plano-inventado'),
    'contexto_imobiliaria_teto', ctx.plan_cap_millicents,
    'assinatura_antiga_removida',
      to_regprocedure('public.reserve_ai_usage(text, uuid, text, integer, uuid, text, text, integer, integer, integer, integer)') is null
        and to_regprocedure('public.settle_ai_usage(text, uuid, uuid, integer, integer, integer, integer, text, text)') is null
        and to_regprocedure('private.ai_cost_millicents(bigint, bigint, bigint, bigint)') is null,
    'grant_reserve_anon', has_function_privilege('anon',
      'public.reserve_ai_usage(text, uuid, text, integer, uuid, text, text, integer, integer, integer, integer, text, boolean)', 'execute'),
    'grant_reserve_authenticated', has_function_privilege('authenticated',
      'public.reserve_ai_usage(text, uuid, text, integer, uuid, text, text, integer, integer, integer, integer, text, boolean)', 'execute'),
    'grant_settle_anon', has_function_privilege('anon',
      'public.settle_ai_usage(text, uuid, uuid, integer, integer, integer, integer, text, text, text, boolean)', 'execute'),
    'grant_settle_authenticated', has_function_privilege('authenticated',
      'public.settle_ai_usage(text, uuid, uuid, integer, integer, integer, integer, text, text, text, boolean)', 'execute'),
    'grant_pricing_anon', has_function_privilege('anon', 'private.ai_pricing(text)', 'execute')
  );

  raise exception 'TESTE DE IA MODELOS E LOTE (rollback): %', jsonb_pretty(r);
end;
$$;
