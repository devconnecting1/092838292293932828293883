-- Convenção do projeto, agora aplicada sem exceção: função que exige a chave do
-- servidor (`p_server_key`) concede EXECUTE **apenas a `anon`**, que é o papel
-- com que o servidor Next chama o PostgREST. `authenticated` nunca precisa
-- delas — o usuário logado não tem (nem pode ter) a chave do Vault.
--
-- A chave já protegia todas: quem chamasse sem ela levava 42501. Isto é
-- profundidade de defesa e, sobretudo, CONSISTÊNCIA — `reserve_ai_usage` e
-- `settle_ai_usage` já tinham sido revogadas em 20260916033724, e as demais
-- ficaram para trás conforme novas RPCs foram criadas. Exceção em postura de
-- segurança é exatamente onde o erro se esconde.
--
-- O laço percorre o catálogo em vez de listar nomes: novas RPCs de servidor
-- criadas até o momento em que esta migração roda também são cobertas.
do $$
declare
  r record;
  v_total integer := 0;
begin
  for r in
    select p.oid::regprocedure as assinatura
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and pg_get_function_arguments(p.oid) like '%p_server_key%'
      and has_function_privilege('authenticated', p.oid, 'execute')
    order by p.proname
  loop
    execute format('revoke all on function %s from authenticated', r.assinatura);
    v_total := v_total + 1;
    raise notice 'EXECUTE revogado de authenticated: %', r.assinatura;
  end loop;

  raise notice 'Total de funções ajustadas: %', v_total;
end;
$$;

-- Conferência: nenhuma função de servidor pode sobrar acessível a authenticated.
do $$
declare
  v_restantes integer;
begin
  select count(*) into v_restantes
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and pg_get_function_arguments(p.oid) like '%p_server_key%'
    and has_function_privilege('authenticated', p.oid, 'execute');

  if v_restantes > 0 then
    raise exception 'ainda restam % funções de servidor acessíveis a authenticated', v_restantes;
  end if;
end;
$$;
