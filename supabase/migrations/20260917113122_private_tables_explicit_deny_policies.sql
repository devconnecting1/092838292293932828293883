-- =============================================================================
-- Política explícita de negação nas tabelas do schema private
-- =============================================================================
-- Security Advisor, lint 0008 (rls_enabled_no_policy):
-- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
--
-- As tabelas de private têm RLS ligada e nenhuma política de propósito: só
-- funções security definer (dono postgres, que tem BYPASSRLS) e as rotinas
-- agendadas leem e gravam nelas. O schema não está exposto na API (PostgREST
-- responde PGRST106 para Accept-Profile: private) e anon não tem USAGE nele.
--
-- A política abaixo não muda nenhum acesso de hoje (sem política o RLS já nega
-- tudo, e anon/authenticated nem têm grant nessas tabelas). Ela documenta a
-- intenção no próprio banco e serve de trava: por ser RESTRICTIVE, uma política
-- permissiva criada por engano depois continua sem abrir nada para a API.
--
-- O bloco percorre o catálogo e falha se sobrar tabela de private sem RLS ou
-- sem política. Tabela nova em private: RLS + a mesma política.
-- =============================================================================

do $$
declare
  v_table record;
  v_missing text;
begin
  if has_schema_privilege('anon', 'private', 'usage') then
    raise exception 'anon não pode ter USAGE no schema private.';
  end if;

  for v_table in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and not exists (select 1 from pg_catalog.pg_policy p where p.polrelid = c.oid)
    order by c.relname
  loop
    execute format(
      'create policy %I on private.%I as restrictive for all to anon, authenticated using (false) with check (false)',
      v_table.relname || ': sem acesso pela API',
      v_table.relname
    );
    execute format(
      'comment on policy %I on private.%I is %L',
      v_table.relname || ': sem acesso pela API',
      v_table.relname,
      'Negação explícita (RESTRICTIVE): tabela interna, lida e gravada só por funções security definer '
        || 'e rotinas agendadas. Nunca crie política permissiva nem grant para anon/authenticated aqui.'
    );
  end loop;

  select string_agg(c.relname, ', ' order by c.relname)
    into v_missing
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private'
    and c.relkind in ('r', 'p')
    and (
      not c.relrowsecurity
      or not exists (select 1 from pg_catalog.pg_policy p where p.polrelid = c.oid)
    );

  if v_missing is not null then
    raise exception 'Tabelas de private sem RLS ou sem política: %', v_missing;
  end if;
end;
$$;
