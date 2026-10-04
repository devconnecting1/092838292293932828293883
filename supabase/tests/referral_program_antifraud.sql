-- =============================================================================
-- Teste do Indique e ganhe (antifraude, imutabilidade, permissões e concorrência)
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- Resultado esperado (ordem das chaves pode variar):
--   auto_indicacao_mesmo_usuario   : "NULL"            (bloqueada)
--   auto_indicacao_outro_email     : "ATRIBUIDA"       (aceita: a trava é o
--                                                       limite de 50% do valor
--                                                       pago pela indicada)
--   mesmo_cnpj                     : "NULL"            (bloqueada)
--   segunda_org_do_mesmo_dono      : "NULL"            (uma indicação por conta)
--   motivo_membro_comum_depois     : "shared_members"
--   motivo_indicada_mais_antiga    : "ELEGIVEL"
--   motivo_indicada_mais_nova      : "duplicate_owner"
--   troca_de_indicador             : "BLOQUEADA:42501"
--   troca_de_codigo                : "BLOQUEADA:42501"
--   reatribuir_depois_de_remover   : "BLOQUEADA:42501"
--   sessao_le_referral_code        : "NEGADO:42501"
--   sessao_le_referred_by          : "NEGADO:42501"
--   sessao_muda_desconto           : "NEGADO:42501"
--   sessao_chama_get_state         : "NEGADO:42501"
--   sessao_chama_apply             : "NEGADO:42501"
--   rpc_sem_chave                  : "NEGADO:42501"
--   rpc_chave_errada               : "NEGADO:42501"
--   fingerprint_muda_com_cobranca  : true
--   apply_com_fingerprint_velho    : "conflict"
--   apply_com_fingerprint_atual    : "ok"
--   fingerprint_invalido           : "RECUSADO:22023"
--   grant_authenticated            : false
--   grant_anon                     : true

do $$
declare
  r jsonb := '{}'::jsonb;
  u_ref uuid := gen_random_uuid();   -- dono da indicadora
  u_new uuid := gen_random_uuid();   -- segundo e-mail, sem vínculo com a indicadora
  u_cnpj uuid := gen_random_uuid();  -- terceiro usuário (teste de CNPJ)
  org_ref uuid;                      -- indicadora
  org_self uuid;                     -- tentativa de auto-indicação (mesmo usuário)
  org_1 uuid;                        -- 1ª indicada de u_new
  org_2 uuid;                        -- 2ª imobiliária de u_new (não deve ser indicada)
  org_cnpj uuid;                     -- imobiliária com o mesmo CNPJ da indicadora
  code text;
  key text;
  fp_antes text;
  fp_depois text;
  v text;
  j jsonb;
begin
  select ds.decrypted_secret into key
  from vault.decrypted_secrets ds
  where ds.name = 'billing_server_key';

  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (u_ref, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-indicacao-ref@exemplo.invalid', now(), now()),
    (u_new, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-indicacao-novo@exemplo.invalid', now(), now()),
    (u_cnpj, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-indicacao-cnpj@exemplo.invalid', now(), now());

  -- ---------------------------------------------------------------------------
  -- Indicadora
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_ref, 'role', 'authenticated')::text, true);
  org_ref := public.create_organization('Imobiliaria Indicadora', 'teste-indicacao-ref');
  select o.referral_code into code from public.organizations o where o.id = org_ref;

  update public.billing_accounts
  set status = 'active', plan_key = 'corretor', billing_interval = 'month'
  where organization_id = org_ref;

  -- 1. Auto-indicação com o mesmo usuário: bloqueada (já é membro da indicadora).
  org_self := public.create_organization(
    'Imobiliaria Espelho', 'teste-indicacao-espelho', null, null, null, null, null, code);
  select coalesce(o.referred_by_organization_id::text, 'NULL') into v
  from public.organizations o where o.id = org_self;
  r := r || jsonb_build_object('auto_indicacao_mesmo_usuario',
    case when v = org_ref::text then 'ATRIBUIDA' else 'NULL' end);

  -- 2. Segundo e-mail sem vínculo: a atribuição é aceita (risco residual aceito,
  --    contido pelo teto de 50% do valor efetivamente pago pela indicada).
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_new, 'role', 'authenticated')::text, true);
  org_1 := public.create_organization(
    'Imobiliaria Indicada Um', 'teste-indicacao-um', null, null, null, null, null, code);
  select coalesce(o.referred_by_organization_id::text, 'NULL') into v
  from public.organizations o where o.id = org_1;
  r := r || jsonb_build_object('auto_indicacao_outro_email',
    case when v = org_ref::text then 'ATRIBUIDA' else 'NULL' end);

  -- 3. Uma indicação por conta: a segunda imobiliária do mesmo dono não é atribuída.
  org_2 := public.create_organization(
    'Imobiliaria Indicada Dois', 'teste-indicacao-dois', null, null, null, null, null, code);
  select coalesce(o.referred_by_organization_id::text, 'NULL') into v
  from public.organizations o where o.id = org_2;
  r := r || jsonb_build_object('segunda_org_do_mesmo_dono',
    case when v = org_ref::text then 'ATRIBUIDA' else 'NULL' end);

  -- 4. Mesmo CNPJ da indicadora: bloqueado.
  update public.organizations set cnpj = '12345678000199' where id = org_ref;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_cnpj, 'role', 'authenticated')::text, true);
  org_cnpj := public.create_organization('Imobiliaria Mesmo Cnpj', 'teste-indicacao-cnpj',
    null, '12.345.678/0001-99', null, null, null, code);
  select coalesce(o.referred_by_organization_id::text, 'NULL') into v
  from public.organizations o where o.id = org_cnpj;
  r := r || jsonb_build_object('mesmo_cnpj',
    case when v = org_ref::text then 'ATRIBUIDA' else 'NULL' end);

  -- ---------------------------------------------------------------------------
  -- Reavaliação contínua
  -- ---------------------------------------------------------------------------
  -- 5. Membro em comum criado DEPOIS da atribuição.
  insert into public.memberships (organization_id, user_id, role, active, created_by)
  values (org_ref, u_new, 'broker', true, u_ref);
  r := r || jsonb_build_object('motivo_membro_comum_depois',
    coalesce(private.referral_ineligible_reason(org_ref, org_1), 'ELEGIVEL'));
  delete from public.memberships where organization_id = org_ref and user_id = u_new;

  -- 6. duplicate_owner em atribuição gravada antes da regra (trigger desligado só
  --    para montar o estado legado; a transação é desfeita no fim).
  alter table public.organizations disable trigger organizations_protect_referral;
  update public.organizations set referred_by_organization_id = org_ref where id = org_2;
  alter table public.organizations enable trigger organizations_protect_referral;
  update public.organizations set created_at = now() - interval '10 days' where id = org_1;
  update public.organizations set created_at = now() - interval '1 day' where id = org_2;

  r := r || jsonb_build_object(
    'motivo_indicada_mais_antiga', coalesce(private.referral_ineligible_reason(org_ref, org_1), 'ELEGIVEL'),
    'motivo_indicada_mais_nova', coalesce(private.referral_ineligible_reason(org_ref, org_2), 'ELEGIVEL'));

  -- ---------------------------------------------------------------------------
  -- Imutabilidade da atribuição e do código
  -- ---------------------------------------------------------------------------
  begin
    update public.organizations set referred_by_organization_id = org_2 where id = org_1;
    r := r || jsonb_build_object('troca_de_indicador', 'PERMITIDA');
  exception when others then
    r := r || jsonb_build_object('troca_de_indicador', 'BLOQUEADA:' || sqlstate);
  end;

  begin
    update public.organizations set referral_code = '23456789' where id = org_1;
    r := r || jsonb_build_object('troca_de_codigo', 'PERMITIDA');
  exception when others then
    r := r || jsonb_build_object('troca_de_codigo', 'BLOQUEADA:' || sqlstate);
  end;

  -- Limpar é permitido (a FK usa ON DELETE SET NULL), mas é porta de mão única.
  update public.organizations set referred_by_organization_id = null where id = org_2;
  begin
    update public.organizations set referred_by_organization_id = org_ref where id = org_2;
    r := r || jsonb_build_object('reatribuir_depois_de_remover', 'PERMITIDA');
  exception when others then
    r := r || jsonb_build_object('reatribuir_depois_de_remover', 'BLOQUEADA:' || sqlstate);
  end;

  -- ---------------------------------------------------------------------------
  -- O que uma sessão de usuário consegue (RLS + grants por coluna)
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_ref, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    execute 'select referral_code from public.organizations where id = $1' into v using org_ref;
    r := r || jsonb_build_object('sessao_le_referral_code', coalesce(v, 'NULL'));
  exception when others then
    r := r || jsonb_build_object('sessao_le_referral_code', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'select referred_by_organization_id::text from public.organizations where id = $1'
      into v using org_1;
    r := r || jsonb_build_object('sessao_le_referred_by', coalesce(v, 'NULL'));
  exception when others then
    r := r || jsonb_build_object('sessao_le_referred_by', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'update public.billing_accounts set referral_discount_percent = 100
             where organization_id = $1' using org_ref;
    r := r || jsonb_build_object('sessao_muda_desconto', 'PERMITIDA');
  exception when others then
    r := r || jsonb_build_object('sessao_muda_desconto', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'select public.get_referral_state($1, $2)' into j using key, org_ref;
    r := r || jsonb_build_object('sessao_chama_get_state', 'EXECUTOU');
  exception when others then
    r := r || jsonb_build_object('sessao_chama_get_state', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'select public.apply_referral_recalculation($1, $2, 0, 100, null, null, null)'
      into j using key, org_ref;
    r := r || jsonb_build_object('sessao_chama_apply', 'EXECUTOU');
  exception when others then
    r := r || jsonb_build_object('sessao_chama_apply', 'NEGADO:' || sqlstate);
  end;

  reset role;

  -- ---------------------------------------------------------------------------
  -- Chave do servidor
  -- ---------------------------------------------------------------------------
  begin
    j := public.get_referral_state(null, org_ref);
    r := r || jsonb_build_object('rpc_sem_chave', 'EXECUTOU');
  exception when others then
    r := r || jsonb_build_object('rpc_sem_chave', 'NEGADO:' || sqlstate);
  end;

  begin
    j := public.get_referral_state('chave-errada', org_ref);
    r := r || jsonb_build_object('rpc_chave_errada', 'EXECUTOU');
  exception when others then
    r := r || jsonb_build_object('rpc_chave_errada', 'NEGADO:' || sqlstate);
  end;

  -- ---------------------------------------------------------------------------
  -- Trava de concorrência por impressão do estado
  -- ---------------------------------------------------------------------------
  fp_antes := private.referral_state_fingerprint(org_ref);

  -- Fato de cobrança gravado por outro recálculo (ex.: 1ª fatura paga).
  update public.billing_accounts
  set first_paid_at = now() - interval '40 days', status = 'active',
      plan_key = 'corretor', billing_interval = 'month', plan_net_monthly_cents = 9900
  where organization_id = org_1;

  fp_depois := private.referral_state_fingerprint(org_ref);
  j := public.get_referral_state(key, org_ref);

  r := r || jsonb_build_object(
    'fingerprint_muda_com_cobranca', fp_antes is distinct from fp_depois,
    'fingerprint_no_get_state_bate', (j -> 'organization' ->> 'state_fingerprint') = fp_depois);

  j := public.apply_referral_recalculation(key, org_ref, 0, 10, null, null, fp_antes);
  r := r || jsonb_build_object('apply_com_fingerprint_velho', j ->> 'status');

  j := public.apply_referral_recalculation(key, org_ref, 0, 10, array[org_1], null, fp_depois);
  r := r || jsonb_build_object('apply_com_fingerprint_atual', j ->> 'status');

  select b.referral_discount_percent::text into v
  from public.billing_accounts b where b.organization_id = org_ref;
  r := r || jsonb_build_object('percentual_gravado', v);

  begin
    j := public.apply_referral_recalculation(key, org_ref, 10, 20, null, null, 'nao-e-md5');
    r := r || jsonb_build_object('fingerprint_invalido', 'ACEITO');
  exception when others then
    r := r || jsonb_build_object('fingerprint_invalido', 'RECUSADO:' || sqlstate);
  end;

  -- ---------------------------------------------------------------------------
  -- Permissões das RPCs
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'grant_authenticated', has_function_privilege('authenticated',
      'public.get_referral_state(text,uuid)', 'execute')
      or has_function_privilege('authenticated',
        'public.apply_referral_recalculation(text,uuid,integer,integer,uuid[],uuid[],text)', 'execute')
      or has_function_privilege('authenticated',
        'public.record_billing_invoice_paid(text,uuid,timestamptz,timestamptz,integer,integer)', 'execute')
      or has_function_privilege('authenticated',
        'public.set_referral_ineligibility(text,uuid,text)', 'execute')
      or has_function_privilege('authenticated',
        'public.set_referral_confirmation_notice(text,uuid,uuid,boolean)', 'execute')
      or has_function_privilege('authenticated',
        'public.list_referral_grace_completions(text,timestamptz,timestamptz,timestamptz,uuid,integer)', 'execute')
      or has_function_privilege('authenticated',
        'public.list_referral_referrers(text,text,text,integer)', 'execute'),
    'grant_anon', has_function_privilege('anon',
      'public.get_referral_state(text,uuid)', 'execute')
      and has_function_privilege('anon',
        'public.apply_referral_recalculation(text,uuid,integer,integer,uuid[],uuid[],text)', 'execute'));

  -- Máscara dos nomes (LGPD): nome completo nunca sai do banco.
  r := r || jsonb_build_object(
    'mascara_pessoa', private.mask_referral_name('Joao Silva Corretor'),
    'mascara_empresa', private.mask_referral_name('Imobiliaria Jardim Sul'),
    'mascara_uma_palavra', private.mask_referral_name('Remax'),
    'mascara_vazio', private.mask_referral_name(''));

  raise exception using errcode = 'P0001', message = r::text;
end $$;
