-- =============================================================================
-- Teste da RPC do medidor "Imóveis com foto" (get_owned_listing_usage)
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- O que está sendo provado:
--   · o medidor devolve o MESMO número que o gatilho usa (owned_listing_count);
--   · foto importada (external_url) não conta;
--   · imóvel vendido, alugado ou inativo não conta (a regra vem do banco, e o
--     medidor acompanha sem código próprio);
--   · só membro ativo da imobiliária lê o número; estranho e sessão anônima
--     recebem 42501;
--   · a RPC pública é security invoker e só `authenticated` executa.
--
-- Resultado esperado:
--   dono_ve_contagem           : 2
--   vendido_nao_conta          : 1
--   igual_ao_gatilho           : true
--   estranho_bloqueado         : "NEGADO:42501"
--   sem_sessao_bloqueado       : "NEGADO:42501"
--   organizacao_nula_bloqueada : "NEGADO:42501"
--   rpc_security_invoker       : true
--   grant_anon                 : false
--   grant_authenticated        : true
--   grant_privada_anon         : false

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  org uuid;
  imovel_a uuid;
  imovel_b uuid;
  imovel_c uuid;
  v integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-medidor-dono@exemplo.invalid', now(), now()),
    (u_stranger, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-medidor-estranho@exemplo.invalid', now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);

  org := public.create_organization('Imobiliaria Teste Medidor', 'teste-medidor-imoveis');

  -- Preço e área preenchidos: fora do rascunho o banco exige os dois.
  insert into public.properties (organization_id, title, purpose, type, sale_price, living_area)
  values (org, 'Imovel A', 'sale', 'apartment', 500000, 80) returning id into imovel_a;
  insert into public.properties (organization_id, title, purpose, type)
  values (org, 'Imovel B', 'rent', 'house') returning id into imovel_b;
  insert into public.properties (organization_id, title, purpose, type)
  values (org, 'Imovel C', 'sale', 'apartment') returning id into imovel_c;

  -- A: duas fotos no bucket (conta 1). B: uma foto no bucket (conta 1).
  -- C: só foto importada (não conta).
  insert into public.property_media (organization_id, property_id, kind, storage_path, position)
  values
    (org, imovel_a, 'image', org::text || '/properties/' || imovel_a::text || '/a1.webp', 1),
    (org, imovel_a, 'image', org::text || '/properties/' || imovel_a::text || '/a2.webp', 2),
    (org, imovel_b, 'image', org::text || '/properties/' || imovel_b::text || '/b1.webp', 1);

  insert into public.property_media (organization_id, property_id, kind, external_url, position)
  values (org, imovel_c, 'image', 'https://origem.invalid/fotos/c1.jpg', 1);

  -- ---------------------------------------------------------------------------
  -- 1. Dono, com o papel real da API
  -- ---------------------------------------------------------------------------
  set local role authenticated;

  begin
    v := public.get_owned_listing_usage(org);
    r := r || jsonb_build_object('dono_ve_contagem', v);
  exception when others then
    r := r || jsonb_build_object('dono_ve_contagem', 'NEGADO:' || sqlstate);
  end;

  -- Vender o imóvel A libera a vaga, e o medidor acompanha.
  reset role;
  update public.properties set status = 'sold' where id = imovel_a;
  set local role authenticated;

  begin
    r := r || jsonb_build_object('vendido_nao_conta', public.get_owned_listing_usage(org));
  exception when others then
    r := r || jsonb_build_object('vendido_nao_conta', 'NEGADO:' || sqlstate);
  end;

  begin
    perform public.get_owned_listing_usage(null);
    r := r || jsonb_build_object('organizacao_nula_bloqueada', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('organizacao_nula_bloqueada', 'NEGADO:' || sqlstate);
  end;

  -- ---------------------------------------------------------------------------
  -- 2. Quem não é da imobiliária
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);

  begin
    perform public.get_owned_listing_usage(org);
    r := r || jsonb_build_object('estranho_bloqueado', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('estranho_bloqueado', 'NEGADO:' || sqlstate);
  end;

  -- ---------------------------------------------------------------------------
  -- 3. Sem sessão
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);

  begin
    perform public.get_owned_listing_usage(org);
    r := r || jsonb_build_object('sem_sessao_bloqueado', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('sem_sessao_bloqueado', 'NEGADO:' || sqlstate);
  end;

  reset role;

  -- ---------------------------------------------------------------------------
  -- 4. Mesma contagem do gatilho e grants
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'igual_ao_gatilho', (r ->> 'vendido_nao_conta')::integer = private.owned_listing_count(org),
    'rpc_security_invoker', not (
      select p.prosecdef
      from pg_proc p
      where p.oid = 'public.get_owned_listing_usage(uuid)'::regprocedure
    ),
    'grant_anon', has_function_privilege('anon', 'public.get_owned_listing_usage(uuid)', 'execute'),
    'grant_authenticated',
      has_function_privilege('authenticated', 'public.get_owned_listing_usage(uuid)', 'execute'),
    'grant_privada_anon',
      has_function_privilege('anon', 'private.owned_listing_usage(uuid)', 'execute'));

  raise exception 'TESTE DO MEDIDOR DE IMÓVEIS COM FOTO (rollback): %', jsonb_pretty(r);
end;
$$;
