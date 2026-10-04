-- =============================================================================
-- 1320 - Slug da imobiliária como subdomínio e backfill de perfis
-- =============================================================================
--  1. private.is_reserved_subdomain: subdomínios que nunca podem ser slug
--     (mesma lista de apps/web/lib/tenant/urls.ts)
--  2. organizations.slug: rótulo DNS válido e não reservado (CHECK)
--  3. create_organization: recusa formato inválido e endereço reservado
--  4. handle_new_user: full_name acima de 160 caracteres é truncado (antes
--     derrubava o cadastro no Supabase Auth)
--  5. Backfill idempotente de public.profiles para usuários criados antes do
--     trigger on_auth_user_created

-- -----------------------------------------------------------------------------
-- 1. Subdomínios reservados
-- -----------------------------------------------------------------------------
-- ATENÇÃO: manter igual a RESERVED_SUBDOMAINS em apps/web/lib/tenant/urls.ts.
create or replace function private.is_reserved_subdomain(p_slug text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(btrim(coalesce(p_slug, ''))) = any (array[
    'www', 'app', 'api', 'admin', 'auth', 'login', 'entrar', 'cadastro',
    'onboarding', 'painel', 'dashboard', 'conta', 'mail', 'email', 'smtp',
    'imap', 'pop', 'ftp', 'ns1', 'ns2', 'blog', 'docs', 'ajuda', 'suporte',
    'status', 'static', 'cdn', 'assets', 'img', 'media', 'files', 'storage',
    'dev', 'staging', 'preview', 'lp', 'feeds', 'captar', 'convite'
  ]::text[]);
$$;

-- A CHECK de organizations chama a função em todo INSERT/UPDATE da tabela, com
-- o papel de quem grava: authenticated (UPDATE de nome, marca etc. pelo dono)
-- e service_role precisam de EXECUTE. anon não grava em organizations.
revoke all on function private.is_reserved_subdomain(text) from public, anon;
grant execute on function private.is_reserved_subdomain(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. organizations.slug
-- -----------------------------------------------------------------------------
-- Rótulo DNS: 3 a 60 caracteres [a-z0-9-], sem hífen nas pontas (mesmo regex
-- do app). Além disso, sem "--" nas posições 3 e 4: esses rótulos são
-- reservados a nomes internacionalizados (ex.: "xn--..."), que o navegador pode
-- exibir com letras parecidas com as de outra marca.
-- Substitui a regra anterior (que proibia qualquer "--"). Os slugs existentes
-- foram conferidos antes; NOT VALID + VALIDATE separa a criação da verificação.
alter table public.organizations drop constraint organizations_slug_format;

alter table public.organizations
  add constraint organizations_slug_format
    check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,58})[a-z0-9]$' and substr(slug, 3, 2) <> '--') not valid,
  add constraint organizations_slug_not_reserved
    check (not private.is_reserved_subdomain(slug)) not valid;

alter table public.organizations validate constraint organizations_slug_format;
alter table public.organizations validate constraint organizations_slug_not_reserved;

-- -----------------------------------------------------------------------------
-- 3. create_organization
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(
  p_name text,
  p_slug text,
  p_legal_name text default null,
  p_cnpj text default null,
  p_creci text default null,
  p_city text default null,
  p_state text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_cnpj text := nullif(upper(regexp_replace(coalesce(p_cnpj, ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_state text := nullif(upper(btrim(coalesce(p_state, ''))), '');
  v_org uuid;
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado para criar uma imobiliária.'
      using errcode = '42501';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 160 then
    raise exception 'Informe o nome da imobiliária (2 a 160 caracteres).'
      using errcode = '22023';
  end if;

  if v_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,58})[a-z0-9]$'
     or substr(v_slug, 3, 2) = '--' then
    raise exception 'Endereço inválido: use de 3 a 60 letras minúsculas, números e hífens.'
      using errcode = '22023';
  end if;

  if private.is_reserved_subdomain(v_slug) then
    raise exception 'Este endereço é reservado. Escolha outro.'
      using errcode = '22023';
  end if;

  if exists (select 1 from public.organizations o where o.slug = v_slug) then
    raise exception 'O endereço "%" já está em uso. Escolha outro.', v_slug
      using errcode = '23505';
  end if;

  if v_state is not null and v_state !~ '^[A-Z]{2}$' then
    raise exception 'UF inválida: use a sigla com 2 letras.'
      using errcode = '22023';
  end if;

  if v_cnpj is not null and v_cnpj !~ '^[0-9A-Z]{12}[0-9]{2}$' then
    raise exception 'CNPJ inválido: informe os 14 caracteres.'
      using errcode = '22023';
  end if;

  insert into public.organizations (slug, name, legal_name, cnpj, creci, city, state, created_by)
  values (
    v_slug,
    v_name,
    nullif(btrim(p_legal_name), ''),
    v_cnpj,
    nullif(btrim(p_creci), ''),
    nullif(btrim(p_city), ''),
    v_state,
    v_user
  )
  returning id into v_org;

  insert into public.memberships (organization_id, user_id, role, active, created_by)
  values (v_org, v_user, 'owner', true, v_user);

  return v_org;
exception
  when unique_violation then
    raise exception 'O endereço "%" já está em uso. Escolha outro.', v_slug
      using errcode = '23505';
end;
$$;

revoke all on function public.create_organization(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. handle_new_user: nome longo não derruba o cadastro
-- -----------------------------------------------------------------------------
-- profiles.full_name aceita até 160 caracteres; o nome vindo do cadastro é
-- aparado e truncado nesse limite (vazio vira null), como antes.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    nullif(btrim(left(btrim(new.raw_user_meta_data ->> 'full_name'), 160)), ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Backfill de perfis
-- -----------------------------------------------------------------------------
-- Mesmas colunas do trigger de criação (id, full_name, email). Nome: full_name
-- do cadastro (aparado, até 160) ou, sem ele, a parte local do e-mail (até 160).
-- Também sincroniza profiles.email com auth.users.email (regra do trigger
-- on_auth_user_email_changed). Idempotente: só insere quem não tem perfil e só
-- atualiza e-mail diferente. profiles não tem trigger de autor nem de trava de
-- organização; a função roda como dona da tabela (sem RLS) na migração.
-- Retorna {"inserted": n, "email_synced": n}. Só o dono das tabelas executa.
create or replace function private.backfill_profiles()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_inserted integer;
  v_synced integer;
begin
  insert into public.profiles (id, full_name, email)
  select
    u.id,
    coalesce(
      nullif(btrim(left(btrim(u.raw_user_meta_data ->> 'full_name'), 160)), ''),
      nullif(btrim(left(split_part(coalesce(u.email, ''), '@', 1), 160)), '')
    ),
    u.email
  from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id)
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;

  update public.profiles p
  set email = u.email
  from auth.users u
  where u.id = p.id
    and p.email is distinct from u.email;
  get diagnostics v_synced = row_count;

  return jsonb_build_object('inserted', v_inserted, 'email_synced', v_synced);
end;
$$;

revoke all on function private.backfill_profiles() from public, anon, authenticated;

select private.backfill_profiles();
