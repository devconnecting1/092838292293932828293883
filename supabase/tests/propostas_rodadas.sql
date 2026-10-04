-- =============================================================================
-- Teste das rodadas da negociação (proposal_rounds)
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- O que está sendo provado:
--
--   1. Criar a proposta grava a rodada 1 (proposta inicial) com quem registrou.
--   2. Mudar valor ou condições grava uma rodada nova com o retrato completo;
--      mudar só o status não grava. O número da rodada é do banco (o cliente
--      não força).
--   3. Contraproposta do proprietário e nova oferta do cliente viram rodadas
--      com sinal, financiamento, permuta e prazo; rascunho não aceita
--      contraproposta; a negociação não volta a "proposta inicial"; proposta
--      encerrada não ganha rodada.
--   4. Rodada é imutável: authenticated não insere, altera nem apaga; nem o
--      dono do banco altera (gatilho). Apagar a proposta leva as rodadas.
--   5. O documento da proposta (CRM e link público) traz a rodada vigente, e o
--      link público respeita o modo "bairro" do endereço.
--   6. Nenhuma proposta existente ficou sem rodada 1.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   rodada_1_ao_criar                : "1|initial|900000.00|true"
--   rascunho_editado_vira_rodada_2   : "2|initial|910000.00"
--   so_status_nao_grava              : 2
--   numero_forcado                   : "42501|2"
--   rascunho_nao_aceita_contraproposta : "P0001"
--   contraproposta                   : "3|owner_counter|980000.00|100000.00|Escritura em 60 dias"
--   nova_oferta                      : "4|client_offer|950000.00|500000.00|Apartamento menor no Tatuape"
--   volta_para_inicial               : "P0001"
--   linha_do_tempo                   : "initial:900000.00 initial:910000.00 owner_counter:980000.00 client_offer:950000.00"
--   autor_das_rodadas                : true
--   documento_rodada_vigente         : "4|client_offer|500000.00"
--   link_publico_rodada_vigente      : "4|client_offer"
--   link_publico_sem_rua             : true
--   corretor_insere_rodada           : "42501"
--   corretor_update_direto           : "42501"
--   corretor_apaga_rodada            : "42501"
--   banco_altera_rodada              : "42501"
--   encerrada_nao_ganha_rodada       : "P0001"
--   apagar_proposta_leva_rodadas     : 0
--   propostas_sem_rodada             : 0

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  org uuid;
  imovel uuid;
  cliente uuid;
  proposta uuid;
  rascunho uuid;
  v_int integer;
  v_bool boolean;
  v_text text;
  v_json jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-rodadas-dono@exemplo.invalid', now(), now(), now()),
    (u_broker, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-rodadas-corretor@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Rodadas', 'teste-propostas-rodadas');

  update public.billing_accounts
  set limits = limits || '{"owned_listings": 100, "users": 20}'::jsonb
  where organization_id = org;

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_broker, 'broker', true);

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, street,
    street_number, neighborhood, city, address_display, captured_by
  )
  values (
    org, 'Casa da negociacao', 'sale', 'house', 'active', 1000000, 200, 'Rua Escondida', '77',
    'Tatuape', 'Sao Paulo', 'neighborhood', u_broker
  )
  returning id into imovel;

  insert into public.clients (organization_id, kind, name, assigned_to)
  values (org, 'pf', 'Comprador Rodadas', u_broker)
  returning id into cliente;

  -- ---------------------------------------------------------------------------
  -- 1 a 3. Corretor negocia
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute $q$
    insert into public.proposals (organization_id, property_id, client_id, broker_id, purpose, amount, status)
    values ($1, $2, $3, $4, 'sale', 900000, 'draft')
    returning id
  $q$ into proposta using org, imovel, cliente, u_broker;

  execute $q$
    select r.round_number || '|' || r.kind || '|' || r.amount || '|' || (r.created_by = $2)
    from public.proposal_rounds r where r.proposal_id = $1
  $q$ into v_text using proposta, u_broker;
  r := r || jsonb_build_object('rodada_1_ao_criar', v_text);

  execute 'update public.proposals set amount = 910000 where id = $1' using proposta;
  execute $q$
    select p.round_number || '|' || p.round_kind || '|' || p.amount
    from public.proposals p where p.id = $1
  $q$ into v_text using proposta;
  r := r || jsonb_build_object('rascunho_editado_vira_rodada_2', v_text);

  execute 'update public.proposals set status = $2::public.proposal_status where id = $1' using proposta, 'sent';
  execute 'select count(*)::integer from public.proposal_rounds where proposal_id = $1'
  into v_int using proposta;
  r := r || jsonb_build_object('so_status_nao_grava', v_int);

  -- round_number não tem grant de UPDATE (e o gatilho ignoraria o valor).
  begin
    execute 'update public.proposals set round_number = 99 where id = $1' using proposta;
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  execute 'select round_number from public.proposals where id = $1' into v_int using proposta;
  r := r || jsonb_build_object('numero_forcado', v_text || '|' || v_int);

  execute $q$
    insert into public.proposals (organization_id, property_id, client_id, broker_id, purpose, amount, status)
    values ($1, $2, $3, $4, 'sale', 700000, 'draft')
    returning id
  $q$ into rascunho using org, imovel, cliente, u_broker;

  begin
    execute 'update public.proposals set round_kind = $2::public.proposal_round_kind, amount = 750000 where id = $1'
    using rascunho, 'owner_counter';
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('rascunho_nao_aceita_contraproposta', v_text);

  execute $q$
    update public.proposals
    set status = 'countered', round_kind = 'owner_counter', amount = 980000,
        down_payment = 100000, payment_deadline = 'Escritura em 60 dias'
    where id = $1
  $q$ using proposta;
  execute $q$
    select r.round_number || '|' || r.kind || '|' || r.amount || '|' || r.down_payment || '|' || r.payment_deadline
    from public.proposal_rounds r where r.proposal_id = $1 and r.round_number = 3
  $q$ into v_text using proposta;
  r := r || jsonb_build_object('contraproposta', v_text);

  execute $q$
    update public.proposals
    set status = 'sent', round_kind = 'client_offer', amount = 950000,
        financing_amount = 500000, exchange_description = 'Apartamento menor no Tatuape'
    where id = $1
  $q$ using proposta;
  execute $q$
    select r.round_number || '|' || r.kind || '|' || r.amount || '|' || r.financing_amount || '|' || r.exchange_description
    from public.proposal_rounds r where r.proposal_id = $1 and r.round_number = 4
  $q$ into v_text using proposta;
  r := r || jsonb_build_object('nova_oferta', v_text);

  begin
    execute 'update public.proposals set round_kind = $2::public.proposal_round_kind, amount = 940000 where id = $1'
    using proposta, 'initial';
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('volta_para_inicial', v_text);

  execute $q$
    select string_agg(r.kind || ':' || r.amount, ' ' order by r.round_number),
           bool_and(r.created_by = $2)
    from public.proposal_rounds r where r.proposal_id = $1
  $q$ into v_text, v_bool using proposta, u_broker;
  r := r || jsonb_build_object('linha_do_tempo', v_text, 'autor_das_rodadas', v_bool);

  execute 'select public.get_proposal_document($1)' into v_json using proposta;
  r := r || jsonb_build_object(
    'documento_rodada_vigente',
    (v_json #>> '{proposal,round_number}') || '|' || (v_json #>> '{proposal,round_kind}') || '|'
      || (v_json #>> '{proposal,financing_amount}')
  );

  -- ---------------------------------------------------------------------------
  -- 4. Imutável
  -- ---------------------------------------------------------------------------
  begin
    execute $q$
      insert into public.proposal_rounds (organization_id, proposal_id, round_number, kind, amount)
      values ($1, $2, 50, 'client_offer', 1)
    $q$ using org, proposta;
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_insere_rodada', v_text);

  begin
    execute 'with u as (update public.proposal_rounds set amount = 1 where proposal_id = $1 returning 1) select count(*)::integer from u'
    into v_int using proposta;
    v_text := v_int::text;
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_update_direto', v_text);

  begin
    execute 'with d as (delete from public.proposal_rounds where proposal_id = $1 returning 1) select count(*)::integer from d'
    into v_int using proposta;
    v_text := v_int::text;
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_apaga_rodada', v_text);

  reset role;

  begin
    update public.proposal_rounds set amount = 1 where proposal_id = proposta;
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('banco_altera_rodada', v_text);

  -- ---------------------------------------------------------------------------
  -- 5. Link público com a rodada vigente, sem a rua (modo bairro)
  -- ---------------------------------------------------------------------------
  insert into public.proposal_shares (organization_id, proposal_id, token, expires_at)
  values (org, proposta, repeat('ef', 24), now() + interval '5 days');

  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  execute 'select public.get_shared_proposal($1)' into v_json using repeat('ef', 24);
  reset role;

  r := r || jsonb_build_object(
    'link_publico_rodada_vigente',
    (v_json #>> '{proposal,round_number}') || '|' || (v_json #>> '{proposal,round_kind}'),
    'link_publico_sem_rua',
    (v_json #>> '{property,street}') is null
      and (v_json #>> '{property,street_number}') is null
      and position('Escondida' in v_json::text) = 0
  );

  -- ---------------------------------------------------------------------------
  -- 3 (fim). Proposta encerrada não ganha rodada; 4 (fim). Apagar leva rodadas
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'update public.proposals set status = $2::public.proposal_status where id = $1' using proposta, 'withdrawn';

  begin
    execute 'update public.proposals set down_payment = 1 where id = $1' using proposta;
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('encerrada_nao_ganha_rodada', v_text);

  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'delete from public.proposals where id = $1' using proposta;

  reset role;

  select count(*)::integer into v_int from public.proposal_rounds where proposal_id = proposta;
  r := r || jsonb_build_object('apagar_proposta_leva_rodadas', v_int);

  -- ---------------------------------------------------------------------------
  -- 6. Migração: toda proposta tem rodada vigente
  -- ---------------------------------------------------------------------------
  select count(*)::integer into v_int
  from public.proposals p
  where not exists (
    select 1 from public.proposal_rounds pr
    where pr.proposal_id = p.id and pr.round_number = p.round_number
  );
  r := r || jsonb_build_object('propostas_sem_rodada', v_int);

  raise exception 'TESTE DAS RODADAS DA PROPOSTA (rollback): %', jsonb_pretty(r);
end;
$$;
