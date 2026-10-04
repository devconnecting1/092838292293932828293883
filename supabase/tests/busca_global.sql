-- =============================================================================
-- Teste da busca de clientes sem acento e da busca única do cabeçalho
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- O que está sendo provado:
--
--   1. search_clients ignora acento e maiúsculas ("joao" e "JOÃO" acham "João";
--      "conceicao" acha "Conceição"), acha telefone salvo com máscara pelos
--      dígitos, documento, e aplica os filtros (sem responsável, etiqueta) e a
--      paginação com o total.
--   2. search_crm devolve clientes, leads e imóveis agrupados, por nome sem
--      acento, telefone (só dígitos) e código do imóvel (IMV-000123 ou 123).
--      O código do sistema anterior (properties.external_code, gravado pela
--      importação) também acha o imóvel, na busca global e na lista de imóveis.
--   3. O RLS continua valendo: o corretor não acha cliente nem lead do colega, e
--      membro de outra imobiliária não acha nada.
--   4. Termo com menos de 2 caracteres não devolve nada; curinga (% e _) é texto.
--   5. `anon` não executa nenhuma das RPCs.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   clientes_joao_sem_acento          : 1
--   clientes_joao_maiusculo           : 1
--   clientes_conceicao                : "Maria Conceição"
--   clientes_whatsapp_com_mascara     : "Maria Conceição"
--   clientes_documento                : "João da Silva"
--   clientes_sem_responsavel          : "Ação Imóveis Ltda"
--   clientes_etiqueta                 : "João da Silva"
--   clientes_pagina_2_total           : "1|3"
--   clientes_curinga_literal          : 0
--   corretor_nao_ve_cliente_do_colega : 0
--   crm_dono_joao                     : "client:João da Silva lead:Lead do Colega João"
--   crm_corretor_joao                 : "client:João da Silva"
--   crm_telefone_do_lead              : "lead:Joana Araújo"
--   crm_codigo_completo               : "property:Casa no Jardim Botânico"
--   crm_numero_do_codigo              : "client:João da Silva property:Casa no Jardim Botânico"
--   crm_titulo_sem_acento             : "property:Casa no Jardim Botânico"
--   crm_codigo_externo                : "property:Casa no Jardim Botânico"
--   lista_codigo_externo              : 1
--   crm_termo_curto                   : 0
--   crm_limite_por_tipo               : 2
--   estranho_nao_acha_nada            : 0
--   grant_clientes_anon               : false
--   grant_clientes_authenticated      : true
--   grant_crm_anon                    : false
--   grant_crm_authenticated           : true

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  u_b1 uuid := gen_random_uuid();
  u_b2 uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  org uuid;
  org_b uuid;
  imovel uuid;
  v_code text;
  v_text text;
  v_int integer;
begin
  -- ---------------------------------------------------------------------------
  -- Cenário
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-busca-dono@exemplo.invalid', now(), now(), now()),
    (u_b1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-busca-b1@exemplo.invalid', now(), now(), now()),
    (u_b2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-busca-b2@exemplo.invalid', now(), now(), now()),
    (u_stranger, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-busca-estranho@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Busca', 'teste-busca-global');

  -- Limites folgados: o teste não é sobre o plano.
  update public.billing_accounts
  set limits = limits || '{"owned_listings": 100, "users": 20}'::jsonb
  where organization_id = org;

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_b1, 'broker', true), (org, u_b2, 'broker', true);

  -- Rodízio desligado: quem escolhe o responsável é o teste.
  insert into public.lead_routing_settings (organization_id, roulette_enabled, sla_minutes)
  values (org, false, 60);

  insert into public.clients (organization_id, kind, name, document, phone, assigned_to, tags)
  values (org, 'pf', 'João da Silva', '12345678909', '11987654321', u_b1, array['vip']);
  -- WhatsApp salvo com máscara (dado antigo ou importado): a busca usa os dígitos.
  insert into public.clients (organization_id, kind, name, whatsapp, assigned_to)
  values (org, 'pf', 'Maria Conceição', '(21) 99876-5432', u_b2);
  insert into public.clients (organization_id, kind, name, trade_name, assigned_to)
  values (org, 'pj', 'Ação Imóveis Ltda', 'Ação Imóveis', null);
  update public.clients set created_at = now() - interval '1 day' where organization_id = org;

  insert into public.leads (organization_id, name, phone, source, stage, assigned_to)
  values
    (org, 'Joana Araújo', '11912345678', 'portal', 'new', u_b1),
    (org, 'Lead do Colega João', '11955554444', 'portal', 'new', u_b2);

  -- O código é gerado pelo banco e não muda depois: o contador é adiantado para
  -- o imóvel nascer como IMV-004321.
  insert into private.organization_counters (organization_id, counter, last_value)
  values (org, 'property_code', 4320)
  on conflict (organization_id, counter) do update set last_value = 4320;

  -- external_code: código do imóvel no sistema anterior (vem da importação).
  insert into public.properties
    (organization_id, title, purpose, type, captured_by, broker_id, neighborhood, city, external_code)
  values
    (org, 'Casa no Jardim Botânico', 'sale', 'house', u_b1, u_b1, 'Jardim Botânico', 'Rio de Janeiro',
     'SIS-7788')
  returning id, code into imovel, v_code;

  -- Outra imobiliária, para o teste de isolamento.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  org_b := public.create_organization('Imobiliaria Teste Busca B', 'teste-busca-global-b');

  -- ---------------------------------------------------------------------------
  -- 1. search_clients na sessão do dono
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*)::integer into v_int from public.search_clients(org, 'joao');
  r := r || jsonb_build_object('clientes_joao_sem_acento', v_int);

  select count(*)::integer into v_int from public.search_clients(org, 'JOÃO');
  r := r || jsonb_build_object('clientes_joao_maiusculo', v_int);

  select string_agg(c.name, ',') into v_text from public.search_clients(org, 'conceicao') c;
  r := r || jsonb_build_object('clientes_conceicao', v_text);

  select string_agg(c.name, ',') into v_text from public.search_clients(org, '99876-54') c;
  r := r || jsonb_build_object('clientes_whatsapp_com_mascara', v_text);

  select string_agg(c.name, ',') into v_text from public.search_clients(org, '123.456.789') c;
  r := r || jsonb_build_object('clientes_documento', v_text);

  select string_agg(c.name, ',') into v_text
  from public.search_clients(org, p_unassigned => true) c;
  r := r || jsonb_build_object('clientes_sem_responsavel', v_text);

  select string_agg(c.name, ',') into v_text from public.search_clients(org, p_tag => 'vip') c;
  r := r || jsonb_build_object('clientes_etiqueta', v_text);

  select count(*)::integer || '|' || coalesce(max(c.total_count), 0) into v_text
  from public.search_clients(org, p_limit => 2, p_offset => 2) c;
  r := r || jsonb_build_object('clientes_pagina_2_total', v_text);

  select count(*)::integer into v_int from public.search_clients(org, '%');
  r := r || jsonb_build_object('clientes_curinga_literal', v_int);

  -- ---------------------------------------------------------------------------
  -- 2. search_crm na sessão do dono
  -- ---------------------------------------------------------------------------
  select string_agg(h.entity || ':' || h.title, ' ') into v_text
  from public.search_crm(org, 'joao') h;
  r := r || jsonb_build_object('crm_dono_joao', v_text);

  select string_agg(h.entity || ':' || h.title, ' ') into v_text
  from public.search_crm(org, '(11) 91234') h;
  r := r || jsonb_build_object('crm_telefone_do_lead', v_text);

  select string_agg(h.entity || ':' || h.title, ' ') into v_text
  from public.search_crm(org, lower(v_code)) h;
  r := r || jsonb_build_object('crm_codigo_completo', v_text);

  -- "4321" é o número do código (IMV-004321) e também o fim do telefone do João:
  -- os dois aparecem, cada um no seu grupo.
  select string_agg(h.entity || ':' || h.title, ' ') into v_text
  from public.search_crm(org, '4321') h;
  r := r || jsonb_build_object('crm_numero_do_codigo', v_text);

  select string_agg(h.entity || ':' || h.title, ' ') into v_text
  from public.search_crm(org, 'botanico') h;
  r := r || jsonb_build_object('crm_titulo_sem_acento', v_text);

  select string_agg(h.entity || ':' || h.title, ' ') into v_text
  from public.search_crm(org, 'sis-7788') h;
  r := r || jsonb_build_object('crm_codigo_externo', v_text);

  select count(*)::integer into v_int from public.search_properties(org, 'SIS-7788');
  r := r || jsonb_build_object('lista_codigo_externo', v_int);

  select count(*)::integer into v_int from public.search_crm(org, 'j');
  r := r || jsonb_build_object('crm_termo_curto', v_int);

  select count(*)::integer into v_int from public.search_crm(org, 'ao', 2) h where h.entity = 'client';
  r := r || jsonb_build_object('crm_limite_por_tipo', v_int);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 3. Corretor b1: só o que é dele
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_b1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*)::integer into v_int from public.search_clients(org, 'maria');
  r := r || jsonb_build_object('corretor_nao_ve_cliente_do_colega', v_int);

  select string_agg(h.entity || ':' || h.title, ' ') into v_text
  from public.search_crm(org, 'joão') h;
  r := r || jsonb_build_object('crm_corretor_joao', v_text);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 4. Membro de outra imobiliária
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select
    (select count(*) from public.search_crm(org, 'joao'))
    + (select count(*) from public.search_crm(org, '4321'))
    + (select count(*) from public.search_clients(org))
  into v_int;
  r := r || jsonb_build_object('estranho_nao_acha_nada', v_int);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 5. Permissões
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'grant_clientes_anon',
    has_function_privilege(
      'anon',
      'public.search_clients(uuid, text, public.client_kind, uuid, boolean, text, text, integer, integer)',
      'execute'
    ),
    'grant_clientes_authenticated',
    has_function_privilege(
      'authenticated',
      'public.search_clients(uuid, text, public.client_kind, uuid, boolean, text, text, integer, integer)',
      'execute'
    ),
    'grant_crm_anon',
    has_function_privilege('anon', 'public.search_crm(uuid, text, integer)', 'execute'),
    'grant_crm_authenticated',
    has_function_privilege('authenticated', 'public.search_crm(uuid, text, integer)', 'execute')
  );

  raise exception 'TESTE DA BUSCA GLOBAL (rollback): %', jsonb_pretty(r);
end;
$$;
