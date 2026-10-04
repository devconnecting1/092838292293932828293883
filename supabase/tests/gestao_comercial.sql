-- =============================================================================
-- Teste da gestão comercial: equipes, líder, metas, previsão e custo por lead
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- O que está sendo provado:
--
--   1. Equipes: só dono e gerente criam; o líder entra sozinho na equipe.
--   2. O líder da equipe B vê SÓ a equipe B — mandando `p_team_id` da equipe A
--      ou o id de um corretor da A, continua recebendo a B. Corretor comum vê só
--      a própria linha. A soma dos subtotais das equipes (mais quem não tem
--      equipe) é o total da imobiliária.
--   3. Valor fechado separado: venda de R$ 500.000 e locação de R$ 3.000 não se
--      misturam.
--   4. Metas: dono grava (e regrava sem duplicar), corretor não grava; o
--      relatório traz meta e realizado por corretor e por equipe; o RLS mostra ao
--      líder só as metas da equipe dele; copiar para o mês seguinte.
--   5. Previsão: 2 propostas "Enviada" de R$ 500 mil a 30% + 1 "Contraproposta"
--      de R$ 400 mil a 50% = R$ 500.000 ponderado; a locação não entra na soma de
--      venda; o dono muda a probabilidade (corretor não); a data prevista segue a
--      permissão de editar a proposta.
--   6. Custo por lead: R$ 3.000 na campanha → 3 leads e 1 ganho = CPL R$ 1.000 e
--      custo por ganho R$ 3.000; o investimento do canal sem campanha cobre o
--      resto do canal; investimento sem lead aparece com zero lead; proporcional
--      aos dias do período; some com filtro de equipe.
--   7. Exportação do relatório agregado grava a equipe e exige a mesma equipe.
--   8. Membro de outra imobiliária não tira nada; `anon` não executa nada.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   corretor_cria_equipe              : "42501"
--   lider_entrou_na_equipe            : true
--   dono_total_recebidos              : 6
--   dono_equipe_a_recebidos           : 3
--   dono_equipe_b_recebidos           : 2
--   subtotais_somam_o_total           : true
--   lider_b_pede_equipe_a             : "lb,b1"
--   lider_b_pede_corretor_da_a        : "lb,b1"
--   lider_b_pede_o_proprio_corretor   : "b1"
--   lider_b_assinatura_antiga         : 2
--   corretor_pede_equipe              : 1
--   lider_a_funil_pedindo_b           : 4  (3 entradas em "Novo" + 1 em "Perdido")
--   lider_a_motivos_pedindo_b         : "Sem crédito:1"
--   venda_e_locacao_separadas         : "1/500000.00|1/3000.00|503000.00"
--   corretor_grava_meta               : "42501"
--   metas_sem_duplicar                : 1
--   meta_do_b1                        : "2|1/500000.00|1/3000.00|visitas:1"
--   meta_da_equipe_b                  : "5|1"
--   lider_b_linhas_de_meta            : "team:1 broker:2"
--   lider_b_pede_metas_da_a           : "team:1 broker:2"
--   rls_metas_lider_b                 : 2
--   rls_metas_lider_a                 : 0
--   rls_metas_corretor_b1             : 1
--   metas_copiadas                    : 2
--   previsao_venda_mes_padrao         : "3|1400000.00|500000.00"
--   previsao_locacao_mes_padrao       : "1|3000.00|900.00"
--   corretor_muda_probabilidade       : "42501"
--   previsao_venda_mes_do_dono        : "600000.00"
--   data_prevista_pelo_corretor       : true
--   locacao_foi_para_o_proximo_mes    : "1200.00"
--   data_prevista_por_outro_corretor  : "42501"
--   lider_ve_propostas_sem_editar     : "4/0"
--   dono_ve_propostas_editaveis       : "4/4"
--   comprometido_do_lider_b           : "500000.00"
--   cpl_campanha                      : "3|1|3000.00"
--   cpl_canal_sem_campanha            : "2|1000.00"
--   investimento_sem_lead             : "0|200.00"
--   investimento_total                : "4200.00"
--   investimento_proporcional         : true
--   investimento_some_com_filtro      : "3/3"
--   investimento_regravado            : 1
--   importacao_soma_repetidas         : "1|250.00"
--   corretor_lanca_investimento       : "42501"
--   exportacao_com_outra_equipe       : "42501"
--   exportacao_com_a_mesma_equipe     : "ok"
--   estranho_ve_equipes               : 0
--   estranho_no_relatorio             : "0/0/0/0"
--   anon_executa_relatorio            : false
--   anon_le_equipes                   : false

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  u_la uuid := gen_random_uuid();
  u_a1 uuid := gen_random_uuid();
  u_lb uuid := gen_random_uuid();
  u_b1 uuid := gen_random_uuid();
  u_free uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  org uuid;
  org_b uuid;
  team_a uuid;
  team_b uuid;
  c1 uuid;
  imovel_a uuid;
  imovel_b uuid;
  prop_rent_a uuid;
  lead_perdido uuid;
  v_inicio timestamptz := now() - interval '1 day';
  v_fim timestamptz := now() + interval '1 day';
  v_mes date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
  v_mes_passado date;
  v_passado_inicio timestamptz;
  v_passado_fim timestamptz;
  v_dias_mes_passado integer;
  v_export uuid;
  v_text text;
  v_int integer;
  v_bool boolean;
  v_num numeric;
begin
  v_mes_passado := (v_mes - interval '1 month')::date;
  v_passado_inicio := v_mes_passado::timestamp at time zone 'America/Sao_Paulo';
  v_passado_fim := v_mes::timestamp at time zone 'America/Sao_Paulo';
  v_dias_mes_passado := v_mes - v_mes_passado;

  -- ---------------------------------------------------------------------------
  -- Cenário
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.email, now(), now(), now()
  from (values
    (u_owner, 'teste-gestao-dono@exemplo.invalid'),
    (u_la, 'teste-gestao-lider-a@exemplo.invalid'),
    (u_a1, 'teste-gestao-a1@exemplo.invalid'),
    (u_lb, 'teste-gestao-lider-b@exemplo.invalid'),
    (u_b1, 'teste-gestao-b1@exemplo.invalid'),
    (u_free, 'teste-gestao-livre@exemplo.invalid'),
    (u_stranger, 'teste-gestao-estranho@exemplo.invalid')
  ) as u(id, email);

  update public.profiles set full_name = 'lb' where id = u_lb;
  update public.profiles set full_name = 'b1' where id = u_b1;
  update public.profiles set full_name = 'la' where id = u_la;
  update public.profiles set full_name = 'a1' where id = u_a1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Gestao', 'teste-gestao-comercial');

  update public.billing_accounts
  set limits = limits || '{"owned_listings": 100, "users": 20}'::jsonb
  where organization_id = org;

  insert into public.memberships (organization_id, user_id, role, active)
  values
    (org, u_la, 'broker', true),
    (org, u_a1, 'broker', true),
    (org, u_lb, 'broker', true),
    (org, u_b1, 'broker', true),
    (org, u_free, 'broker', true);

  insert into public.lead_routing_settings (organization_id, roulette_enabled, sla_minutes)
  values (org, false, 60);

  -- Leads de hoje: A tem 3 (la, a1, a1), B tem 2 (lb, b1), sem equipe 1.
  insert into public.leads (organization_id, name, phone, source, stage, assigned_to)
  values
    (org, 'Lead LA', '11988880001', 'website', 'new', u_la),
    (org, 'Lead A1 Um', '11988880002', 'website', 'new', u_a1),
    (org, 'Lead A1 Dois', '11988880003', 'website', 'new', u_a1),
    (org, 'Lead LB', '11988880004', 'website', 'new', u_lb),
    (org, 'Lead B1', '11988880005', 'website', 'new', u_b1),
    (org, 'Lead Livre', '11988880006', 'website', 'new', u_free);

  select l.id into lead_perdido from public.leads l where l.organization_id = org and l.name = 'Lead A1 Dois';
  update public.leads set stage = 'lost', lost_reason = 'Sem crédito' where id = lead_perdido;
  update public.leads set stage = 'lost', lost_reason = 'Mudou de cidade'
  where organization_id = org and name = 'Lead B1';

  -- Imóveis, cliente e propostas.
  insert into public.clients (organization_id, kind, name, assigned_to)
  values (org, 'pf', 'Cliente Gestao', u_a1) returning id into c1;

  insert into public.properties (organization_id, title, purpose, type, captured_by, broker_id)
  values (org, 'Imovel da A1', 'sale_rent', 'apartment', u_a1, u_a1) returning id into imovel_a;
  insert into public.properties (organization_id, title, purpose, type, captured_by, broker_id)
  values (org, 'Imovel da B1', 'sale_rent', 'apartment', u_b1, u_b1) returning id into imovel_b;

  insert into public.proposals
    (organization_id, property_id, client_id, broker_id, purpose, amount, status, expected_close_date)
  values
    (org, imovel_a, c1, u_a1, 'sale', 500000, 'sent', v_mes + 10),
    (org, imovel_a, c1, u_a1, 'sale', 500000, 'sent', v_mes + 12),
    (org, imovel_a, c1, u_a1, 'sale', 400000, 'sent', v_mes + 14);
  update public.proposals set status = 'countered'
  where organization_id = org and amount = 400000;

  insert into public.proposals
    (organization_id, property_id, client_id, broker_id, purpose, amount, status, expected_close_date)
  values (org, imovel_a, c1, u_a1, 'rent', 3000, 'sent', v_mes + 10)
  returning id into prop_rent_a;

  insert into public.proposals
    (organization_id, property_id, client_id, broker_id, purpose, amount, status)
  values
    (org, imovel_b, c1, u_b1, 'sale', 500000, 'sent'),
    (org, imovel_b, c1, u_b1, 'rent', 3000, 'sent');
  update public.proposals set status = 'accepted'
  where organization_id = org and broker_id = u_b1;

  insert into public.appointments (organization_id, broker_id, starts_at, status)
  values (org, u_b1, now(), 'done');

  -- Outra imobiliária.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  org_b := public.create_organization('Imobiliaria Teste Gestao B', 'teste-gestao-comercial-b');

  -- ---------------------------------------------------------------------------
  -- 1. Equipes
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_la, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.teams (organization_id, name) values (org, 'Equipe do corretor');
    v_text := 'sem erro';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_cria_equipe', v_text);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.teams (organization_id, name, leader_id)
  values (org, 'Equipe A', u_la) returning id into team_a;
  insert into public.teams (organization_id, name, leader_id)
  values (org, 'Equipe B', u_lb) returning id into team_b;
  insert into public.team_members (organization_id, user_id, team_id)
  values (org, u_a1, team_a), (org, u_b1, team_b);

  select exists (
    select 1 from public.team_members tm
    where tm.organization_id = org and tm.user_id = u_la and tm.team_id = team_a
  ) into v_bool;
  r := r || jsonb_build_object('lider_entrou_na_equipe', v_bool);

  -- ---------------------------------------------------------------------------
  -- 2. Recorte por equipe (sessão do dono)
  -- ---------------------------------------------------------------------------
  select coalesce(sum(p.leads_received), 0)::integer into v_int
  from public.report_broker_performance_by_team(org, v_inicio, v_fim) p;
  r := r || jsonb_build_object('dono_total_recebidos', v_int);

  select coalesce(sum(p.leads_received), 0)::integer into v_int
  from public.report_broker_performance_by_team(org, v_inicio, v_fim, null, team_a) p;
  r := r || jsonb_build_object('dono_equipe_a_recebidos', v_int);

  select coalesce(sum(p.leads_received), 0)::integer into v_int
  from public.report_broker_performance_by_team(org, v_inicio, v_fim, null, team_b) p;
  r := r || jsonb_build_object('dono_equipe_b_recebidos', v_int);

  -- Subtotal da equipe A (filtro A) + subtotal da B (filtro B) + linhas sem
  -- equipe = total da imobiliária, em cada coluna somável.
  with total as (
    select
      sum(p.leads_received) as recebidos,
      sum(p.leads_lost) as perdidos,
      sum(p.proposals_made) as propostas,
      sum(p.sales_closed_amount) as vendas,
      sum(p.rentals_closed_amount) as locacoes
    from public.report_broker_performance_by_team(org, v_inicio, v_fim) p
  ),
  partes as (
    select p.leads_received, p.leads_lost, p.proposals_made, p.sales_closed_amount, p.rentals_closed_amount
    from public.report_broker_performance_by_team(org, v_inicio, v_fim, null, team_a) p
    union all
    select p.leads_received, p.leads_lost, p.proposals_made, p.sales_closed_amount, p.rentals_closed_amount
    from public.report_broker_performance_by_team(org, v_inicio, v_fim, null, team_b) p
    union all
    select p.leads_received, p.leads_lost, p.proposals_made, p.sales_closed_amount, p.rentals_closed_amount
    from public.report_broker_performance_by_team(org, v_inicio, v_fim) p
    where p.team_id is null
  )
  select
    t.recebidos = sum(x.leads_received)
    and t.perdidos = sum(x.leads_lost)
    and t.propostas = sum(x.proposals_made)
    and t.vendas = sum(x.sales_closed_amount)
    and t.locacoes = sum(x.rentals_closed_amount)
  into v_bool
  from total t
  cross join partes x
  group by t.recebidos, t.perdidos, t.propostas, t.vendas, t.locacoes;
  r := r || jsonb_build_object('subtotais_somam_o_total', v_bool);

  select p.sales_closed || '/' || p.sales_closed_amount || '|' || p.rentals_closed || '/'
         || p.rentals_closed_amount || '|' || p.proposals_closed_amount
  into v_text
  from public.report_broker_performance_by_team(org, v_inicio, v_fim, u_b1) p;
  r := r || jsonb_build_object('venda_e_locacao_separadas', v_text);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 2b. Sessão do líder B
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_lb, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select string_agg(p.full_name, ',' order by p.full_name desc) into v_text
  from public.report_broker_performance_by_team(org, v_inicio, v_fim, null, team_a) p;
  r := r || jsonb_build_object('lider_b_pede_equipe_a', v_text);

  select string_agg(p.full_name, ',' order by p.full_name desc) into v_text
  from public.report_broker_performance_by_team(org, v_inicio, v_fim, u_a1, null) p;
  r := r || jsonb_build_object('lider_b_pede_corretor_da_a', v_text);

  select string_agg(p.full_name, ',') into v_text
  from public.report_broker_performance_by_team(org, v_inicio, v_fim, u_b1, team_a) p;
  r := r || jsonb_build_object('lider_b_pede_o_proprio_corretor', v_text);

  select count(*)::integer into v_int
  from public.report_broker_performance(org, v_inicio, v_fim) p;
  r := r || jsonb_build_object('lider_b_assinatura_antiga', v_int);

  -- Metas vistas pelo líder B: a equipe B e os dois membros, mesmo pedindo a A.
  select string_agg(x.kind || ':' || x.total, ' ' order by x.kind desc) into v_text
  from (
    select g.kind, count(*) as total
    from public.report_sales_goals(org, v_mes) g
    group by g.kind
  ) x;
  r := r || jsonb_build_object('lider_b_linhas_de_meta', v_text);

  select string_agg(x.kind || ':' || x.total, ' ' order by x.kind desc) into v_text
  from (
    select g.kind, count(*) as total
    from public.report_sales_goals(org, v_mes, null, team_a) g
    group by g.kind
  ) x;
  r := r || jsonb_build_object('lider_b_pede_metas_da_a', v_text);

  select b.amount::text into v_text
  from public.report_sales_forecast(org, null, null) b
  where b.bucket = 'committed' and b.purpose = 'sale';
  r := r || jsonb_build_object('comprometido_do_lider_b', v_text);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 2c. Corretor comum e líder A
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_a1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*)::integer into v_int
  from public.report_broker_performance_by_team(org, v_inicio, v_fim, null, team_a) p;
  r := r || jsonb_build_object('corretor_pede_equipe', v_int);

  begin
    perform public.save_sales_goal(org, v_mes, u_a1, null, 10);
    v_text := 'sem erro';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_grava_meta', v_text);

  begin
    perform public.set_proposal_stage_probabilities(org, 0::smallint, 100::smallint, 100::smallint);
    v_text := 'sem erro';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_muda_probabilidade', v_text);

  begin
    perform public.save_marketing_investment(org, v_mes, 'social', null, 10);
    v_text := 'sem erro';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_lanca_investimento', v_text);

  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_la, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select coalesce(sum(f.entered), 0)::integer into v_int
  from public.report_stage_funnel(org, v_inicio, v_fim, null, team_b) f;
  r := r || jsonb_build_object('lider_a_funil_pedindo_b', v_int);

  select string_agg(m.lost_reason || ':' || m.total, ' ') into v_text
  from public.report_lead_lost_reasons(org, v_inicio, v_fim, null, 20, team_b) m;
  r := r || jsonb_build_object('lider_a_motivos_pedindo_b', v_text);

  -- Previsão da equipe A com a probabilidade padrão.
  select b.proposals || '|' || b.amount || '|' || b.weighted_amount into v_text
  from public.report_sales_forecast(org) b
  where b.bucket = 'current_month' and b.purpose = 'sale';
  r := r || jsonb_build_object('previsao_venda_mes_padrao', v_text);

  select b.proposals || '|' || b.amount || '|' || b.weighted_amount into v_text
  from public.report_sales_forecast(org) b
  where b.bucket = 'current_month' and b.purpose = 'rent';
  r := r || jsonb_build_object('previsao_locacao_mes_padrao', v_text);

  select count(*) || '/' || count(*) filter (where f.can_edit) into v_text
  from public.report_forecast_proposals(org) f;
  r := r || jsonb_build_object('lider_ve_propostas_sem_editar', v_text);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 3. Metas (sessão do dono)
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform public.save_sales_goal(org, v_mes, u_b1, null, null, null, null, 4, 1000000);
  perform public.save_sales_goal(org, v_mes + 3, u_b1, null, null, null, null, 2, 1000000);
  perform public.save_sales_goal(org, v_mes, null, team_b, null, null, null, 5);

  select count(*)::integer into v_int
  from public.sales_goals g
  where g.organization_id = org and g.user_id = u_b1;
  r := r || jsonb_build_object('metas_sem_duplicar', v_int);

  select g.goal_sales_count || '|' || g.sales_count || '/' || g.sales_amount || '|'
         || g.rentals_count || '/' || g.rentals_amount || '|visitas:' || g.visits
  into v_text
  from public.report_sales_goals(org, v_mes) g
  where g.kind = 'broker' and g.target_id = u_b1;
  r := r || jsonb_build_object('meta_do_b1', v_text);

  select g.goal_sales_count || '|' || g.sales_count into v_text
  from public.report_sales_goals(org, v_mes) g
  where g.kind = 'team' and g.target_id = team_b;
  r := r || jsonb_build_object('meta_da_equipe_b', v_text);

  select public.copy_sales_goals(org, v_mes, (v_mes + interval '1 month')::date) into v_int;
  r := r || jsonb_build_object('metas_copiadas', v_int);

  -- Probabilidade do dono: enviada passa a 40%.
  perform public.set_proposal_stage_probabilities(org, 10::smallint, 40::smallint, 50::smallint);

  select sum(b.weighted_amount)::text into v_text
  from public.report_sales_forecast(org, null, team_a) b
  where b.bucket = 'current_month' and b.purpose = 'sale';
  r := r || jsonb_build_object('previsao_venda_mes_do_dono', v_text);

  select count(*) || '/' || count(*) filter (where f.can_edit) into v_text
  from public.report_forecast_proposals(org, null, team_a) f;
  r := r || jsonb_build_object('dono_ve_propostas_editaveis', v_text);

  -- Investimento em marketing (mês passado).
  perform public.save_marketing_investment(org, v_mes_passado, 'social', 'meta-setembro', 2500);
  perform public.save_marketing_investment(org, v_mes_passado + 5, 'social', ' META-SETEMBRO ', 3000);
  perform public.save_marketing_investment(org, v_mes_passado, 'portal', null, 1000);
  perform public.save_marketing_investment(org, v_mes_passado, 'website', 'sem-leads', 200);

  select count(*)::integer into v_int
  from public.marketing_investments mi
  where mi.organization_id = org and mi.source = 'social';
  r := r || jsonb_build_object('investimento_regravado', v_int);

  perform public.import_marketing_investments(
    org,
    jsonb_build_array(
      jsonb_build_object('month', v_mes, 'source', 'referral', 'utm_campaign', 'Indica', 'amount', 100),
      jsonb_build_object('month', v_mes + 2, 'source', 'referral', 'utm_campaign', 'indica ', 'amount', 150)
    )
  );
  select count(*) || '|' || sum(mi.amount) into v_text
  from public.marketing_investments mi
  where mi.organization_id = org and mi.source = 'referral';
  r := r || jsonb_build_object('importacao_soma_repetidas', v_text);

  reset role;

  -- Leads do mês passado para o custo por lead (criados como postgres).
  insert into public.leads (organization_id, name, phone, source, stage, assigned_to, utm)
  values
    (org, 'Meta Um', '11977770001', 'social', 'new', u_free, '{"campaign": "Meta-Setembro"}'::jsonb),
    (org, 'Meta Dois', '11977770002', 'social', 'new', u_free, '{"campaign": "Meta-Setembro"}'::jsonb),
    (org, 'Meta Tres', '11977770003', 'social', 'new', u_free, '{"campaign": "Meta-Setembro"}'::jsonb),
    (org, 'Portal Um', '11977770004', 'portal', 'new', u_free, '{}'::jsonb),
    (org, 'Portal Dois', '11977770005', 'portal', 'new', u_free, '{"campaign": "zap-destaque"}'::jsonb);
  update public.leads set stage = 'won' where organization_id = org and name = 'Meta Um';
  update public.leads set created_at = v_passado_inicio + interval '2 days'
  where organization_id = org and (name like 'Meta %' or name like 'Portal %');

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select s.leads || '|' || s.won || '|' || s.investment into v_text
  from public.report_lead_sources(org, v_passado_inicio, v_passado_fim) s
  where s.source = 'social';
  r := r || jsonb_build_object('cpl_campanha', v_text);

  select count(*) || '|' || sum(s.investment) into v_text
  from public.report_lead_sources(org, v_passado_inicio, v_passado_fim) s
  where s.source = 'portal';
  r := r || jsonb_build_object('cpl_canal_sem_campanha', v_text);

  select s.leads || '|' || s.investment into v_text
  from public.report_lead_sources(org, v_passado_inicio, v_passado_fim) s
  where s.source = 'website';
  r := r || jsonb_build_object('investimento_sem_lead', v_text);

  select sum(s.investment)::text into v_text
  from public.report_lead_sources(org, v_passado_inicio, v_passado_fim) s;
  r := r || jsonb_build_object('investimento_total', v_text);

  -- Primeiros 10 dias do mês passado: 10/dias do mês do investimento.
  select s.investment into v_num
  from public.report_lead_sources(org, v_passado_inicio, v_passado_inicio + interval '10 days') s
  where s.source = 'social';
  r := r || jsonb_build_object(
    'investimento_proporcional',
    v_num = round(3000::numeric * 10 / v_dias_mes_passado, 2)
  );

  -- Com recorte (aqui, o corretor dos leads) o investimento não é atribuído.
  select count(*) || '/' || count(*) filter (where s.investment is null) into v_text
  from public.report_lead_sources(org, v_passado_inicio, v_passado_fim, u_free, 100, null) s;
  r := r || jsonb_build_object('investimento_some_com_filtro', v_text);

  -- Exportação do relatório agregado com equipe.
  select s.export_id into v_export
  from public.start_report_export(org, 'corretores', v_inicio, v_fim, null, team_a, null) s;

  begin
    perform public.record_report_export(org, v_export, 'corretores', 3, v_inicio, v_fim, null, team_b);
    v_text := 'sem erro';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('exportacao_com_outra_equipe', v_text);

  begin
    perform public.record_report_export(org, v_export, 'corretores', 3, v_inicio, v_fim, null, team_a);
    v_text := 'ok';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('exportacao_com_a_mesma_equipe', v_text);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 4. RLS das metas e data prevista
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_lb, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*)::integer into v_int from public.sales_goals g where g.month = v_mes;
  r := r || jsonb_build_object('rls_metas_lider_b', v_int);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_la, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*)::integer into v_int from public.sales_goals g where g.month = v_mes;
  r := r || jsonb_build_object('rls_metas_lider_a', v_int);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_b1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*)::integer into v_int from public.sales_goals g where g.month = v_mes;
  r := r || jsonb_build_object('rls_metas_corretor_b1', v_int);

  begin
    perform public.set_proposal_expected_close_date(org, prop_rent_a, v_mes + 3);
    v_text := 'sem erro';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('data_prevista_por_outro_corretor', v_text);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_a1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.set_proposal_expected_close_date(
    org, prop_rent_a, (v_mes + interval '1 month')::date + 5
  ) = (v_mes + interval '1 month')::date + 5
  into v_bool;
  r := r || jsonb_build_object('data_prevista_pelo_corretor', v_bool);

  select b.weighted_amount::text into v_text
  from public.report_sales_forecast(org, null, null) b
  where b.bucket = 'next_month' and b.purpose = 'rent';
  r := r || jsonb_build_object('locacao_foi_para_o_proximo_mes', v_text);
  reset role;

  -- ---------------------------------------------------------------------------
  -- 5. Outra imobiliária e grants
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*)::integer into v_int from public.teams t where t.organization_id = org;
  r := r || jsonb_build_object('estranho_ve_equipes', v_int);

  select
    (select count(*) from public.report_broker_performance_by_team(org, v_inicio, v_fim)) || '/'
    || (select count(*) from public.report_sales_goals(org, v_mes)) || '/'
    || (select count(*) from public.report_sales_forecast(org)) || '/'
    || (select count(*) from public.report_forecast_proposals(org))
  into v_text;
  r := r || jsonb_build_object('estranho_no_relatorio', v_text);

  reset role;

  r := r || jsonb_build_object(
    'anon_executa_relatorio',
    has_function_privilege(
      'anon',
      'public.report_broker_performance_by_team(uuid, timestamptz, timestamptz, uuid, uuid)',
      'execute'
    )
      or has_function_privilege('anon', 'public.report_sales_goals(uuid, date, uuid, uuid)', 'execute')
      or has_function_privilege('anon', 'public.report_sales_forecast(uuid, uuid, uuid, date)', 'execute')
      or has_function_privilege('anon', 'public.save_marketing_investment(uuid, date, public.lead_source, text, numeric, text)', 'execute')
  );
  r := r || jsonb_build_object(
    'anon_le_equipes',
    has_table_privilege('anon', 'public.teams', 'select')
      or has_table_privilege('anon', 'public.sales_goals', 'select')
      or has_table_privilege('anon', 'public.marketing_investments', 'select')
  );

  raise exception 'TESTE DE GESTAO COMERCIAL (rollback): %', jsonb_pretty(r);
end;
$$;
