-- =============================================================================
-- Teste do comissionamento: tabela versionada, divisão, extrato e desconto
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- Cenário: 1 dono, 1 gerente e 2 corretores. O imóvel foi captado pelo corretor
-- A, que também é o corretor da proposta; o gerente é o escolhido em
-- commission_settings. Tabela vigente: 6% na venda, dividida em
-- 20 captação / 30 atendimento / 10 gerência / 40 imobiliária. Nas partes 9 e
-- 10, o corretor B é o corretor de uma proposta num imóvel captado pelo A.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   comissao_criada                 : true
--   total_da_comissao               : 3000000
--   parte_captacao                  : 600000
--   parte_atendimento               : 900000
--   parte_gerencia                  : 300000
--   parte_imobiliaria               : 1200000
--   partes_fecham_o_total           : true
--   regra_congelada_no_snapshot     : 6
--   tabela_nova_fecha_a_anterior    : true
--   negocio_antigo_nao_mudou        : 3000000
--   negocio_novo_usa_a_nova         : 2000000
--   divisao_de_3_em_10000_01        : 1000001
--   sobra_fica_com_a_imobiliaria    : 1
--   arredondamento_nao_passa        : 7
--   divisao_que_nao_fecha_100       : "NEGADO:23514"
--   soma_das_partes_quebrada        : "NEGADO:P0001"
--   pagamento_parcial               : "partially_paid"
--   pagamento_total                 : "paid"
--   pagamento_no_futuro             : "NEGADO:P0001"
--   corretor_ve_so_o_dele           : 2
--   corretor_nao_ve_do_outro        : 0
--   dono_ve_tudo                    : 4
--   estranho_nao_ve_nada            : 0
--   resumo_do_corretor              : 1500000
--   corretor_marca_pago             : 0
--   corretor_cria_tabela            : "NEGADO:42501"
--   corretor_reescreve_tabela       : "NEGADO:42501"
--   percentual_sem_virgula_solta    : "10% 12,5% 0% 0,333%"
--   desconto_trava_a_proposta       : "NEGADO:P0001"
--   mensagem_com_percentual_inteiro : true
--   desconto_dentro_do_limite_passa : true
--   pedido_registrado               : true
--   gerente_aprova                  : "approved"
--   pedido_repetido_apos_aprovacao  : "NEGADO:já aprovado"
--   aprovado_libera_a_proposta      : "sent"
--   parceiro_sai_da_imobiliaria     : 300000
--   parceiro_nao_quebra_a_soma      : true
--   parceiro_mensagem_sem_virgula   : "A parte da imobiliária não cobre 90% para o parceiro."
--   troca_de_imovel_trava           : "NEGADO:desconto"
--   troca_de_finalidade_trava       : "NEGADO:desconto"
--   aprovacao_nao_cobre_imovel_mais_caro : "NEGADO:desconto"
--   aprovacao_cobre_imovel_mais_barato   : true
--   corretor_nao_le_a_linha_alheia  : 0
--   corretor_ve_o_pedido_no_resumo  : "pending"
--   resumo_esconde_justificativa_alheia : true
--   corretor_nao_toma_pedido_alheio : "NEGADO:pedido de outra pessoa"
--   autor_ve_a_propria_justificativa: true
--   gestao_ve_a_justificativa       : true
--   quem_nao_edita_nao_ve           : 0
--   estranho_nao_ve_o_resumo        : 0
--   autor_do_pedido_nao_mudou       : true

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  u_manager uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  u_other uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  org uuid;
  imovel uuid;
  imovel2 uuid;
  cliente uuid;
  prop1 uuid;
  prop2 uuid;
  prop3 uuid;
  prop4 uuid;
  prop5 uuid;
  prop6 uuid;
  imovel3 uuid;
  comissao1 uuid;
  comissao2 uuid;
  regra_antiga uuid;
  pedido uuid;
  pedido2 uuid;
  v_int bigint;
  v_text text;
  v_sum bigint;
  res jsonb;
begin
  -- ---------------------------------------------------------------------------
  -- Cenário
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-comissao-dono@exemplo.invalid', now(), now(), now()),
    (u_manager, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-comissao-gerente@exemplo.invalid', now(), now(), now()),
    (u_broker, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-comissao-corretor@exemplo.invalid', now(), now(), now()),
    (u_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-comissao-corretor2@exemplo.invalid', now(), now(), now()),
    (u_stranger, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-comissao-estranho@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Comissao', 'teste-comissoes');

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_manager, 'manager', true),
         (org, u_broker, 'broker', true),
         (org, u_other, 'broker', true);

  update public.commission_settings
  set manager_user_id = u_manager
  where organization_id = org;

  -- Tabela vigente da venda: 6%, dividida em 20/30/10/40/0.
  insert into public.commission_rules (
    organization_id, purpose, basis, percent, capturer_percent, seller_percent,
    manager_percent, agency_percent, partner_percent, note
  )
  values (org, 'sale', 'percent', 6, 20, 30, 10, 40, 0, 'Tabela do teste');

  select id into regra_antiga
  from public.commission_rules
  where organization_id = org and purpose = 'sale' and effective_to is null;

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area,
    captured_by, broker_id
  )
  values (org, 'Casa do Teste', 'sale', 'house', 'active', 500000.00, 120, u_broker, u_broker)
  returning id into imovel;

  insert into public.clients (organization_id, kind, name, assigned_to)
  values (org, 'pf', 'Cliente do Teste', u_broker)
  returning id into cliente;

  -- ---------------------------------------------------------------------------
  -- 1. Proposta aceita vira comissão com a regra congelada
  -- ---------------------------------------------------------------------------
  insert into public.proposals (
    organization_id, property_id, client_id, broker_id, purpose, amount, status
  )
  values (org, imovel, cliente, u_broker, 'sale', 500000.00, 'draft')
  returning id into prop1;

  update public.proposals set status = 'sent' where id = prop1;
  update public.proposals set status = 'accepted' where id = prop1;

  select id, total_cents into comissao1, v_int
  from public.commissions
  where proposal_id = prop1;

  r := r || jsonb_build_object('comissao_criada', comissao1 is not null);
  r := r || jsonb_build_object('total_da_comissao', v_int);

  select amount_cents into v_int
  from public.commission_shares where commission_id = comissao1 and role = 'capturer';
  r := r || jsonb_build_object('parte_captacao', v_int);

  select amount_cents into v_int
  from public.commission_shares where commission_id = comissao1 and role = 'seller';
  r := r || jsonb_build_object('parte_atendimento', v_int);

  select amount_cents into v_int
  from public.commission_shares where commission_id = comissao1 and role = 'manager';
  r := r || jsonb_build_object('parte_gerencia', v_int);

  select amount_cents into v_int
  from public.commission_shares where commission_id = comissao1 and role = 'agency';
  r := r || jsonb_build_object('parte_imobiliaria', v_int);

  select sum(s.amount_cents) into v_sum
  from public.commission_shares s where s.commission_id = comissao1;
  r := r || jsonb_build_object(
    'partes_fecham_o_total',
    v_sum = (select c.total_cents from public.commissions c where c.id = comissao1));

  select (c.rule_snapshot ->> 'percent')::numeric into v_int
  from public.commissions c where c.id = comissao1;
  r := r || jsonb_build_object('regra_congelada_no_snapshot', v_int);

  -- ---------------------------------------------------------------------------
  -- 2. Mudar a tabela hoje não mexe no negócio de ontem
  -- ---------------------------------------------------------------------------
  insert into public.commission_rules (
    organization_id, purpose, basis, percent, capturer_percent, seller_percent,
    manager_percent, agency_percent, partner_percent, note
  )
  values (org, 'sale', 'percent', 4, 10, 10, 10, 70, 0, 'Tabela nova');

  r := r || jsonb_build_object('tabela_nova_fecha_a_anterior', (
    select effective_to is not null
    from public.commission_rules where id = regra_antiga));

  select total_cents into v_int from public.commissions where id = comissao1;
  r := r || jsonb_build_object('negocio_antigo_nao_mudou', v_int);

  insert into public.proposals (
    organization_id, property_id, client_id, broker_id, purpose, amount, status
  )
  values (org, imovel, cliente, u_broker, 'sale', 500000.00, 'draft')
  returning id into prop2;

  update public.proposals set status = 'sent' where id = prop2;
  update public.proposals set status = 'accepted' where id = prop2;

  select id, total_cents into comissao2, v_int from public.commissions where proposal_id = prop2;
  r := r || jsonb_build_object('negocio_novo_usa_a_nova', v_int);

  -- ---------------------------------------------------------------------------
  -- 3. Arredondamento: três pessoas em R$ 10.000,01
  -- ---------------------------------------------------------------------------
  select sum(s.share_cents) into v_sum
  from private.commission_split(1000001, 33.333, 33.333, 33.334, 0, 0, true, true, true, false) s;
  r := r || jsonb_build_object('divisao_de_3_em_10000_01', v_sum);

  select s.share_cents into v_int
  from private.commission_split(1000001, 33.333, 33.333, 33.334, 0, 0, true, true, true, false) s
  where s.share_role = 'agency';
  r := r || jsonb_build_object('sobra_fica_com_a_imobiliaria', v_int);

  -- 50/50 de 7 centavos arredonda para 4 + 4: a diferença sai da maior parte.
  select sum(s.share_cents) into v_sum
  from private.commission_split(7, 50, 50, 0, 0, 0, true, true, false, false) s;
  r := r || jsonb_build_object('arredondamento_nao_passa', v_sum);

  -- ---------------------------------------------------------------------------
  -- 4. Divisão que não fecha 100% é erro, não arredondamento
  -- ---------------------------------------------------------------------------
  begin
    insert into public.commission_rules (
      organization_id, purpose, basis, percent, capturer_percent, seller_percent,
      manager_percent, agency_percent, partner_percent
    )
    values (org, 'rent', 'percent', 100, 20, 30, 10, 39, 0);
    r := r || jsonb_build_object('divisao_que_nao_fecha_100', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('divisao_que_nao_fecha_100', 'NEGADO:' || sqlstate);
  end;

  begin
    update public.commission_shares
    set amount_cents = amount_cents + 1
    where commission_id = comissao1 and role = 'agency';
    set constraints all immediate;
    r := r || jsonb_build_object('soma_das_partes_quebrada', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('soma_das_partes_quebrada', 'NEGADO:' || sqlstate);
  end;

  set constraints all deferred;

  -- ---------------------------------------------------------------------------
  -- 5. Pagamento das partes
  -- ---------------------------------------------------------------------------
  update public.commission_shares
  set paid_at = now(), paid_note = 'Pago no caixa'
  where commission_id = comissao1 and role = 'capturer';

  select status::text into v_text from public.commissions where id = comissao1;
  r := r || jsonb_build_object('pagamento_parcial', v_text);

  update public.commission_shares
  set paid_at = now()
  where commission_id = comissao1 and paid_at is null;

  select status::text into v_text from public.commissions where id = comissao1;
  r := r || jsonb_build_object('pagamento_total', v_text);

  begin
    update public.commission_shares
    set paid_at = now() + interval '30 days'
    where commission_id = comissao2 and role = 'agency';
    r := r || jsonb_build_object('pagamento_no_futuro', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('pagamento_no_futuro', 'NEGADO:' || sqlstate);
  end;

  -- ---------------------------------------------------------------------------
  -- 6. RLS: o corretor enxerga só o extrato dele
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select count(*) from public.commission_shares where commission_id = $1'
    into v_int using comissao1;
  r := r || jsonb_build_object('corretor_ve_so_o_dele', v_int);

  execute 'select count(*) from public.commission_shares
           where commission_id = $1 and user_id is distinct from $2'
    into v_int using comissao1, u_broker;
  r := r || jsonb_build_object('corretor_nao_ve_do_outro', v_int);

  execute 'select (public.commission_summary($1) ->> ''paid_cents'')::bigint'
    into v_int using u_broker;
  r := r || jsonb_build_object('resumo_do_corretor', v_int);

  -- Marcar pagamento não é do corretor: a política de UPDATE não o alcança.
  execute 'with alterado as (
             update public.commission_shares set paid_at = null
             where commission_id = $1 returning 1
           ) select count(*) from alterado'
    into v_int using comissao2;
  r := r || jsonb_build_object('corretor_marca_pago', v_int);

  begin
    execute 'insert into public.commission_rules (
               organization_id, purpose, basis, percent, capturer_percent, seller_percent,
               manager_percent, agency_percent, partner_percent
             ) values ($1, ''rent'', ''percent'', 100, 20, 30, 10, 40, 0)' using org;
    r := r || jsonb_build_object('corretor_cria_tabela', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('corretor_cria_tabela', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'update public.commission_rules set percent = 99 where organization_id = $1' using org;
    r := r || jsonb_build_object('corretor_reescreve_tabela', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('corretor_reescreve_tabela', 'NEGADO:' || sqlstate);
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  execute 'select count(*) from public.commission_shares where commission_id = $1'
    into v_int using comissao1;
  r := r || jsonb_build_object('dono_ve_tudo', v_int);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  execute 'select count(*) from public.commission_shares where commission_id = $1'
    into v_int using comissao1;
  r := r || jsonb_build_object('estranho_nao_ve_nada', v_int);

  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);

  -- ---------------------------------------------------------------------------
  -- 7. Aprovação de desconto
  -- ---------------------------------------------------------------------------
  -- Percentual inteiro sai sem a vírgula solta ("10,%" era o defeito).
  r := r || jsonb_build_object('percentual_sem_virgula_solta', concat_ws(' ',
    private.milli_percent_text(10000), private.milli_percent_text(12500),
    private.milli_percent_text(0), private.milli_percent_text(333)));

  update public.commission_settings
  set discount_approval_enabled = true, max_discount_percent = 5
  where organization_id = org;

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area,
    captured_by, broker_id
  )
  values (org, 'Apartamento do Teste', 'sale', 'apartment', 'active', 400000.00, 70, u_broker, u_broker)
  returning id into imovel2;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);

  -- 20% abaixo do anunciado: passa do limite de 5%.
  insert into public.proposals (
    organization_id, property_id, client_id, broker_id, purpose, amount, status
  )
  values (org, imovel2, cliente, u_broker, 'sale', 320000.00, 'draft')
  returning id into prop3;

  v_text := null;

  begin
    update public.proposals set status = 'sent' where id = prop3;
    r := r || jsonb_build_object('desconto_trava_a_proposta', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('desconto_trava_a_proposta', 'NEGADO:' || sqlstate);
    v_text := sqlerrm;
  end;

  -- 20% e 5% são inteiros; o trecho "que dispensa aprovação" é o que a tela lê.
  r := r || jsonb_build_object('mensagem_com_percentual_inteiro',
    position('dá 20% de desconto' in coalesce(v_text, '')) > 0
    and position('limite de 5% que dispensa aprovação' in coalesce(v_text, '')) > 0);

  -- 4% abaixo: dentro do limite, segue sem aprovação.
  update public.proposals set amount = 384000.00 where id = prop3;
  update public.proposals set status = 'sent' where id = prop3;
  r := r || jsonb_build_object('desconto_dentro_do_limite_passa', (
    select status = 'sent' from public.proposals where id = prop3));

  update public.proposals set status = 'countered' where id = prop3;
  update public.proposals set amount = 320000.00 where id = prop3;

  res := public.request_proposal_discount(prop3, 'Cliente paga à vista.');
  pedido := (res ->> 'id')::uuid;
  r := r || jsonb_build_object('pedido_registrado', pedido is not null);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_manager, 'role', 'authenticated')::text, true);
  res := public.review_proposal_discount(pedido, true, 'Aprovado por telefone.');
  r := r || jsonb_build_object('gerente_aprova', res ->> 'status');

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);

  -- Pedir de novo o que já foi aprovado não abre outro pedido.
  begin
    res := public.request_proposal_discount(prop3, 'De novo.');
    r := r || jsonb_build_object('pedido_repetido_apos_aprovacao', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('pedido_repetido_apos_aprovacao',
      case when sqlerrm like '%já aprovou este desconto%' then 'NEGADO:já aprovado'
           else 'NEGADO:' || sqlstate || ' ' || sqlerrm end);
  end;

  update public.proposals set status = 'sent' where id = prop3;
  r := r || jsonb_build_object('aprovado_libera_a_proposta', (
    select status::text from public.proposals where id = prop3));

  -- ---------------------------------------------------------------------------
  -- 8. Parceiro externo sai da parte da imobiliária
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);

  update public.commission_shares set paid_at = null where commission_id = comissao2;
  res := public.set_commission_partner(comissao2, 'Imobiliaria Parceira', 15);

  select amount_cents into v_int
  from public.commission_shares where commission_id = comissao2 and role = 'partner';
  r := r || jsonb_build_object('parceiro_sai_da_imobiliaria', v_int);

  select sum(s.amount_cents) into v_sum
  from public.commission_shares s where s.commission_id = comissao2;
  r := r || jsonb_build_object('parceiro_nao_quebra_a_soma', (
    v_sum = (select c.total_cents from public.commissions c where c.id = comissao2)));

  -- 90% de R$ 20.000 não cabe nos R$ 14.000 da imobiliária + parceiro.
  begin
    res := public.set_commission_partner(comissao2, 'Imobiliaria Parceira', 90);
    r := r || jsonb_build_object('parceiro_mensagem_sem_virgula', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('parceiro_mensagem_sem_virgula', sqlerrm);
  end;

  -- ---------------------------------------------------------------------------
  -- 9. Trocar imóvel ou finalidade de proposta enviada confere o desconto de novo
  -- ---------------------------------------------------------------------------
  -- Venda por R$ 380.000 e locação por R$ 3.000.
  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, rent_price, living_area,
    captured_by, broker_id
  )
  values (org, 'Sala do Teste', 'sale_rent', 'commercial_room', 'active', 380000.00, 3000.00, 40,
          u_broker, u_broker)
  returning id into imovel3;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);

  -- 4% no apartamento de R$ 400.000 passa; na casa de R$ 500.000 vira 23,2%.
  insert into public.proposals (
    organization_id, property_id, client_id, broker_id, purpose, amount, status
  )
  values (org, imovel2, cliente, u_broker, 'sale', 384000.00, 'sent')
  returning id into prop5;

  begin
    update public.proposals set property_id = imovel where id = prop5;
    r := r || jsonb_build_object('troca_de_imovel_trava', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('troca_de_imovel_trava',
      case when sqlerrm like '%que dispensa aprovação%' then 'NEGADO:desconto'
           else 'NEGADO:' || sqlstate || ' ' || sqlerrm end);
  end;

  -- Locação de R$ 2.950 sobre R$ 3.000 passa; como venda, sobre R$ 380.000, não.
  insert into public.proposals (
    organization_id, property_id, client_id, broker_id, purpose, amount, status
  )
  values (org, imovel3, cliente, u_broker, 'rent', 2950.00, 'sent')
  returning id into prop6;

  begin
    update public.proposals set purpose = 'sale' where id = prop6;
    r := r || jsonb_build_object('troca_de_finalidade_trava', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('troca_de_finalidade_trava',
      case when sqlerrm like '%que dispensa aprovação%' then 'NEGADO:desconto'
           else 'NEGADO:' || sqlstate || ' ' || sqlerrm end);
  end;

  -- prop3 foi aprovada a R$ 320.000 sobre R$ 400.000. Na casa de R$ 500.000 o
  -- desconto cresce e a aprovação não cobre; na sala de R$ 380.000, cobre.
  begin
    update public.proposals set property_id = imovel where id = prop3;
    r := r || jsonb_build_object('aprovacao_nao_cobre_imovel_mais_caro', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('aprovacao_nao_cobre_imovel_mais_caro',
      case when sqlerrm like '%que dispensa aprovação%' then 'NEGADO:desconto'
           else 'NEGADO:' || sqlstate || ' ' || sqlerrm end);
  end;

  update public.proposals set property_id = imovel3 where id = prop3;
  r := r || jsonb_build_object('aprovacao_cobre_imovel_mais_barato', (
    select property_id = imovel3 and status = 'sent' from public.proposals where id = prop3));

  -- ---------------------------------------------------------------------------
  -- 10. Quem vê o pedido de desconto
  -- ---------------------------------------------------------------------------
  -- Proposta do corretor B no apartamento captado pelo corretor A; quem pede a
  -- aprovação é o A (edita o imóvel).
  insert into public.proposals (
    organization_id, property_id, client_id, broker_id, purpose, amount, status
  )
  values (org, imovel2, cliente, u_other, 'sale', 300000.00, 'draft')
  returning id into prop4;

  res := public.request_proposal_discount(prop4, 'Captador negociou com o proprietário.');
  pedido2 := (res ->> 'id')::uuid;

  set local role authenticated;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_other, 'role', 'authenticated')::text, true);

  -- O RLS da tabela não mudou: a linha continua só da gestão e do autor.
  execute 'select count(*) from public.proposal_discount_requests where proposal_id = $1'
    into v_int using prop4;
  r := r || jsonb_build_object('corretor_nao_le_a_linha_alheia', v_int);

  execute 'select min(status::text) from public.list_proposal_discount_requests($1, array[$2]::uuid[])'
    into v_text using org, prop4;
  r := r || jsonb_build_object('corretor_ve_o_pedido_no_resumo', v_text);

  execute 'select bool_and(not requested_by_me and reason is null)
           from public.list_proposal_discount_requests($1, array[$2]::uuid[])'
    into v_text using org, prop4;
  r := r || jsonb_build_object('resumo_esconde_justificativa_alheia', v_text::boolean);

  begin
    execute 'select public.request_proposal_discount($1, $2)'
      into res using prop4, 'Quero outro valor.';
    r := r || jsonb_build_object('corretor_nao_toma_pedido_alheio', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('corretor_nao_toma_pedido_alheio',
      case when sqlerrm like '%Outra pessoa da equipe já pediu%' then 'NEGADO:pedido de outra pessoa'
           else 'NEGADO:' || sqlstate || ' ' || sqlerrm end);
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  execute 'select bool_and(requested_by_me and reason is not null)
           from public.list_proposal_discount_requests($1, array[$2]::uuid[])'
    into v_text using org, prop4;
  r := r || jsonb_build_object('autor_ve_a_propria_justificativa', v_text::boolean);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_manager, 'role', 'authenticated')::text, true);
  execute 'select bool_and(not requested_by_me and reason is not null)
           from public.list_proposal_discount_requests($1, array[$2]::uuid[])'
    into v_text using org, prop4;
  r := r || jsonb_build_object('gestao_ve_a_justificativa', v_text::boolean);

  -- O corretor B não edita a sala nem é o corretor da prop3 (aprovada).
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  execute 'select count(*) from public.list_proposal_discount_requests($1, array[$2]::uuid[])'
    into v_int using org, prop3;
  r := r || jsonb_build_object('quem_nao_edita_nao_ve', v_int);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  execute 'select count(*) from public.list_proposal_discount_requests($1, array[$2, $3]::uuid[])'
    into v_int using org, prop3, prop4;
  r := r || jsonb_build_object('estranho_nao_ve_o_resumo', v_int);

  reset role;

  r := r || jsonb_build_object('autor_do_pedido_nao_mudou', (
    select requested_by = u_broker and reason = 'Captador negociou com o proprietário.'
    from public.proposal_discount_requests where id = pedido2));

  raise exception 'TESTE DE COMISSOES (rollback): %', jsonb_pretty(r);
end;
$$;
