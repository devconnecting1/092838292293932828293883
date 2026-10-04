-- =============================================================================
-- Teste dos relatórios: recorte por papel, funil por etapa e exportação
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- O que está sendo provado:
--
--   1. Dono e gerente veem a equipe inteira; corretor vê SÓ a própria linha —
--      inclusive nos números que vêm de `properties` e `proposals`, tabelas que
--      o RLS libera para qualquer membro da imobiliária.
--   2. Mandar o id de um colega em `p_user_id` não muda nada para o corretor:
--      `private.report_broker_filter` o força de volta para si mesmo.
--   3. O funil por etapa sai do histórico (`lead_stage_events`) com conversão
--      entre etapas e tempo em cada fase, em números verificáveis.
--   4. A exportação só devolve as linhas do RLS, pagina por (created_at, id) sem
--      repetir registro, e o CPF do cliente só sai para dono e gerente. Cada
--      página exige o `p_export_id` de `start_data_export` com os mesmos
--      filtros; o corretor só exporta depois que o dono o libera
--      (`set_export_roles`) — antes disso a página responde 42501.
--   5. Membro de outra imobiliária não tira nenhum número desta: nem abre a
--      exportação, nem usa o id de exportação de outra pessoa.
--   6. `anon` não executa nenhuma das RPCs.
--   7. Atendimento e SLA medem o 1º contato (`leads.first_contact_at`): um
--      "Registrar contato" dias depois não muda a mediana nem o "no prazo", e a
--      coluna first_contact_at da exportação continua sendo o 1º contato.
--
-- Cenário (fuso irrelevante: tudo é relativo a now()):
--   b1  L1 entregue -5d, contato +10min (no prazo), ganho -2d, recontato -1d
--       L2 entregue -4d, contato +5h   (fora do prazo), perdido -1d
--       L3 entregue -3d, sem contato, continua em "Novo"
--       2 imóveis captados, 2 propostas (1 aceita de R$ 500.000 em -1d)
--   b2  L4 entregue -6d, contato +30min (no prazo), qualificado
--       L5 entregue -2d, sem contato
--       1 imóvel captado, 1 proposta enviada
--   b3  F1 novo -10d → em contato -9d → qualificado -5d → ganho -1d
--       F2 novo -10d → em contato -8d → perdido -2d
--       F3 novo -6d e para por aí
--
-- Resultado esperado (a ordem das chaves pode variar):
--   dono_ve_a_equipe                 : 4
--   b1_pelo_dono                     : "3/2/1/1/1/1|155.0|2|2/1|500000.00"
--   b2_pelo_dono                     : "2/1/1/0/0/2|30.0|1|1/0|0"
--   corretor_ve_so_a_propria_linha   : 1
--   corretor_nao_ve_o_colega         : true
--   corretor_ve_o_proprio_numero     : "3/2/1/1/1/1|155.0|2|2/1|500000.00"
--   funil_do_b3                      : "new:3/2/1/1/36.00 contacted:2/1/1/0/120.00 qualified:1/1/0/0/96.00 visit_scheduled:0/0/0/0/- proposal:0/0/0/0/- won:1/0/0/1/- lost:1/0/0/1/-"
--   funil_ignora_id_do_colega        : 5
--   funil_do_b1_sem_parametro        : 5
--   origens_do_b1                    : 3
--   origens_do_b2_pelo_dono          : 2
--   motivos_de_perda                 : "Fora do orçamento:1"
--   primeiro_contato_na_exportacao   : true
--   corretor_sem_liberacao           : "42501"
--   b1_exporta_so_os_proprios_leads  : 3
--   b1_nao_exporta_lead_do_colega    : true
--   cpf_para_o_dono                  : "12345678909"
--   cpf_para_o_corretor              : null
--   b1_exporta_so_o_proprio_cliente  : 1
--   paginacao_sem_repetir            : 3
--   estranho_no_relatorio            : 0
--   estranho_inicia_exportacao       : "P0002"
--   estranho_na_exportacao           : "42501"
--   grant_relatorio_anon             : false
--   grant_relatorio_authenticated    : true
--   grant_exportacao_anon            : false
--   grant_exportacao_authenticated   : true

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  u_b1 uuid := gen_random_uuid();
  u_b2 uuid := gen_random_uuid();
  u_b3 uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  org uuid;
  org_b uuid;
  l1 uuid;
  l2 uuid;
  l3 uuid;
  l4 uuid;
  l5 uuid;
  f1 uuid;
  f2 uuid;
  f3 uuid;
  c1 uuid;
  c2 uuid;
  imovel1 uuid;
  imovel2 uuid;
  imovel3 uuid;
  proposta1 uuid;
  v_inicio timestamptz := now() - interval '30 days';
  v_fim timestamptz := now() + interval '1 day';
  v_text text;
  v_int integer;
  v_bool boolean;
  v_pagina1 timestamptz;
  v_pagina1_id uuid;
  v_export uuid;
  v_export_b1 uuid;
begin
  -- ---------------------------------------------------------------------------
  -- Cenário
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-relatorios-dono@exemplo.invalid', now(), now(), now()),
    (u_b1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-relatorios-b1@exemplo.invalid', now(), now(), now()),
    (u_b2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-relatorios-b2@exemplo.invalid', now(), now(), now()),
    (u_b3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-relatorios-b3@exemplo.invalid', now(), now(), now()),
    (u_stranger, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-relatorios-estranho@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Relatorios', 'teste-relatorios');

  -- Limites folgados: o teste não é sobre o plano.
  update public.billing_accounts
  set limits = limits || '{"owned_listings": 100, "users": 20}'::jsonb
  where organization_id = org;

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_b1, 'broker', true), (org, u_b2, 'broker', true), (org, u_b3, 'broker', true);

  -- Prazo de 1 hora e rodízio desligado: quem escolhe o responsável é o teste.
  insert into public.lead_routing_settings (organization_id, roulette_enabled, sla_minutes)
  values (org, false, 60);

  -- Leads do b1 ------------------------------------------------------------
  insert into public.leads (organization_id, name, phone, source, stage, assigned_to, utm)
  values (org, 'Lead B1 Um', '11999990001', 'portal', 'new', u_b1,
          '{"source": "zap", "medium": "cpc", "campaign": "lancamento"}'::jsonb)
  returning id into l1;
  insert into public.leads (organization_id, name, phone, source, stage, assigned_to)
  values (org, 'Lead B1 Dois', '11999990002', 'portal', 'new', u_b1) returning id into l2;
  insert into public.leads (organization_id, name, phone, source, stage, assigned_to)
  values (org, 'Lead B1 Tres', '11999990003', 'website', 'new', u_b1) returning id into l3;

  -- assigned_at só é recalculado quando o responsável muda, então dá para
  -- empurrar a entrega para o passado sem o trigger desfazer.
  update public.leads
  set assigned_at = now() - interval '5 days',
      last_contact_at = now() - interval '5 days' + interval '10 minutes'
  where id = l1;
  update public.leads
  set assigned_at = now() - interval '4 days',
      last_contact_at = now() - interval '4 days' + interval '5 hours'
  where id = l2;
  update public.leads set assigned_at = now() - interval '3 days' where id = l3;

  update public.leads set stage = 'won' where id = l1;
  update public.leads set stage = 'lost', lost_reason = 'Fora do orçamento' where id = l2;

  update public.lead_stage_events set created_at = now() - interval '2 days'
  where lead_id = l1 and to_stage = 'won';
  update public.lead_stage_events set created_at = now() - interval '1 day'
  where lead_id = l2 and to_stage = 'lost';

  -- "Registrar contato" 4 dias depois do 1º: last_contact_at muda, o 1º contato
  -- (first_contact_at, gravado uma vez pelo trigger) não.
  update public.leads set last_contact_at = now() - interval '1 day' where id = l1;

  -- Leads do b2 ------------------------------------------------------------
  insert into public.leads (organization_id, name, phone, source, stage, assigned_to, utm)
  values (org, 'Lead B2 Um', '11999990004', 'portal', 'new', u_b2,
          '{"source": "vivareal", "campaign": "lancamento"}'::jsonb)
  returning id into l4;
  insert into public.leads (organization_id, name, phone, source, stage, assigned_to)
  values (org, 'Lead B2 Dois', '11999990005', 'social', 'new', u_b2) returning id into l5;

  update public.leads
  set assigned_at = now() - interval '6 days',
      last_contact_at = now() - interval '6 days' + interval '30 minutes'
  where id = l4;
  update public.leads set assigned_at = now() - interval '2 days' where id = l5;
  update public.leads set stage = 'qualified' where id = l4;

  -- Leads do b3: a linha do tempo do funil ---------------------------------
  insert into public.leads (organization_id, name, phone, source, stage, assigned_to)
  values (org, 'Lead Funil Um', '11999990006', 'website', 'new', u_b3) returning id into f1;
  insert into public.leads (organization_id, name, phone, source, stage, assigned_to)
  values (org, 'Lead Funil Dois', '11999990007', 'website', 'new', u_b3) returning id into f2;
  insert into public.leads (organization_id, name, phone, source, stage, assigned_to)
  values (org, 'Lead Funil Tres', '11999990008', 'website', 'new', u_b3) returning id into f3;

  update public.leads set stage = 'contacted' where id in (f1, f2);
  update public.leads set stage = 'qualified' where id = f1;
  update public.leads set stage = 'won' where id = f1;
  update public.leads set stage = 'lost', lost_reason = 'Comprou com outra imobiliária'
  where id = f2;

  update public.lead_stage_events set created_at = now() - interval '10 days'
  where lead_id in (f1, f2) and to_stage = 'new';
  update public.lead_stage_events set created_at = now() - interval '6 days'
  where lead_id = f3 and to_stage = 'new';
  update public.lead_stage_events set created_at = now() - interval '9 days'
  where lead_id = f1 and to_stage = 'contacted';
  update public.lead_stage_events set created_at = now() - interval '8 days'
  where lead_id = f2 and to_stage = 'contacted';
  update public.lead_stage_events set created_at = now() - interval '5 days'
  where lead_id = f1 and to_stage = 'qualified';
  update public.lead_stage_events set created_at = now() - interval '1 day'
  where lead_id = f1 and to_stage = 'won';
  update public.lead_stage_events set created_at = now() - interval '2 days'
  where lead_id = f2 and to_stage = 'lost';

  -- Clientes, imóveis e propostas ------------------------------------------
  insert into public.clients (organization_id, kind, name, document, assigned_to)
  values (org, 'pf', 'Cliente do B1', '12345678909', u_b1) returning id into c1;
  insert into public.clients (organization_id, kind, name, document, assigned_to)
  values (org, 'pf', 'Cliente do B2', '98765432100', u_b2) returning id into c2;
  update public.clients set created_at = now() - interval '7 days' where id in (c1, c2);

  insert into public.properties (organization_id, title, purpose, type, captured_by, broker_id)
  values (org, 'Captacao B1 Um', 'sale', 'apartment', u_b1, u_b1) returning id into imovel1;
  insert into public.properties (organization_id, title, purpose, type, captured_by, broker_id)
  values (org, 'Captacao B1 Dois', 'sale', 'house', u_b1, u_b1) returning id into imovel2;
  insert into public.properties (organization_id, title, purpose, type, captured_by, broker_id)
  values (org, 'Captacao B2 Um', 'rent', 'apartment', u_b2, u_b2) returning id into imovel3;
  update public.properties set created_at = now() - interval '3 days'
  where id in (imovel1, imovel2, imovel3);

  -- `proposals_enforce_status_flow` só deixa a proposta nascer em rascunho ou
  -- enviada: o fechamento é uma transição, como acontece na tela.
  insert into public.proposals
    (organization_id, property_id, client_id, broker_id, purpose, amount, status)
  values (org, imovel1, c1, u_b1, 'sale', 500000, 'sent') returning id into proposta1;
  insert into public.proposals
    (organization_id, property_id, client_id, broker_id, purpose, amount, status)
  values
    (org, imovel2, c1, u_b1, 'sale', 300000, 'sent'),
    (org, imovel3, c2, u_b2, 'rent', 2500, 'sent');
  update public.proposals set created_at = now() - interval '3 days'
  where organization_id = org;
  update public.proposals
  set status = 'accepted', decided_at = now() - interval '1 day'
  where id = proposta1;

  -- Outra imobiliária, para o teste de isolamento --------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  org_b := public.create_organization('Imobiliaria Teste Relatorios B', 'teste-relatorios-b');

  -- ---------------------------------------------------------------------------
  -- 1. Sessão do dono: a equipe inteira
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select count(*)::integer from public.report_broker_performance($1, $2, $3)'
  into v_int using org, v_inicio, v_fim;
  r := r || jsonb_build_object('dono_ve_a_equipe', v_int);

  execute $q$
    select
      p.leads_received || '/' || p.leads_answered || '/' || p.leads_in_sla || '/'
      || p.leads_won || '/' || p.leads_lost || '/' || p.leads_open
      || '|' || coalesce(p.first_response_median_minutes::text, '-')
      || '|' || p.properties_captured
      || '|' || p.proposals_made || '/' || p.proposals_closed
      || '|' || p.proposals_closed_amount
    from public.report_broker_performance($1, $2, $3) p
    where p.user_id = $4
  $q$ into v_text using org, v_inicio, v_fim, u_b1;
  r := r || jsonb_build_object('b1_pelo_dono', v_text);

  execute $q$
    select
      p.leads_received || '/' || p.leads_answered || '/' || p.leads_in_sla || '/'
      || p.leads_won || '/' || p.leads_lost || '/' || p.leads_open
      || '|' || coalesce(p.first_response_median_minutes::text, '-')
      || '|' || p.properties_captured
      || '|' || p.proposals_made || '/' || p.proposals_closed
      || '|' || p.proposals_closed_amount
    from public.report_broker_performance($1, $2, $3) p
    where p.user_id = $4
  $q$ into v_text using org, v_inicio, v_fim, u_b2;
  r := r || jsonb_build_object('b2_pelo_dono', v_text);

  -- Funil do b3 visto pela gestão: entradas/avanços/perdas/parados/mediana.
  execute $q$
    select string_agg(
      f.stage || ':' || f.entered || '/' || f.advanced || '/' || f.lost_after || '/'
        || f.still_there || '/' || coalesce(f.median_hours::text, '-'),
      ' '
    )
    from public.report_stage_funnel($1, $2, $3, $4) f
  $q$ into v_text using org, v_inicio, v_fim, u_b3;
  r := r || jsonb_build_object('funil_do_b3', v_text);

  execute $q$
    select string_agg(m.lost_reason || ':' || m.total, ' ')
    from public.report_lead_lost_reasons($1, $2, $3, $4, 20) m
  $q$ into v_text using org, v_inicio, v_fim, u_b1;
  r := r || jsonb_build_object('motivos_de_perda', v_text);

  execute $q$
    select coalesce(sum(s.leads), 0)::integer
    from public.report_lead_sources($1, $2, $3, $4, 100) s
  $q$ into v_int using org, v_inicio, v_fim, u_b2;
  r := r || jsonb_build_object('origens_do_b2_pelo_dono', v_int);

  -- Exportação: cada página exige o registro aberto com os mesmos filtros.
  execute 'select s.export_id from public.start_data_export($1, $2, $3, $4, null, null) s'
  into v_export using org, 'clientes', v_inicio, v_fim;

  execute $q$
    select c.document
    from public.export_clients_rows($1, $2, $3, $4, null, null, null, 100) c
    where c.id = $5
  $q$ into v_text using org, v_export, v_inicio, v_fim, c1;
  r := r || jsonb_build_object('cpf_para_o_dono', v_text);

  execute 'select s.export_id from public.start_data_export($1, $2, $3, $4, null, null) s'
  into v_export using org, 'leads', v_inicio, v_fim;

  execute $q$
    select e.first_contact_at = e.assigned_at + interval '10 minutes'
    from public.export_leads_rows($1, $2, $3, $4, null, null, null, 500) e
    where e.id = $5
  $q$ into v_bool using org, v_export, v_inicio, v_fim, l1;
  r := r || jsonb_build_object('primeiro_contato_na_exportacao', v_bool);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 2. Sessão do corretor b1: só o próprio desempenho
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_b1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Sem a liberação do dono, o corretor não exporta: a página responde 42501.
  execute 'select s.export_id from public.start_data_export($1, $2, $3, $4, null, null) s'
  into v_export using org, 'leads', v_inicio, v_fim;
  begin
    execute 'select count(*)::integer from public.export_leads_rows($1, $2, $3, $4, null, null, null, 500)'
    into v_int using org, v_export, v_inicio, v_fim;
    v_text := 'sem erro';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_sem_liberacao', v_text);

  reset role;

  -- O dono libera a exportação para corretores.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute 'select public.set_export_roles($1, $2)' using org, '{broker}'::public.app_role[];
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_b1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select count(*)::integer from public.report_broker_performance($1, $2, $3)'
  into v_int using org, v_inicio, v_fim;
  r := r || jsonb_build_object('corretor_ve_so_a_propria_linha', v_int);

  execute $q$
    select not exists (
      select 1 from public.report_broker_performance($1, $2, $3) p where p.user_id = $4
    )
  $q$ into v_bool using org, v_inicio, v_fim, u_b2;
  r := r || jsonb_build_object('corretor_nao_ve_o_colega', v_bool);

  -- O mesmo recorte que o dono viu: o corretor enxerga o SEU número inteiro,
  -- inclusive imóveis e propostas (tabelas que o RLS libera para todo membro).
  execute $q$
    select
      p.leads_received || '/' || p.leads_answered || '/' || p.leads_in_sla || '/'
      || p.leads_won || '/' || p.leads_lost || '/' || p.leads_open
      || '|' || coalesce(p.first_response_median_minutes::text, '-')
      || '|' || p.properties_captured
      || '|' || p.proposals_made || '/' || p.proposals_closed
      || '|' || p.proposals_closed_amount
    from public.report_broker_performance($1, $2, $3) p
  $q$ into v_text using org, v_inicio, v_fim;
  r := r || jsonb_build_object('corretor_ve_o_proprio_numero', v_text);

  -- Mandar o id do colega em p_user_id não muda nada: continua sendo o funil do b1.
  execute $q$
    select coalesce(sum(f.entered), 0)::integer
    from public.report_stage_funnel($1, $2, $3, $4) f
  $q$ into v_int using org, v_inicio, v_fim, u_b3;
  r := r || jsonb_build_object('funil_ignora_id_do_colega', v_int);

  execute $q$
    select coalesce(sum(f.entered), 0)::integer
    from public.report_stage_funnel($1, $2, $3, null) f
  $q$ into v_int using org, v_inicio, v_fim;
  r := r || jsonb_build_object('funil_do_b1_sem_parametro', v_int);

  execute $q$
    select coalesce(sum(s.leads), 0)::integer
    from public.report_lead_sources($1, $2, $3, $4, 100) s
  $q$ into v_int using org, v_inicio, v_fim, u_b2;
  r := r || jsonb_build_object('origens_do_b1', v_int);

  execute 'select s.export_id from public.start_data_export($1, $2, $3, $4, null, null) s'
  into v_export_b1 using org, 'leads', v_inicio, v_fim;

  execute 'select count(*)::integer from public.export_leads_rows($1, $2, $3, $4, null, null, null, 500)'
  into v_int using org, v_export_b1, v_inicio, v_fim;
  r := r || jsonb_build_object('b1_exporta_so_os_proprios_leads', v_int);

  -- O registro guarda o id do colega pedido; a página continua só com os do b1.
  execute 'select s.export_id from public.start_data_export($1, $2, $3, $4, $5, null) s'
  into v_export using org, 'leads', v_inicio, v_fim, u_b2;

  execute $q$
    select not exists (
      select 1 from public.export_leads_rows($1, $2, $3, $4, $5, null, null, 500) e
      where e.name like 'Lead B2%'
    )
  $q$ into v_bool using org, v_export, v_inicio, v_fim, u_b2;
  r := r || jsonb_build_object('b1_nao_exporta_lead_do_colega', v_bool);

  execute 'select s.export_id from public.start_data_export($1, $2, $3, $4, null, null) s'
  into v_export using org, 'clientes', v_inicio, v_fim;

  execute $q$
    select c.document
    from public.export_clients_rows($1, $2, $3, $4, null, null, null, 100) c
    where c.id = $5
  $q$ into v_text using org, v_export, v_inicio, v_fim, c1;
  r := r || jsonb_build_object('cpf_para_o_corretor', v_text);

  execute 'select count(*)::integer from public.export_clients_rows($1, $2, $3, $4, null, null, null, 100)'
  into v_int using org, v_export, v_inicio, v_fim;
  r := r || jsonb_build_object('b1_exporta_so_o_proprio_cliente', v_int);

  -- Paginação por (created_at, id): duas páginas de 2 sem repetir registro,
  -- as duas no mesmo registro de exportação.
  execute $q$
    select e.created_at, e.id
    from public.export_leads_rows($1, $2, $3, $4, null, null, null, 2) e
    order by e.created_at desc, e.id desc
    limit 1
  $q$ into v_pagina1, v_pagina1_id using org, v_export_b1, v_inicio, v_fim;

  execute $q$
    select count(distinct e.id)::integer from (
      select id from public.export_leads_rows($1, $2, $3, $4, null, null, null, 2)
      union all
      select id from public.export_leads_rows($1, $2, $3, $4, null, $5, $6, 2)
    ) e
  $q$ into v_int using org, v_export_b1, v_inicio, v_fim, v_pagina1, v_pagina1_id;
  r := r || jsonb_build_object('paginacao_sem_repetir', v_int);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 3. Membro de outra imobiliária: nada
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select count(*)::integer from public.report_broker_performance($1, $2, $3)'
  into v_int using org, v_inicio, v_fim;
  r := r || jsonb_build_object('estranho_no_relatorio', v_int);

  begin
    execute 'select s.export_id from public.start_data_export($1, $2, $3, $4, null, null) s'
    into v_export using org, 'leads', v_inicio, v_fim;
    v_text := 'sem erro';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('estranho_inicia_exportacao', v_text);

  -- Nem com o id de exportação do b1 (outro usuário) a página sai.
  begin
    execute 'select count(*)::integer from public.export_leads_rows($1, $2, $3, $4, null, null, null, 500)'
    into v_int using org, v_export_b1, v_inicio, v_fim;
    v_text := 'sem erro';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('estranho_na_exportacao', v_text);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 4. Grants
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'grant_relatorio_anon',
    has_function_privilege(
      'anon',
      'public.report_broker_performance(uuid, timestamptz, timestamptz)',
      'execute'
    )
  );
  r := r || jsonb_build_object(
    'grant_relatorio_authenticated',
    has_function_privilege(
      'authenticated',
      'public.report_broker_performance(uuid, timestamptz, timestamptz)',
      'execute'
    )
  );
  r := r || jsonb_build_object(
    'grant_exportacao_anon',
    has_function_privilege(
      'anon',
      'public.export_clients_rows(uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer)',
      'execute'
    )
  );
  r := r || jsonb_build_object(
    'grant_exportacao_authenticated',
    has_function_privilege(
      'authenticated',
      'public.export_clients_rows(uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer)',
      'execute'
    )
  );

  raise exception 'TESTE DE RELATORIOS (rollback): %', jsonb_pretty(r);
end;
$$;
