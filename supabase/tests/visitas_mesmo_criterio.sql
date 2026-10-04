-- =============================================================================
-- Teste: Metas (report_sales_goals) e relatório de visitas (report_broker_visits)
-- contam visitas realizadas pelo mesmo critério
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- Critério comum (conferido nas migrações reminders_digest_weekly_report e
-- gestao_comercial_equipes_metas):
--   - status da visita: só "done" (realizada);
--   - período: pelo início (starts_at), intervalo meio-aberto [início, fim);
--     na meta, o mês no fuso America/Sao_Paulo;
--   - responsável: appointments.broker_id (visita sem corretor não conta).
-- O que muda entre as duas é só QUEM vê quais linhas (report_sales_goals usa
-- private.report_member_scope, com líder de equipe; report_broker_visits dá a
-- equipe a dono e gerente e a própria linha aos demais). Para a mesma pessoa e
-- o mesmo mês, o número de visitas realizadas tem de ser igual.
--
-- Cenário (mês passado): o corretor B1 tem visita realizada exatamente no
-- início do mês, 1 segundo antes do fim, 1 segundo antes do início (fora), no
-- fim (fora), uma realizada em imóvel restrito que ele não vê (conta: ele é o
-- corretor da visita) e visitas agendada, confirmada, não compareceu e
-- cancelada (não contam). B2 tem 2 realizadas e 1 não compareceu. Uma visita
-- realizada sem corretor não conta para ninguém.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   dono_metas                 : "b1:3|b2:2"
--   dono_relatorio_visitas     : "b1:3|b2:2"
--   dono_mesmo_numero          : true
--   corretor_b1_metas          : 3
--   corretor_b1_relatorio      : 3
--   corretor_b1_mesmo_numero   : true

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  u_b1 uuid := gen_random_uuid();
  u_b2 uuid := gen_random_uuid();
  u_cap uuid := gen_random_uuid();
  org uuid;
  imv_restrito uuid;
  v_mes date;
  v_inicio timestamptz;
  v_fim timestamptz;
  v_metas text;
  v_visitas text;
  v_int_metas integer;
  v_int_visitas integer;
begin
  v_mes := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) - interval '1 month')::date;
  v_inicio := v_mes::timestamp at time zone 'America/Sao_Paulo';
  v_fim := (v_mes + interval '1 month')::timestamp at time zone 'America/Sao_Paulo';

  -- ---------------------------------------------------------------------------
  -- Cenário
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'teste-visitas-criterio-' || u.nome || '@exemplo.invalid', now(), now(), now()
  from (values (u_owner, 'dono'), (u_b1, 'b1'), (u_b2, 'b2'), (u_cap, 'captador')) as u (id, nome);

  update public.profiles set full_name = 'b1' where id = u_b1;
  update public.profiles set full_name = 'b2' where id = u_b2;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Visitas', 'teste-visitas-criterio');

  update public.billing_accounts
  set limits = limits || '{"owned_listings": 100, "users": 20}'::jsonb
  where organization_id = org;

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_b1, 'broker', true), (org, u_b2, 'broker', true), (org, u_cap, 'capturer', true);

  -- Imóvel restrito do captador: B1 não o vê.
  insert into public.properties (organization_id, title, purpose, type, captured_by, broker_id, is_restricted)
  values (org, 'Cobertura Restrita', 'sale', 'apartment', u_cap, u_cap, true)
  returning id into imv_restrito;

  insert into public.appointments (organization_id, property_id, broker_id, starts_at, status)
  values
    -- B1: 3 realizadas no mês.
    (org, null, u_b1, v_inicio, 'done'),
    (org, null, u_b1, v_fim - interval '1 second', 'done'),
    (org, imv_restrito, u_b1, v_inicio + interval '10 days', 'done'),
    -- B1: fora do mês ou sem status "realizada".
    (org, null, u_b1, v_inicio - interval '1 second', 'done'),
    (org, null, u_b1, v_fim, 'done'),
    (org, null, u_b1, v_inicio + interval '2 days', 'scheduled'),
    (org, null, u_b1, v_inicio + interval '3 days', 'confirmed'),
    (org, null, u_b1, v_inicio + interval '4 days', 'no_show'),
    (org, null, u_b1, v_inicio + interval '5 days', 'canceled'),
    -- B2: 2 realizadas e 1 não compareceu.
    (org, null, u_b2, v_inicio + interval '6 days', 'done'),
    (org, null, u_b2, v_inicio + interval '7 days', 'done'),
    (org, null, u_b2, v_inicio + interval '8 days', 'no_show'),
    -- Sem corretor: não conta para ninguém.
    (org, null, null, v_inicio + interval '9 days', 'done');

  -- ---------------------------------------------------------------------------
  -- 1. Dono: a equipe inteira nas duas funções
  -- ---------------------------------------------------------------------------
  set local role authenticated;

  execute $q$
    select string_agg(g.name || ':' || g.visits, '|' order by g.name)
    from public.report_sales_goals($1, $2) g
    where g.kind = 'broker' and g.visits > 0
  $q$ into v_metas using org, v_mes;

  execute $q$
    select string_agg(p.full_name || ':' || v.visits_done, '|' order by p.full_name)
    from public.report_broker_visits($1, $2, $3) v
    join public.profiles p on p.id = v.user_id
    where v.visits_done > 0
  $q$ into v_visitas using org, v_inicio, v_fim;

  r := r || jsonb_build_object(
    'dono_metas', v_metas,
    'dono_relatorio_visitas', v_visitas,
    'dono_mesmo_numero', v_metas = v_visitas
  );

  reset role;

  -- ---------------------------------------------------------------------------
  -- 2. Corretor B1: só a própria linha, mesmo número
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_b1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute $q$
    select coalesce(sum(g.visits), 0)::integer
    from public.report_sales_goals($1, $2) g
    where g.kind = 'broker' and g.target_id = $3
  $q$ into v_int_metas using org, v_mes, u_b1;

  execute $q$
    select coalesce(sum(v.visits_done), 0)::integer
    from public.report_broker_visits($1, $2, $3) v
    where v.user_id = $4
  $q$ into v_int_visitas using org, v_inicio, v_fim, u_b1;

  r := r || jsonb_build_object(
    'corretor_b1_metas', v_int_metas,
    'corretor_b1_relatorio', v_int_visitas,
    'corretor_b1_mesmo_numero', v_int_metas = v_int_visitas
  );

  reset role;

  raise exception 'TESTE visitas com o mesmo criterio (rollback): %', jsonb_pretty(r);
end;
$$;
