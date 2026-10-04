-- =============================================================================
-- Teste do Console da Plataforma (chave do servidor, registro e saúde)
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- O que está sendo provado:
--   1. sem PLATFORM_SERVER_KEY (ou com a chave errada) as três RPCs recusam
--      com 42501;
--   2. com a chave, platform_health devolve as quatro partes (rotinas, Vault,
--      filas e assinaturas), só existência dos segredos e nenhum dado pessoal:
--      uma execução com falha cuja mensagem tem e-mail e telefone volta sem eles;
--   3. nome de segredo fora do formato é recusado (22023);
--   4. platform_log_action grava quem (id + e-mail confirmado), ação, alvo,
--      motivo e antes/depois, e platform_list_audit_events devolve a linha;
--   5. e-mail que não é da conta, conta sem e-mail confirmado (42501) e dado
--      pessoal no antes/depois (22023) são recusados;
--   6. o registro é só de acréscimo: UPDATE, DELETE e TRUNCATE são recusados;
--   7. as RPCs são só para anon (nunca authenticated) e a tabela não é legível
--      por anon nem por authenticated.
--
-- Resultado esperado (ordem das chaves pode variar):
--   saude_sem_chave               : "NEGADO:42501"
--   saude_chave_errada            : "NEGADO:42501"
--   registro_sem_chave            : "NEGADO:42501"
--   lista_sem_chave               : "NEGADO:42501"
--   saude_partes                  : ["billing", "cron_jobs", "generated_at", "queues", "vault_secrets"]
--   saude_rotinas_iguais_ao_cron  : true
--   saude_filas                   : 7
--   saude_segredo_existe          : true
--   saude_segredo_inexistente     : false
--   saude_falha_status            : "failed"
--   saude_falha_sem_email         : true
--   saude_falha_sem_telefone      : true
--   saude_sem_email_na_resposta   : true
--   saude_nome_invalido           : "NEGADO:22023"
--   registro_gravado              : true
--   registro_listado_acao         : "organizacao.bloquear"
--   registro_listado_email        : "equipe-console@exemplo.invalid"
--   registro_listado_motivo       : "Teste do console"
--   registro_listado_depois       : {"bloqueada": true}
--   registro_filtro_imobiliaria   : 1
--   registro_email_trocado        : "NEGADO:42501"
--   registro_sem_confirmacao      : "NEGADO:42501"
--   registro_com_email_no_antes   : "NEGADO:22023"
--   registro_com_cpf_no_depois    : "NEGADO:22023"
--   registro_update               : "NEGADO:42501"
--   registro_delete               : "NEGADO:42501"
--   registro_truncate             : "NEGADO:42501"
--   saude_para_anon               : true
--   saude_para_authenticated      : false
--   registro_para_anon            : true
--   registro_para_authenticated   : false
--   lista_para_anon               : true
--   lista_para_authenticated      : false
--   tabela_para_anon              : false
--   tabela_para_authenticated     : false

do $$
declare
  r jsonb := '{}'::jsonb;
  key text;
  u_admin uuid := gen_random_uuid();
  u_unconfirmed uuid := gen_random_uuid();
  org uuid := gen_random_uuid();
  v_job bigint;
  v_health jsonb;
  v_failed jsonb;
  v_id bigint;
  v_row record;
begin
  select ds.decrypted_secret into key
  from vault.decrypted_secrets ds
  where ds.name = 'platform_server_key';

  -- ---------------------------------------------------------------------------
  -- 1. Sem chave e com chave errada
  -- ---------------------------------------------------------------------------
  begin
    perform public.platform_health(null, '{}'::text[]);
    r := r || jsonb_build_object('saude_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('saude_sem_chave', 'NEGADO:42501');
  end;

  begin
    perform public.platform_health('chave-errada', '{}'::text[]);
    r := r || jsonb_build_object('saude_chave_errada', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('saude_chave_errada', 'NEGADO:42501');
  end;

  begin
    perform public.platform_log_action(
      null, u_admin, 'equipe-console@exemplo.invalid', 'organizacao.bloquear');
    r := r || jsonb_build_object('registro_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('registro_sem_chave', 'NEGADO:42501');
  end;

  begin
    perform public.platform_list_audit_events(null);
    r := r || jsonb_build_object('lista_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('lista_sem_chave', 'NEGADO:42501');
  end;

  -- ---------------------------------------------------------------------------
  -- 2. Saúde com a chave (execução com falha sintética, com e-mail e telefone)
  -- ---------------------------------------------------------------------------
  select j.jobid into v_job
  from cron.job j
  order by j.jobid
  limit 1;

  -- runid explícito e bem acima dos reais: o dono das funções não usa a
  -- sequência do pg_cron, e a linha some no rollback.
  insert into cron.job_run_details (
    jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time
  )
  values (
    v_job, (select coalesce(max(d.runid), 0) + 1000000 from cron.job_run_details d),
    0, current_database(), current_user, 'select 1', 'failed',
    'ERROR: duplicate key (email)=(cliente@exemplo.com) falhou para cliente@exemplo.com tel 11 98765-4321'
      || E'\nDETAIL: segunda linha com mais dados',
    now() + interval '1 minute', now() + interval '1 minute'
  );

  v_health := public.platform_health(
    key, array['platform_server_key', 'segredo_que_nao_existe']);

  select value into v_failed
  from jsonb_array_elements(v_health -> 'cron_jobs')
  where value ->> 'name' = (select j.jobname from cron.job j where j.jobid = v_job);

  r := r || jsonb_build_object(
    'saude_partes', (select jsonb_agg(k order by k) from jsonb_object_keys(v_health) as k),
    'saude_rotinas_iguais_ao_cron',
    jsonb_array_length(v_health -> 'cron_jobs') = (select count(*) from cron.job),
    'saude_filas', (select count(*) from jsonb_object_keys(v_health -> 'queues')),
    'saude_segredo_existe', (v_health -> 'vault_secrets' ->> 'platform_server_key')::boolean,
    'saude_segredo_inexistente', (v_health -> 'vault_secrets' ->> 'segredo_que_nao_existe')::boolean,
    'saude_falha_status', v_failed ->> 'last_status',
    'saude_falha_sem_email', coalesce(v_failed ->> 'last_message', '') !~ '@',
    'saude_falha_sem_telefone', coalesce(v_failed ->> 'last_message', '') !~ '98765',
    'saude_sem_email_na_resposta', v_health::text !~ '[^[:space:]@"]+@[^[:space:]@"]+'
  );

  begin
    perform public.platform_health(key, array['Nome Invalido']);
    r := r || jsonb_build_object('saude_nome_invalido', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('saude_nome_invalido', 'NEGADO:22023');
  end;

  -- ---------------------------------------------------------------------------
  -- 4. Registro
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'equipe-console@exemplo.invalid', now(), now(), now()),
    (u_unconfirmed, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'equipe-sem-confirmar@exemplo.invalid', null, now(), now());

  v_id := public.platform_log_action(
    key, u_admin, 'Equipe-Console@exemplo.invalid', 'organizacao.bloquear', 'organizacao',
    org::text, org, 'Teste do console', '{"bloqueada": false}'::jsonb, '{"bloqueada": true}'::jsonb);

  select * into v_row
  from public.platform_list_audit_events(key, 10, null, null, null) e
  where e.id = v_id;

  r := r || jsonb_build_object(
    'registro_gravado', v_id is not null,
    'registro_listado_acao', v_row.action,
    'registro_listado_email', v_row.actor_email,
    'registro_listado_motivo', v_row.reason,
    'registro_listado_depois', v_row.after_data,
    'registro_filtro_imobiliaria',
    (select count(*) from public.platform_list_audit_events(key, 10, null, org, null))
  );

  -- ---------------------------------------------------------------------------
  -- 5. Recusas na gravação
  -- ---------------------------------------------------------------------------
  begin
    perform public.platform_log_action(
      key, u_admin, 'outra-pessoa@exemplo.invalid', 'organizacao.bloquear');
    r := r || jsonb_build_object('registro_email_trocado', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('registro_email_trocado', 'NEGADO:42501');
  end;

  begin
    perform public.platform_log_action(
      key, u_unconfirmed, 'equipe-sem-confirmar@exemplo.invalid', 'organizacao.bloquear');
    r := r || jsonb_build_object('registro_sem_confirmacao', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('registro_sem_confirmacao', 'NEGADO:42501');
  end;

  begin
    perform public.platform_log_action(
      key, u_admin, 'equipe-console@exemplo.invalid', 'organizacao.editar', 'organizacao',
      org::text, org, 'Teste do console', '{"contato": "cliente@exemplo.com"}'::jsonb, null);
    r := r || jsonb_build_object('registro_com_email_no_antes', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('registro_com_email_no_antes', 'NEGADO:22023');
  end;

  begin
    perform public.platform_log_action(
      key, u_admin, 'equipe-console@exemplo.invalid', 'organizacao.editar', 'organizacao',
      org::text, org, 'Teste do console', null, '{"documento": "123.456.789-09"}'::jsonb);
    r := r || jsonb_build_object('registro_com_cpf_no_depois', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('registro_com_cpf_no_depois', 'NEGADO:22023');
  end;

  -- ---------------------------------------------------------------------------
  -- 6. Só de acréscimo
  -- ---------------------------------------------------------------------------
  begin
    update private.platform_audit_events set reason = 'alterado' where id = v_id;
    r := r || jsonb_build_object('registro_update', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('registro_update', 'NEGADO:42501');
  end;

  begin
    delete from private.platform_audit_events where id = v_id;
    r := r || jsonb_build_object('registro_delete', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('registro_delete', 'NEGADO:42501');
  end;

  begin
    truncate private.platform_audit_events;
    r := r || jsonb_build_object('registro_truncate', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('registro_truncate', 'NEGADO:42501');
  end;

  -- ---------------------------------------------------------------------------
  -- 7. Privilégios
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'saude_para_anon',
    has_function_privilege('anon', 'public.platform_health(text, text[])', 'execute'),
    'saude_para_authenticated',
    has_function_privilege('authenticated', 'public.platform_health(text, text[])', 'execute'),
    'registro_para_anon',
    has_function_privilege('anon',
      'public.platform_log_action(text, uuid, text, text, text, text, uuid, text, jsonb, jsonb)', 'execute'),
    'registro_para_authenticated',
    has_function_privilege('authenticated',
      'public.platform_log_action(text, uuid, text, text, text, text, uuid, text, jsonb, jsonb)', 'execute'),
    'lista_para_anon',
    has_function_privilege('anon',
      'public.platform_list_audit_events(text, integer, bigint, uuid, text)', 'execute'),
    'lista_para_authenticated',
    has_function_privilege('authenticated',
      'public.platform_list_audit_events(text, integer, bigint, uuid, text)', 'execute'),
    'tabela_para_anon',
    has_table_privilege('anon', 'private.platform_audit_events', 'select'),
    'tabela_para_authenticated',
    has_table_privilege('authenticated', 'private.platform_audit_events', 'select')
  );

  raise exception 'TESTE CONSOLE DA PLATAFORMA (rollback): %', r;
end;
$$;
