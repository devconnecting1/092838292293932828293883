-- =============================================================================
-- Teste do Console da Plataforma: Imobiliárias e Assinaturas e receita
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- O que está sendo provado (migração platform_console_organizations_and_revenue):
--   1. sem PLATFORM_SERVER_KEY (ou com a chave errada) as cinco RPCs recusam
--      com 42501;
--   2. a lista busca por nome sem acento, subdomínio e e-mail do dono, filtra
--      por situação e plano, e recusa filtro inválido (22023);
--   3. nenhuma resposta traz dado pessoal de cliente final: a lista não tem
--      coluna de contato nem "@", e a ficha só tem e-mail dos membros;
--   4. motivo vazio ou só com espaços é recusado (22023) e não grava registro;
--   5. prorrogar o teste grava assinatura.prorrogar_teste (antes/depois),
--      recusa dias fora de 7/14 e para no teto de agora + 45 dias;
--   6. bloquear grava organizacao.bloquear, põe a conta em somente leitura no
--      mesmo mecanismo da assinatura (billing_state, get_billing_overview e IA),
--      aparece no filtro "bloqueada" e no histórico; bloquear de novo é recusado;
--   7. conta da equipe inválida (e-mail trocado) é recusada e nada muda;
--   8. desbloquear grava organizacao.desbloquear e devolve o acesso;
--   9. a sincronização da Stripe não desbloqueia; teste controlado pela Stripe
--      e conta ativa não são prorrogados; cancelamento aparece em canceled_at;
--  10. as RPCs são só para anon e o histórico não é legível com sessão.
--
-- Resultado esperado (ordem das chaves pode variar):
--   lista_sem_chave                  : "NEGADO:42501"
--   lista_chave_errada               : "NEGADO:42501"
--   ficha_sem_chave                  : "NEGADO:42501"
--   receita_sem_chave                : "NEGADO:42501"
--   bloqueio_sem_chave               : "NEGADO:42501"
--   prorrogacao_sem_chave            : "NEGADO:42501"
--   busca_nome_sem_acento            : 1
--   busca_subdominio                 : 1
--   busca_email_do_dono              : 1
--   filtro_teste_inclui              : true
--   filtro_ativa_exclui              : true
--   filtro_plano_trial_inclui        : true
--   filtro_situacao_invalida         : "NEGADO:22023"
--   filtro_plano_invalido            : "NEGADO:22023"
--   lista_numeros                    : {"membros": 1, "leads_30_dias": 1, "teto_ia": 0}
--   lista_sem_coluna_de_contato      : true
--   lista_sem_email                  : true
--   lista_sem_lead                   : true
--   ficha_partes                     : ["billing", "history", "members", "metrics", "organization"]
--   ficha_organizacao_campos         : ["created_at", "id", "name", "slug"]
--   ficha_sem_lead                   : true
--   ficha_email_so_de_membro         : true
--   receita_sem_coluna_de_contato    : true
--   motivo_vazio_bloqueio            : "NEGADO:22023"
--   motivo_espacos_bloqueio          : "NEGADO:22023"
--   motivo_vazio_prorrogacao         : "NEGADO:22023"
--   motivo_vazio_nao_registra        : true
--   prorrogacao_dias_invalidos       : "NEGADO:22023"
--   prorrogacao_7_dias               : true
--   prorrogacao_registrada           : {"acao": "assinatura.prorrogar_teste", "dias": 7, "motivo": "Cliente pediu mais prazo"}
--   prorrogacao_antes_depois         : true
--   prorrogacao_no_historico         : "plataforma"
--   prorrogacao_14_dias              : true
--   prorrogacao_acima_do_teto        : "NEGADO:P0001:limite_de_prorrogacao"
--   bloqueio_resposta                : true
--   bloqueio_registrado              : {"acao": "organizacao.bloquear", "email": "equipe-console-p2@exemplo.invalid", "motivo": "Uso indevido em teste", "depois": true}
--   bloqueio_billing_state           : "read_only"
--   bloqueio_resumo_da_sessao        : {"state": "read_only", "platform_blocked": true}
--   bloqueio_ia                      : "read_only"
--   bloqueio_filtro_bloqueada        : 1
--   bloqueio_no_historico            : true
--   bloqueio_repetido                : "NEGADO:P0001:conta_ja_bloqueada"
--   equipe_invalida_desbloqueio      : "NEGADO:42501"
--   equipe_invalida_nada_muda        : true
--   desbloqueio_registrado           : "organizacao.desbloquear"
--   desbloqueio_billing_state        : "trialing"
--   desbloqueio_repetido             : "NEGADO:P0001:conta_nao_bloqueada"
--   teste_da_stripe_nao_prorroga     : "NEGADO:P0001:teste_controlado_pela_stripe"
--   stripe_nao_desbloqueia           : "read_only"
--   conta_ativa_nao_prorroga         : "NEGADO:P0001:conta_fora_do_teste"
--   receita_cancelamento_registrado  : true
--   registros_da_imobiliaria         : 5
--   rpcs_para_anon                   : true
--   rpcs_para_authenticated          : false
--   historico_para_authenticated     : false
--
-- teto_ia era 600 quando este teste foi escrito. Desde a migração
-- 20260917091437_ai_trial_without_ai_model_pricing_batch (decisão do dono:
-- teste grátis sem IA), private.ai_quota_context devolve teto 0 para qualquer
-- conta 'trialing', e a imobiliária criada aqui está no teste grátis; o Console
-- mostra esse teto (platform_organization_metrics). Conferido na nuvem em
-- 17/09/2026; não depende de dado existente, então vale também no banco vazio.

do $$
declare
  r jsonb := '{}'::jsonb;
  key text;
  billing_key text;
  u_admin uuid := gen_random_uuid();
  u_owner uuid := gen_random_uuid();
  org uuid;
  v_before timestamptz;
  v_result jsonb;
  v_detail jsonb;
  v_count integer;
  v_row record;
  v_rpcs constant text[] := array[
    'public.platform_list_organizations(text, text, text, text, integer, integer)',
    'public.platform_get_organization(text, uuid)',
    'public.platform_list_revenue_accounts(text)',
    'public.platform_set_organization_block(text, uuid, text, uuid, boolean, text)',
    'public.platform_extend_trial(text, uuid, text, uuid, integer, text)'
  ];
  v_pii constant text := '(email|mail|phone|telefone|fone|whatsapp|cpf|cnpj|document|address|endereco|street|full_name|client|lead_name)';
begin
  select ds.decrypted_secret into key
  from vault.decrypted_secrets ds
  where ds.name = 'platform_server_key';

  select ds.decrypted_secret into billing_key
  from vault.decrypted_secrets ds
  where ds.name = 'billing_server_key';

  -- ---------------------------------------------------------------------------
  -- Dados: equipe da plataforma, dono e imobiliária com um lead de cliente final
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'equipe-console-p2@exemplo.invalid', now(), now(), now()),
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'dono-console-p2@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliária Pêssego Console', 'pessego-console-p2');
  perform set_config('request.jwt.claims', '', true);

  insert into public.leads (organization_id, name, email, phone)
  values (org, 'Cliente Final Secreto', 'cliente-final-p2@exemplo.invalid', '11987654321');

  -- ---------------------------------------------------------------------------
  -- 1. Sem chave
  -- ---------------------------------------------------------------------------
  begin
    perform public.platform_list_organizations(null);
    r := r || jsonb_build_object('lista_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('lista_sem_chave', 'NEGADO:42501');
  end;

  begin
    perform public.platform_list_organizations('chave-errada');
    r := r || jsonb_build_object('lista_chave_errada', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('lista_chave_errada', 'NEGADO:42501');
  end;

  begin
    perform public.platform_get_organization(null, org);
    r := r || jsonb_build_object('ficha_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('ficha_sem_chave', 'NEGADO:42501');
  end;

  begin
    perform public.platform_list_revenue_accounts(null);
    r := r || jsonb_build_object('receita_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('receita_sem_chave', 'NEGADO:42501');
  end;

  begin
    perform public.platform_set_organization_block(
      null, u_admin, 'equipe-console-p2@exemplo.invalid', org, true, 'Motivo do teste');
    r := r || jsonb_build_object('bloqueio_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('bloqueio_sem_chave', 'NEGADO:42501');
  end;

  begin
    perform public.platform_extend_trial(
      null, u_admin, 'equipe-console-p2@exemplo.invalid', org, 7, 'Motivo do teste');
    r := r || jsonb_build_object('prorrogacao_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('prorrogacao_sem_chave', 'NEGADO:42501');
  end;

  -- ---------------------------------------------------------------------------
  -- 2. Busca e filtros
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'busca_nome_sem_acento',
    (select count(*) from public.platform_list_organizations(key, 'pessego CONSOLE') l
     where l.organization_id = org),
    'busca_subdominio',
    (select count(*) from public.platform_list_organizations(key, 'console-p2') l
     where l.organization_id = org),
    'busca_email_do_dono',
    (select count(*) from public.platform_list_organizations(key, 'dono-console-p2@') l
     where l.organization_id = org),
    'filtro_teste_inclui',
    exists (select 1 from public.platform_list_organizations(key, 'pessego', 'teste') l
            where l.organization_id = org),
    'filtro_ativa_exclui',
    not exists (select 1 from public.platform_list_organizations(key, 'pessego', 'ativa') l
                where l.organization_id = org),
    'filtro_plano_trial_inclui',
    exists (select 1 from public.platform_list_organizations(key, 'pessego', null, 'trial') l
            where l.organization_id = org)
  );

  begin
    perform public.platform_list_organizations(key, null, 'vencida');
    r := r || jsonb_build_object('filtro_situacao_invalida', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('filtro_situacao_invalida', 'NEGADO:22023');
  end;

  begin
    perform public.platform_list_organizations(key, null, null, 'ouro');
    r := r || jsonb_build_object('filtro_plano_invalido', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('filtro_plano_invalido', 'NEGADO:22023');
  end;

  -- ---------------------------------------------------------------------------
  -- 3. Sem dado pessoal de cliente final
  -- ---------------------------------------------------------------------------
  select to_jsonb(l) into v_result
  from public.platform_list_organizations(key, 'pessego-console-p2') l
  where l.organization_id = org;

  v_detail := public.platform_get_organization(key, org);

  r := r || jsonb_build_object(
    'lista_numeros', jsonb_build_object(
      'membros', v_result -> 'active_members',
      'leads_30_dias', v_result -> 'leads_last_30_days',
      'teto_ia', v_result -> 'ai_cap_cents'
    ),
    'lista_sem_coluna_de_contato', not exists (
      select 1 from jsonb_object_keys(v_result) k where k ~* v_pii),
    'lista_sem_email', v_result::text !~ '@',
    'lista_sem_lead', v_result::text !~* '(secreto|98765|cliente-final)',
    'ficha_partes', (select jsonb_agg(k order by k) from jsonb_object_keys(v_detail) k),
    'ficha_organizacao_campos',
    (select jsonb_agg(k order by k) from jsonb_object_keys(v_detail -> 'organization') k),
    'ficha_sem_lead', v_detail::text !~* '(secreto|98765|cliente-final)',
    'ficha_email_so_de_membro',
    (v_detail - 'members')::text !~ '@'
      and (v_detail -> 'members' -> 0 ->> 'email') = 'dono-console-p2@exemplo.invalid'
      and not exists (
        select 1
        from jsonb_array_elements(v_detail -> 'members') m, jsonb_object_keys(m) k
        where k ~* v_pii and k <> 'email'
      ),
    'receita_sem_coluna_de_contato', not exists (
      select 1
      from pg_proc p, unnest(p.proargnames) as a (name)
      where p.oid = 'public.platform_list_revenue_accounts(text)'::regprocedure
        and a.name ~* v_pii
    )
  );

  -- ---------------------------------------------------------------------------
  -- 4. Motivo obrigatório
  -- ---------------------------------------------------------------------------
  begin
    perform public.platform_set_organization_block(
      key, u_admin, 'equipe-console-p2@exemplo.invalid', org, true, '');
    r := r || jsonb_build_object('motivo_vazio_bloqueio', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('motivo_vazio_bloqueio', 'NEGADO:22023');
  end;

  begin
    perform public.platform_set_organization_block(
      key, u_admin, 'equipe-console-p2@exemplo.invalid', org, true, '    ');
    r := r || jsonb_build_object('motivo_espacos_bloqueio', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('motivo_espacos_bloqueio', 'NEGADO:22023');
  end;

  begin
    perform public.platform_extend_trial(
      key, u_admin, 'equipe-console-p2@exemplo.invalid', org, 7, null);
    r := r || jsonb_build_object('motivo_vazio_prorrogacao', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('motivo_vazio_prorrogacao', 'NEGADO:22023');
  end;

  r := r || jsonb_build_object(
    'motivo_vazio_nao_registra',
    not exists (select 1 from private.platform_audit_events e where e.organization_id = org)
      and (select b.platform_blocked_at is null from public.billing_accounts b where b.organization_id = org)
  );

  -- ---------------------------------------------------------------------------
  -- 5. Prorrogar o teste
  -- ---------------------------------------------------------------------------
  begin
    perform public.platform_extend_trial(
      key, u_admin, 'equipe-console-p2@exemplo.invalid', org, 10, 'Cliente pediu mais prazo');
    r := r || jsonb_build_object('prorrogacao_dias_invalidos', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('prorrogacao_dias_invalidos', 'NEGADO:22023');
  end;

  select b.trial_ends_at into v_before from public.billing_accounts b where b.organization_id = org;

  v_result := public.platform_extend_trial(
    key, u_admin, 'equipe-console-p2@exemplo.invalid', org, 7, 'Cliente pediu mais prazo');

  select e.* into v_row
  from private.platform_audit_events e
  where e.organization_id = org
  order by e.id desc
  limit 1;

  r := r || jsonb_build_object(
    'prorrogacao_7_dias',
    (v_result ->> 'trial_ends_at')::timestamptz = v_before + interval '7 days'
      and (select b.trial_ends_at from public.billing_accounts b where b.organization_id = org)
        = v_before + interval '7 days',
    'prorrogacao_registrada', jsonb_build_object(
      'acao', v_row.action, 'dias', v_row.after_data -> 'dias', 'motivo', v_row.reason),
    'prorrogacao_antes_depois',
    (v_row.before_data ->> 'fim_do_teste')::timestamptz = v_before
      and (v_row.after_data ->> 'fim_do_teste')::timestamptz = v_before + interval '7 days'
      and v_row.actor_user_id = u_admin,
    'prorrogacao_no_historico', (
      select h.source
      from private.billing_account_history h
      where h.organization_id = org
        and 'trial_ends_at' = any (h.changed_fields)
      order by h.id desc
      limit 1
    )
  );

  v_result := public.platform_extend_trial(
    key, u_admin, 'equipe-console-p2@exemplo.invalid', org, 14, 'Cliente pediu mais prazo');

  r := r || jsonb_build_object(
    'prorrogacao_14_dias',
    (v_result ->> 'trial_ends_at')::timestamptz = v_before + interval '21 days'
  );

  begin
    perform public.platform_extend_trial(
      key, u_admin, 'equipe-console-p2@exemplo.invalid', org, 14, 'Cliente pediu mais prazo');
    r := r || jsonb_build_object('prorrogacao_acima_do_teto', 'PASSOU');
  exception when sqlstate 'P0001' then
    r := r || jsonb_build_object('prorrogacao_acima_do_teto', 'NEGADO:P0001:' || sqlerrm);
  end;

  -- ---------------------------------------------------------------------------
  -- 6. Bloquear
  -- ---------------------------------------------------------------------------
  v_result := public.platform_set_organization_block(
    key, u_admin, 'equipe-console-p2@exemplo.invalid', org, true, '  Uso indevido em teste  ');

  select e.* into v_row
  from private.platform_audit_events e
  where e.organization_id = org
  order by e.id desc
  limit 1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  v_detail := public.get_billing_overview(org);
  perform set_config('request.jwt.claims', '', true);

  r := r || jsonb_build_object(
    'bloqueio_resposta', (v_result ->> 'blocked')::boolean and v_result ->> 'blocked_at' is not null,
    'bloqueio_registrado', jsonb_build_object(
      'acao', v_row.action, 'email', v_row.actor_email, 'motivo', v_row.reason,
      'depois', v_row.after_data -> 'bloqueada'),
    'bloqueio_billing_state', private.billing_state(org),
    'bloqueio_resumo_da_sessao', jsonb_build_object(
      'state', v_detail -> 'state', 'platform_blocked', v_detail -> 'platform_blocked'),
    'bloqueio_ia', (select c.billing_state from private.ai_quota_context(org, now()) c),
    'bloqueio_filtro_bloqueada',
    (select count(*) from public.platform_list_organizations(key, 'pessego', 'bloqueada') l
     where l.organization_id = org),
    'bloqueio_no_historico', exists (
      select 1
      from private.billing_account_history h
      where h.organization_id = org
        and h.platform_blocked
        and 'platform_blocked' = any (h.changed_fields)
        and h.source = 'plataforma'
    )
  );

  begin
    perform public.platform_set_organization_block(
      key, u_admin, 'equipe-console-p2@exemplo.invalid', org, true, 'Uso indevido em teste');
    r := r || jsonb_build_object('bloqueio_repetido', 'PASSOU');
  exception when sqlstate 'P0001' then
    r := r || jsonb_build_object('bloqueio_repetido', 'NEGADO:P0001:' || sqlerrm);
  end;

  -- ---------------------------------------------------------------------------
  -- 7. Conta da equipe inválida: recusa e nada muda
  -- ---------------------------------------------------------------------------
  begin
    perform public.platform_set_organization_block(
      key, u_admin, 'outra-pessoa@exemplo.invalid', org, false, 'Tentativa com e-mail trocado');
    r := r || jsonb_build_object('equipe_invalida_desbloqueio', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('equipe_invalida_desbloqueio', 'NEGADO:42501');
  end;

  r := r || jsonb_build_object(
    'equipe_invalida_nada_muda',
    (select b.platform_blocked_at is not null from public.billing_accounts b where b.organization_id = org)
      and (select count(*) from private.platform_audit_events e where e.organization_id = org) = 3
  );

  -- ---------------------------------------------------------------------------
  -- 8. Desbloquear
  -- ---------------------------------------------------------------------------
  perform public.platform_set_organization_block(
    key, u_admin, 'equipe-console-p2@exemplo.invalid', org, false, 'Situação resolvida');

  r := r || jsonb_build_object(
    'desbloqueio_registrado', (
      select e.action from private.platform_audit_events e
      where e.organization_id = org order by e.id desc limit 1),
    'desbloqueio_billing_state', private.billing_state(org)
  );

  begin
    perform public.platform_set_organization_block(
      key, u_admin, 'equipe-console-p2@exemplo.invalid', org, false, 'Situação resolvida');
    r := r || jsonb_build_object('desbloqueio_repetido', 'PASSOU');
  exception when sqlstate 'P0001' then
    r := r || jsonb_build_object('desbloqueio_repetido', 'NEGADO:P0001:' || sqlerrm);
  end;

  -- ---------------------------------------------------------------------------
  -- 9. Stripe: teste controlado por ela, sincronização e cancelamento
  -- ---------------------------------------------------------------------------
  perform public.sync_billing_account(billing_key, org, jsonb_build_object(
    'stripe_customer_id', 'cus_TesteConsoleP2',
    'stripe_subscription_id', 'sub_TesteConsoleP2',
    'plan_key', 'equipe',
    'billing_interval', 'month',
    'status', 'trialing',
    'current_period_end', to_char(now() + interval '5 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ));

  begin
    perform public.platform_extend_trial(
      key, u_admin, 'equipe-console-p2@exemplo.invalid', org, 7, 'Cliente pediu mais prazo');
    r := r || jsonb_build_object('teste_da_stripe_nao_prorroga', 'PASSOU');
  exception when sqlstate 'P0001' then
    r := r || jsonb_build_object('teste_da_stripe_nao_prorroga', 'NEGADO:P0001:' || sqlerrm);
  end;

  perform public.platform_set_organization_block(
    key, u_admin, 'equipe-console-p2@exemplo.invalid', org, true, 'Bloqueio antes da sincronização');

  perform public.sync_billing_account(billing_key, org, jsonb_build_object(
    'stripe_customer_id', 'cus_TesteConsoleP2',
    'status', 'active',
    'current_period_end', to_char(now() + interval '30 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ));

  r := r || jsonb_build_object('stripe_nao_desbloqueia', private.billing_state(org));

  begin
    perform public.platform_extend_trial(
      key, u_admin, 'equipe-console-p2@exemplo.invalid', org, 7, 'Cliente pediu mais prazo');
    r := r || jsonb_build_object('conta_ativa_nao_prorroga', 'PASSOU');
  exception when sqlstate 'P0001' then
    r := r || jsonb_build_object('conta_ativa_nao_prorroga', 'NEGADO:P0001:' || sqlerrm);
  end;

  perform public.sync_billing_account(billing_key, org, jsonb_build_object(
    'stripe_customer_id', 'cus_TesteConsoleP2',
    'status', 'canceled'
  ));

  select count(*)::integer into v_count
  from private.platform_audit_events e
  where e.organization_id = org;

  r := r || jsonb_build_object(
    'receita_cancelamento_registrado', exists (
      select 1
      from public.platform_list_revenue_accounts(key) a
      where a.organization_id = org
        and a.status = 'canceled'
        and a.canceled_at is not null
    ),
    'registros_da_imobiliaria', v_count
  );

  -- ---------------------------------------------------------------------------
  -- 10. Privilégios
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'rpcs_para_anon',
    (select bool_and(has_function_privilege('anon', f, 'execute')) from unnest(v_rpcs) f),
    'rpcs_para_authenticated',
    (select bool_or(has_function_privilege('authenticated', f, 'execute')) from unnest(v_rpcs) f),
    'historico_para_authenticated',
    has_table_privilege('authenticated', 'private.billing_account_history', 'select')
  );

  raise exception 'TESTE CONSOLE IMOBILIARIAS E ASSINATURAS (rollback): %', r;
end;
$$;
