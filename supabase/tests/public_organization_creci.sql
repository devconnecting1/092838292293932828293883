-- =============================================================================
-- Teste do CRECI na página pública da imobiliária (get_public_organization)
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- As leituras rodam com `set local role anon` (o mesmo papel do servidor Next
-- com a chave publishable).
--
-- O que está sendo provado (migração public_organization_owner_creci):
--   1. Corretor autônomo sem CRECI J: a RPC devolve o CRECI F do dono
--      (número e UF), e nada mais do perfil (nome, telefone, e-mail, foto).
--   2. Com CRECI J preenchido, o CRECI F do dono não sai.
--   3. Só o dono conta: CRECI de corretor da equipe não vira fallback, nem o
--      de dono inativo.
--   4. As chaves da resposta são só as da allowlist; slug inexistente é null.
--   5. anon e authenticated executam (páginas públicas e pré-visualização).
--
-- Resultado esperado (a ordem das chaves pode variar):
--   autonomo_creci_f               : "12345/SP"
--   autonomo_sem_creci_j           : true
--   so_chaves_publicas             : true
--   sem_outros_dados_do_perfil     : true
--   com_creci_j_sem_fallback       : "54321-J|null|null"
--   corretor_nao_vira_fallback     : "null|null"
--   dono_inativo_nao_vira_fallback : "null|null"
--   slug_inexistente               : true
--   grant_anon                     : true
--   grant_authenticated            : false

do $$
declare
  r jsonb := '{}'::jsonb;
  u_solo uuid := gen_random_uuid();
  u_owner_j uuid := gen_random_uuid();
  u_owner_sem uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  org_solo uuid;
  org_j uuid;
  org_sem uuid;
  v jsonb;
  v_j jsonb;
  v_sem jsonb;
  v_inativo jsonb;
  allowed_keys constant text[] := array[
    'name', 'city', 'state', 'phone', 'email', 'creci', 'brand',
    'owner_creci_number', 'owner_creci_state'
  ];
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_solo, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-creci-solo@exemplo.invalid', now(), now(), now()),
    (u_owner_j, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-creci-dono-j@exemplo.invalid', now(), now(), now()),
    (u_owner_sem, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-creci-dono-sem@exemplo.invalid', now(), now(), now()),
    (u_broker, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-creci-corretor@exemplo.invalid', now(), now(), now());

  -- Perfis: o autônomo e o dono da imobiliária com CRECI J têm CRECI F; o
  -- corretor da terceira imobiliária também, mas o dono dela não.
  update public.profiles
  set full_name = 'Autonomo Sigiloso', phone = '11977776666', creci_number = ' 12345 ',
      creci_state = 'SP', avatar_url = 'https://fotos.exemplo.invalid/perfil.jpg'
  where id = u_solo;
  update public.profiles set creci_number = '99999', creci_state = 'RJ' where id = u_owner_j;
  update public.profiles set creci_number = '77777', creci_state = 'MG' where id = u_broker;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_solo, 'role', 'authenticated')::text, true);
  org_solo := public.create_organization('Corretor Autonomo Creci', 'teste-creci-autonomo');
  update public.organizations set creci = '  ', phone = '11955554444' where id = org_solo;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner_j, 'role', 'authenticated')::text, true);
  org_j := public.create_organization('Imobiliaria Creci J', 'teste-creci-juridica');
  update public.organizations set creci = '54321-J' where id = org_j;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner_sem, 'role', 'authenticated')::text, true);
  org_sem := public.create_organization('Imobiliaria Sem Creci', 'teste-creci-sem');

  update public.billing_accounts
  set limits = limits || '{"users": 20}'::jsonb
  where organization_id = org_sem;

  insert into public.memberships (organization_id, user_id, role, active)
  values (org_sem, u_broker, 'broker', true);

  -- ---------------------------------------------------------------------------
  -- Leituras como anon
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';

  v := public.get_public_organization('Teste-Creci-Autonomo');
  v_j := public.get_public_organization('teste-creci-juridica');
  v_sem := public.get_public_organization('teste-creci-sem');

  r := r || jsonb_build_object(
    'autonomo_creci_f', (v ->> 'owner_creci_number') || '/' || (v ->> 'owner_creci_state'),
    'autonomo_sem_creci_j', nullif(btrim(coalesce(v ->> 'creci', '')), '') is null,
    'so_chaves_publicas',
      (select array_agg(k) from jsonb_object_keys(v) k) <@ allowed_keys
      and (select array_agg(k) from jsonb_object_keys(v_j) k) <@ allowed_keys,
    'sem_outros_dados_do_perfil',
      position('Sigiloso' in v::text) = 0
      and position('11977776666' in v::text) = 0
      and position('teste-creci-solo@' in v::text) = 0
      and position('perfil.jpg' in v::text) = 0,
    'com_creci_j_sem_fallback',
      (v_j ->> 'creci') || '|' || coalesce(v_j ->> 'owner_creci_number', 'null') || '|'
        || coalesce(v_j ->> 'owner_creci_state', 'null'),
    'corretor_nao_vira_fallback',
      coalesce(v_sem ->> 'owner_creci_number', 'null') || '|'
        || coalesce(v_sem ->> 'owner_creci_state', 'null'),
    'slug_inexistente', public.get_public_organization('teste-creci-nao-existe') is null
  );

  execute 'reset role';

  -- Dono inativo (conta em transição): o CRECI dele não sai. O banco exige um
  -- dono ativo, então entra um sócio sem CRECI antes.
  update public.billing_accounts
  set limits = limits || '{"users": 20}'::jsonb
  where organization_id = org_solo;
  insert into public.memberships (organization_id, user_id, role, active)
  values (org_solo, u_owner_sem, 'owner', true);
  update public.memberships set active = false where organization_id = org_solo and user_id = u_solo;

  execute 'set local role anon';
  v_inativo := public.get_public_organization('teste-creci-autonomo');
  r := r || jsonb_build_object(
    'dono_inativo_nao_vira_fallback',
      coalesce(v_inativo ->> 'owner_creci_number', 'null') || '|'
        || coalesce(v_inativo ->> 'owner_creci_state', 'null')
  );
  execute 'reset role';

  r := r || jsonb_build_object(
    'grant_anon', has_function_privilege('anon', 'public.get_public_organization(text)', 'execute'),
    'grant_authenticated',
      has_function_privilege('authenticated', 'public.get_public_organization(text)', 'execute')
  );

  raise exception 'TESTE DO CRECI PUBLICO (rollback): %', jsonb_pretty(r);
end;
$$;
