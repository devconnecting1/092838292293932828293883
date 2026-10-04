-- =============================================================================
-- Teste dos avisos no celular (Web Push)
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
-- Usa a chave `notification_server_key` do Vault (sem imprimir).
--
-- O que está sendo garantido (migração push_notifications):
--   1. cada usuário liga, vê e remove só os seus aparelhos; endpoint e chaves
--      não saem por SELECT da sessão; ninguém grava direto na tabela;
--   2. outra pessoa não desliga, não sincroniza e não apaga o aparelho alheio;
--      o aparelho só muda de dono quando quem está com ele liga os avisos;
--   3. aparelho ligado numa imobiliária exige membership ativa;
--   4. o servidor (NOTIFICATION_SERVER_KEY) recebe os aparelhos do destinatário
--      UMA vez por aviso, respeitando a imobiliária do aparelho e a membership;
--      sessão, anon sem chave e chave errada não leem nada;
--   5. inscrição expirada é removida e a entrega é registrada;
--   6. no máximo 10 aparelhos por usuário.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   liga_aparelho                     : true
--   dono_ve_o_seu                     : 1
--   sessao_nao_le_endpoint            : "NEGADO:42501"
--   sessao_nao_grava_direto           : "NEGADO:42501"
--   anon_nao_liga                     : "NEGADO:42501"
--   outro_nao_ve                      : 0
--   outro_nao_apaga                   : 0
--   outro_nao_desliga                 : false
--   outro_nao_sincroniza              : true
--   sincroniza_o_seu                  : true
--   imobiliaria_sem_membership        : "NEGADO:42501"
--   sessao_nao_reserva_push           : "NEGADO:42501"
--   chave_errada_nao_reserva          : "NEGADO:42501"
--   reserva_aparelhos_do_destinatario : 2
--   ignora_aparelho_de_outra_imob     : true
--   reserva_uma_vez_por_aviso         : 0
--   marca_push_no_aviso               : true
--   membership_inativa_nao_recebe     : 0
--   settle                            : {"removed": 1, "delivered": 1}
--   expirada_removida                 : false
--   entrega_registrada                : true
--   aparelho_muda_de_dono             : true
--   antigo_dono_nao_ve                : 0
--   dono_remove_o_seu                 : 1
--   teto_de_10_aparelhos              : 10

do $$
declare
  r jsonb := '{}'::jsonb;
  server_key text;
  u_owner uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  u_other uuid := gen_random_uuid();
  u_inactive uuid := gen_random_uuid();
  org uuid;
  org_other uuid;
  lead uuid;
  n_broker uuid;
  n_inactive uuid;
  s_broker uuid;
  s_broker_other_org uuid;
  s_broker_same_org uuid;
  s_inactive uuid;
  e_broker text := 'https://fcm.googleapis.com/fcm/send/teste-push-' || gen_random_uuid();
  e_broker_other_org text := 'https://updates.push.services.mozilla.com/wpush/v2/teste-push-' || gen_random_uuid();
  e_broker_same_org text := 'https://web.push.apple.com/teste-push-' || gen_random_uuid();
  e_inactive text := 'https://fcm.googleapis.com/fcm/send/teste-push-' || gen_random_uuid();
  k_p256dh text := 'B' || repeat('x', 86);
  k_auth text := repeat('a', 22);
  v_json jsonb;
  v_text text;
  v_int integer;
  v_bool boolean;
  v_uuid uuid;
  i integer;
begin
  select ds.decrypted_secret into server_key
  from vault.decrypted_secrets ds
  where ds.name = 'notification_server_key';

  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-push-dono@exemplo.invalid', now(), now(), now()),
    (u_broker, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-push-corretor@exemplo.invalid', now(), now(), now()),
    (u_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-push-outro@exemplo.invalid', now(), now(), now()),
    (u_inactive, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-push-inativo@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Push', 'teste-push-aviso');

  update public.billing_accounts
  set limits = limits || '{"users": 20}'::jsonb
  where organization_id = org;

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_broker, 'broker', true), (org, u_inactive, 'broker', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  org_other := public.create_organization('Imobiliaria Teste Push 2', 'teste-push-aviso-2');

  update public.billing_accounts
  set limits = limits || '{"users": 20}'::jsonb
  where organization_id = org_other;

  -- O corretor também trabalha na segunda imobiliária.
  insert into public.memberships (organization_id, user_id, role, active)
  values (org_other, u_broker, 'broker', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);

  insert into public.leads (organization_id, name, phone, source, stage, assigned_to)
  values (org, 'Lead Teste Push', '11977775555', 'manual', 'new', u_broker)
  returning id into lead;

  -- ---------------------------------------------------------------------------
  -- 1. O corretor liga os avisos
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select public.register_push_subscription($1, $2, $3, $4, null)'
    into s_broker using e_broker, k_p256dh, k_auth, 'Chrome no Android';
  -- Aparelho ligado no endereço da segunda imobiliária: só avisos dela.
  execute 'select public.register_push_subscription($1, $2, $3, $4, $5)'
    into s_broker_other_org using e_broker_other_org, k_p256dh, k_auth, 'Firefox no Windows', org_other;
  -- Aparelho ligado no endereço da primeira imobiliária.
  execute 'select public.register_push_subscription($1, $2, $3, $4, $5)'
    into s_broker_same_org using e_broker_same_org, k_p256dh, k_auth, 'Safari no iPhone', org;
  r := r || jsonb_build_object('liga_aparelho',
    s_broker is not null and s_broker_other_org is not null and s_broker_same_org is not null);

  execute 'select count(*)::integer from public.push_subscriptions where id = $1'
    into v_int using s_broker;
  r := r || jsonb_build_object('dono_ve_o_seu', v_int);

  begin
    execute 'select endpoint from public.push_subscriptions limit 1' into v_text;
    r := r || jsonb_build_object('sessao_nao_le_endpoint', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('sessao_nao_le_endpoint', 'NEGADO:' || sqlstate);
  end;

  begin
    execute $q$
      insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_secret)
      values ($1, 'https://fcm.googleapis.com/fcm/send/teste-push-direto', $2, $3)
    $q$ using u_broker, k_p256dh, k_auth;
    r := r || jsonb_build_object('sessao_nao_grava_direto', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('sessao_nao_grava_direto', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'select public.claim_lead_notification_pushes($1, array[gen_random_uuid()])'
      using server_key;
    r := r || jsonb_build_object('sessao_nao_reserva_push', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('sessao_nao_reserva_push', 'NEGADO:' || sqlstate);
  end;

  reset role;

  -- Anon (sem sessão) não liga aparelho.
  perform set_config('request.jwt.claims', '', true);
  set local role anon;

  begin
    execute 'select public.register_push_subscription($1, $2, $3, null, null)'
      into v_uuid using 'https://fcm.googleapis.com/fcm/send/teste-push-anon', k_p256dh, k_auth;
    r := r || jsonb_build_object('anon_nao_liga', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('anon_nao_liga', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'select count(*) from public.claim_lead_notification_pushes($1, array[gen_random_uuid()])'
      using 'chave-errada';
    r := r || jsonb_build_object('chave_errada_nao_reserva', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('chave_errada_nao_reserva', 'NEGADO:' || sqlstate);
  end;

  reset role;

  -- ---------------------------------------------------------------------------
  -- 2. Outra pessoa não mexe no aparelho alheio
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select count(*)::integer from public.push_subscriptions where id = $1'
    into v_int using s_broker;
  r := r || jsonb_build_object('outro_nao_ve', v_int);

  execute $q$
    with apagados as (
      delete from public.push_subscriptions where id = $1 returning id
    )
    select count(*)::integer from apagados
  $q$ into v_int using s_broker;
  r := r || jsonb_build_object('outro_nao_apaga', v_int);

  execute 'select public.unregister_push_subscription($1)' into v_bool using e_broker;
  r := r || jsonb_build_object('outro_nao_desliga', v_bool);

  execute 'select public.sync_push_subscription($1, $2, $3)'
    into v_uuid using e_broker, k_p256dh, k_auth;
  r := r || jsonb_build_object('outro_nao_sincroniza', v_uuid is null);

  -- Imobiliária em que o dono não trabalha.
  begin
    execute 'select public.register_push_subscription($1, $2, $3, null, $4)'
      into v_uuid using 'https://fcm.googleapis.com/fcm/send/teste-push-sem-membro', k_p256dh, k_auth, org_other;
    r := r || jsonb_build_object('imobiliaria_sem_membership', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('imobiliaria_sem_membership', 'NEGADO:' || sqlstate);
  end;

  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select public.sync_push_subscription($1, $2, $3)'
    into v_uuid using e_broker, 'B' || repeat('y', 86), k_auth;
  r := r || jsonb_build_object('sincroniza_o_seu', v_uuid = s_broker);

  reset role;

  -- O corretor inativo também tinha ligado os avisos antes de ser desativado.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_inactive, 'role', 'authenticated')::text, true);
  s_inactive := public.register_push_subscription(e_inactive, k_p256dh, k_auth, null, null);
  perform set_config('request.jwt.claims', '', true);
  update public.memberships set active = false
  where organization_id = org and user_id = u_inactive;

  -- ---------------------------------------------------------------------------
  -- 3. Servidor: aparelhos do destinatário, uma vez por aviso
  -- ---------------------------------------------------------------------------
  -- Avisos da fila (o lead pode já ter enfileirado o seu: sem duplicar).
  insert into private.lead_notifications (organization_id, lead_id, user_id, kind, round)
  values (org, lead, u_broker, 'assigned', 0), (org, lead, u_inactive, 'assigned', 0)
  on conflict on constraint lead_notifications_unique do nothing;

  select n.id into n_broker from private.lead_notifications n
  where n.lead_id = lead and n.user_id = u_broker and n.kind = 'assigned' and n.round = 0;

  select n.id into n_inactive from private.lead_notifications n
  where n.lead_id = lead and n.user_id = u_inactive and n.kind = 'assigned' and n.round = 0;

  set local role anon;

  execute $q$
    select count(*)::integer,
           bool_and(p.subscription_id <> $3) and bool_and(p.notification_id = $2)
    from public.claim_lead_notification_pushes($1, array[$2]) p
  $q$ into v_int, v_bool using server_key, n_broker, s_broker_other_org;
  r := r || jsonb_build_object('reserva_aparelhos_do_destinatario', v_int);
  r := r || jsonb_build_object('ignora_aparelho_de_outra_imob', coalesce(v_bool, false));

  execute 'select count(*)::integer from public.claim_lead_notification_pushes($1, array[$2])'
    into v_int using server_key, n_broker;
  r := r || jsonb_build_object('reserva_uma_vez_por_aviso', v_int);

  execute 'select count(*)::integer from public.claim_lead_notification_pushes($1, array[$2])'
    into v_int using server_key, n_inactive;
  r := r || jsonb_build_object('membership_inativa_nao_recebe', v_int);

  execute 'select public.settle_push_deliveries($1, array[$2]::uuid[], array[$3]::uuid[])'
    into v_json using server_key, s_broker, s_broker_same_org;
  r := r || jsonb_build_object('settle', v_json);

  reset role;

  r := r || jsonb_build_object('marca_push_no_aviso', exists (
    select 1 from private.lead_notifications n
    where n.id = n_broker and n.push_sent_at is not null and n.sent_at is null
  ));
  r := r || jsonb_build_object('expirada_removida', exists (
    select 1 from public.push_subscriptions s where s.id = s_broker_same_org
  ));
  r := r || jsonb_build_object('entrega_registrada', exists (
    select 1 from public.push_subscriptions s
    where s.id = s_broker and s.last_delivered_at is not null
  ));

  -- ---------------------------------------------------------------------------
  -- 4. Aparelho compartilhado muda de dono; dono remove o seu; teto de 10
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select public.register_push_subscription($1, $2, $3, null, null)'
    into v_uuid using e_broker, k_p256dh, k_auth;
  execute 'select count(*)::integer from public.push_subscriptions where id = $1'
    into v_int using v_uuid;

  reset role;

  r := r || jsonb_build_object('aparelho_muda_de_dono', v_int = 1 and exists (
    select 1 from public.push_subscriptions s
    where s.endpoint = e_broker and s.user_id = u_owner and s.last_delivered_at is null
  ));

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select count(*)::integer from public.push_subscriptions where id = $1'
    into v_int using v_uuid;
  r := r || jsonb_build_object('antigo_dono_nao_ve', v_int);

  execute $q$
    with apagados as (
      delete from public.push_subscriptions where id = $1 returning id
    )
    select count(*)::integer from apagados
  $q$ into v_int using s_broker_other_org;
  r := r || jsonb_build_object('dono_remove_o_seu', v_int);

  for i in 1..12 loop
    execute 'select public.register_push_subscription($1, $2, $3, null, null)'
      into v_uuid
      using 'https://fcm.googleapis.com/fcm/send/teste-push-teto-' || i || '-' || gen_random_uuid(),
        k_p256dh, k_auth;
  end loop;

  execute 'select count(*)::integer from public.push_subscriptions' into v_int;
  r := r || jsonb_build_object('teto_de_10_aparelhos', v_int);

  reset role;

  raise exception 'TESTE push_notifications (rollback): %', r;
end;
$$;
