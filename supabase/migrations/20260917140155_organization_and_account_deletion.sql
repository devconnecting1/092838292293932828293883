-- =============================================================================
-- Exclusão da imobiliária, exclusão da própria conta e lixeira fora do limite
-- =============================================================================
-- Fase 2 da "exclusão permanente" (fase 1: 20260917122657_trash_bin_and_subject_erasure).
--
-- 1. Lixeira fora do limite de imóveis com foto: private.owned_listing_count
--    ignora imóvel na lixeira (medidor da assinatura e gatilhos de limite usam a
--    mesma contagem). Restaurar um imóvel com foto própria acima do limite é
--    recusado com limite_owned_listings, como reativar um imóvel vendido.
-- 2. Excluir a imobiliária (só o dono): private.organization_deletions guarda o
--    agendamento (30 dias, cancelável). Enquanto houver agendamento,
--    private.billing_state devolve read_only: a trava de escrita que já existe
--    (gatilhos a0_billing_writable, uploads no Storage, feed dos portais,
--    importação, avisos) vale sem mudar nenhum desses pontos. Agendar exige a
--    assinatura da Stripe sem renovação (cancelada ou com cancelamento no fim do
--    período): o banco não fala com a Stripe e não pode deixar cobrança ativa
--    para uma imobiliária apagada. Ao fim do prazo, o pg_cron
--    imobiliaria-exclusao-diaria apaga public.organizations (cascata em todas as
--    tabelas da imobiliária; auditoria e "último dono" já tratam a cascata).
-- 3. Arquivos da imobiliária apagada: o banco não apaga do Storage
--    (storage.protect_delete) e o projeto não usa service_role. A rotina grava
--    private.organization_storage_purges; o servidor (rota
--    /api/cron/organization-deletion, CRON_SECRET) reserva lotes de caminhos com
--    a chave do Vault organization_deletion_server_key
--    (claim_organization_storage_objects), remove pela Storage API com a chave
--    publishable (papel anon) e baixa com settle_organization_storage_purge. As
--    políticas anon do Storage valem só para caminho reservado há menos de 10
--    minutos, cuja primeira pasta é uma imobiliária que já não existe.
-- 4. Aviso 3 dias antes: list_organization_deletion_reminders /
--    mark_organization_deletion_reminded (mesma chave), e-mail pelo módulo de
--    e-mail do app.
-- 5. Excluir minha conta (delete_my_account): sem service_role não há como
--    apagar auth.users (supabase.com/docs/guides/auth/managing-user-data só
--    documenta auth.admin.deleteUser). A função anonimiza o perfil, desativa
--    todas as memberships, apaga aparelhos de push, preferências, favoritos,
--    compartilhamentos e a fila do rodízio da pessoa; o app encerra as sessões
--    com signOut({ scope: "global" }). Quem é o único dono ativo de alguma
--    imobiliária é recusado (P0001 unico_dono).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Lixeira fora do limite de imóveis com foto
-- -----------------------------------------------------------------------------
do $patch$
declare
  v_def text;
  v_from constant text := 'and p.status <> all (private.owned_listing_exempt_statuses())';
  v_to constant text := E'and p.status <> all (private.owned_listing_exempt_statuses())\n    and p.deleted_at is null';
begin
  v_def := pg_get_functiondef('private.owned_listing_count(uuid, uuid)'::regprocedure);

  if strpos(v_def, v_from) = 0 then
    raise exception 'Trecho não encontrado em private.owned_listing_count: %', v_from;
  end if;

  if strpos(v_def, 'p.deleted_at is null') > 0 then
    raise exception 'private.owned_listing_count já ignora a lixeira';
  end if;

  execute replace(v_def, v_from, v_to);
end
$patch$;

comment on function private.owned_listing_count(uuid, uuid) is
  'Imóveis com foto no nosso bucket que contam em limits.owned_listings: fora dos status liberados (vendido, alugado, inativo) e fora da lixeira. p_except exclui um imóvel da conta. Usada pelo medidor da assinatura e pelos gatilhos de limite.';

create or replace function private.assert_owned_listing_restorable(p_organization_id uuid, p_property_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.property_status;
  v_limit integer;
  v_listings integer;
begin
  select p.status into v_status
  from public.properties p
  where p.organization_id = p_organization_id and p.id = p_property_id;

  if v_status is null or v_status = any (private.owned_listing_exempt_statuses()) then
    return;
  end if;

  if not exists (
    select 1
    from public.property_media m
    where m.organization_id = p_organization_id
      and m.property_id = p_property_id
      and m.kind = 'image'
      and m.storage_path is not null
  ) then
    return;
  end if;

  v_limit := private.billing_limit(p_organization_id, 'owned_listings');

  if v_limit is null or v_limit < 0 then
    return;
  end if;

  -- Mesma chave do upload e da reativação: não passam juntos pela última vaga.
  perform pg_advisory_xact_lock(
    hashtextextended('billing_owned_listings:' || p_organization_id::text, 0)
  );

  v_listings := private.owned_listing_count(p_organization_id, p_property_id);

  if v_listings + 1 > v_limit then
    raise exception 'limite_owned_listings'
      using errcode = 'P0001',
            detail = jsonb_build_object('limit', v_limit, 'usage', v_listings)::text;
  end if;
end;
$$;

comment on function private.assert_owned_listing_restorable(uuid, uuid) is
  'Restaurar da lixeira um imóvel com foto própria (fora dos status liberados) volta a ocupar vaga de limits.owned_listings: acima do limite, P0001 limite_owned_listings.';

create or replace function public.restore_from_trash(p_entity text, p_record_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record record;
begin
  select * into v_record from private.trash_record(p_entity, p_record_id);
  perform private.trash_require_manager(v_record.organization_id);

  if v_record.deleted_at is null or v_record.anonymized_at is not null then
    raise exception 'Este registro não está na lixeira.' using errcode = '55000';
  end if;

  if p_entity = 'lead' then
    update public.leads l set deleted_at = null, deleted_by = null where l.id = p_record_id;
  elsif p_entity = 'client' then
    update public.clients c set deleted_at = null, deleted_by = null where c.id = p_record_id;
  else
    perform private.assert_owned_listing_restorable(v_record.organization_id, p_record_id);
    update public.properties p set deleted_at = null, deleted_by = null where p.id = p_record_id;
  end if;

  perform private.trash_audit(v_record.organization_id, 'restore', p_entity, p_record_id, '{}'::jsonb);
end;
$$;

comment on function public.restore_from_trash(text, uuid) is
  'Restaurar (dono/gerente): tira da lixeira. Anonimizado não volta. Imóvel com foto própria acima do limite do plano: P0001 limite_owned_listings.';

-- -----------------------------------------------------------------------------
-- 2. Tabelas internas
-- -----------------------------------------------------------------------------
create table private.organization_deletions (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  execute_after timestamptz not null,
  reminder_sent_at timestamptz,
  last_attempt_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 60),
  constraint organization_deletions_window check (execute_after > requested_at)
);

comment on table private.organization_deletions is
  'Exclusão da imobiliária agendada pelo dono (30 dias, cancelável). Com linha aqui, private.billing_state devolve read_only (trava de escrita). O pg_cron imobiliaria-exclusao-diaria apaga a imobiliária depois de execute_after; cancelar apaga a linha. requested_by = auth.users.id, sem FK.';

alter table private.organization_deletions enable row level security;

create policy "organization_deletions: sem acesso pela API" on private.organization_deletions
  as restrictive for all to anon, authenticated using (false) with check (false);

comment on policy "organization_deletions: sem acesso pela API" on private.organization_deletions is
  'Negação explícita (RESTRICTIVE): tabela interna, lida e gravada só por funções security definer e rotinas agendadas. Nunca crie política permissiva nem grant para anon/authenticated aqui.';

revoke all on private.organization_deletions from anon, authenticated;

create table private.organization_storage_purges (
  organization_id uuid primary key,
  requested_at timestamptz,
  deleted_at timestamptz not null default now(),
  finished_at timestamptz
);

comment on table private.organization_storage_purges is
  'Imobiliárias já apagadas cujos arquivos do Storage (client-documents, property-media, property-documents e landing-assets, primeira pasta = id) ainda saem pelo servidor. Sem FK: a imobiliária não existe mais. Serve também de registro da exclusão, sem dado pessoal. finished_at = nenhum arquivo restante.';

alter table private.organization_storage_purges enable row level security;

create policy "organization_storage_purges: sem acesso pela API" on private.organization_storage_purges
  as restrictive for all to anon, authenticated using (false) with check (false);

comment on policy "organization_storage_purges: sem acesso pela API" on private.organization_storage_purges is
  'Negação explícita (RESTRICTIVE): tabela interna, lida e gravada só por funções security definer e rotinas agendadas. Nunca crie política permissiva nem grant para anon/authenticated aqui.';

revoke all on private.organization_storage_purges from anon, authenticated;

create table private.organization_storage_claims (
  bucket_id text not null check (bucket_id in ('client-documents', 'property-media', 'property-documents', 'landing-assets')),
  object_path text not null check (char_length(object_path) between 1 and 1024),
  organization_id uuid not null references private.organization_storage_purges (organization_id) on delete cascade,
  expires_at timestamptz not null,
  constraint organization_storage_claims_pkey primary key (bucket_id, object_path)
);

create index organization_storage_claims_organization_idx
  on private.organization_storage_claims (organization_id);

comment on table private.organization_storage_claims is
  'Lote de arquivos de imobiliária apagada reservado pelo servidor para remoção pela Storage API (papel anon). As políticas "exclusão da imobiliária: ..." do Storage só liberam caminho reservado e não vencido (10 minutos).';

alter table private.organization_storage_claims enable row level security;

create policy "organization_storage_claims: sem acesso pela API" on private.organization_storage_claims
  as restrictive for all to anon, authenticated using (false) with check (false);

comment on policy "organization_storage_claims: sem acesso pela API" on private.organization_storage_claims is
  'Negação explícita (RESTRICTIVE): tabela interna, lida e gravada só por funções security definer. Nunca crie política permissiva nem grant para anon/authenticated aqui.';

revoke all on private.organization_storage_claims from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Trava de escrita: exclusão agendada = modo leitura
-- -----------------------------------------------------------------------------
do $patch$
declare
  v_def text;
  v_from constant text := 'when b.platform_blocked_at is not null then ''read_only''';
  v_to constant text := E'when b.platform_blocked_at is not null then ''read_only''\n      when exists (\n        select 1 from private.organization_deletions d where d.organization_id = org\n      ) then ''read_only''';
begin
  v_def := pg_get_functiondef('private.billing_state(uuid)'::regprocedure);

  if strpos(v_def, v_from) = 0 then
    raise exception 'Trecho não encontrado em private.billing_state: %', v_from;
  end if;

  if strpos(v_def, 'private.organization_deletions') > 0 then
    raise exception 'private.billing_state já considera a exclusão agendada';
  end if;

  execute replace(v_def, v_from, v_to);
end
$patch$;

comment on function private.billing_state(uuid) is
  'Estado de escrita da imobiliária: read_only quando bloqueada pela plataforma, com exclusão agendada (private.organization_deletions) ou sem assinatura válida; senão o estado calculado da assinatura. Usada pelos gatilhos a0_billing_writable, Storage, feed, importação e avisos.';

-- -----------------------------------------------------------------------------
-- 4. Funções internas
-- -----------------------------------------------------------------------------
create or replace function private.organization_subscription_renews(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.billing_accounts b
    where b.organization_id = p_organization_id
      and b.stripe_subscription_id is not null
      and b.status in ('trialing', 'active', 'past_due', 'unpaid', 'incomplete', 'paused')
      and not b.cancel_at_period_end
  );
$$;

comment on function private.organization_subscription_renews(uuid) is
  'A assinatura da Stripe ainda renova (existe, não encerrada e sem cancelamento no fim do período). Com renovação, a exclusão da imobiliária não é agendada nem executada.';

create or replace function private.organization_owner_emails(p_organization_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct lower(u.email::text)), '{}')
  from public.memberships m
  join auth.users u on u.id = m.user_id
  where m.organization_id = p_organization_id
    and m.active
    and m.role = 'owner'
    and u.email is not null;
$$;

comment on function private.organization_owner_emails(uuid) is
  'E-mails dos donos ativos da imobiliária (avisos de exclusão agendada).';

create or replace function private.check_organization_deletion_server_key(p_server_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'organization_deletion_server_key'
  limit 1;

  if v_secret is null
     or p_server_key is null
     or extensions.digest(p_server_key, 'sha256') <> extensions.digest(v_secret, 'sha256') then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
end;
$$;

comment on function private.check_organization_deletion_server_key(text) is
  'Confere a chave do servidor da exclusão de imobiliária (Vault organization_deletion_server_key = env ORGANIZATION_DELETION_SERVER_KEY). Recusa com 42501.';

do $$
begin
  if not exists (select 1 from vault.secrets s where s.name = 'organization_deletion_server_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'organization_deletion_server_key',
      'Chave do servidor Next para os avisos e a limpeza do Storage da exclusão de imobiliária (env ORGANIZATION_DELETION_SERVER_KEY).'
    );
  end if;
end;
$$;

create or replace function private.storage_object_claimed_for_organization_purge(p_bucket_id text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.organization_storage_claims c
    where c.bucket_id = p_bucket_id
      and c.object_path = p_name
      and c.expires_at > now()
      and c.organization_id = private.try_uuid(split_part(p_name, '/', 1))
      and not exists (select 1 from public.organizations o where o.id = c.organization_id)
  );
$$;

comment on function private.storage_object_claimed_for_organization_purge(text, text) is
  'Política de Storage da exclusão de imobiliária: o arquivo foi reservado pelo servidor há menos de 10 minutos e a primeira pasta é uma imobiliária que já não existe.';

create or replace function private.execute_due_organization_deletions(p_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_deleted integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_limit constant integer := least(greatest(coalesce(p_limit, 5), 1), 50);
begin
  for v_item in
    select d.organization_id, d.requested_at
    from private.organization_deletions d
    where d.execute_after <= now()
    order by d.execute_after
    limit v_limit
  loop
    if private.organization_subscription_renews(v_item.organization_id) then
      update private.organization_deletions d
      set last_attempt_at = now(), last_error = 'assinatura_ativa'
      where d.organization_id = v_item.organization_id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    begin
      insert into private.organization_storage_purges (organization_id, requested_at, deleted_at)
      values (v_item.organization_id, v_item.requested_at, now())
      on conflict (organization_id) do update
        set requested_at = excluded.requested_at, deleted_at = excluded.deleted_at, finished_at = null;

      delete from public.organizations o where o.id = v_item.organization_id;
      v_deleted := v_deleted + 1;
    exception when others then
      v_failed := v_failed + 1;
      update private.organization_deletions d
      set last_attempt_at = now(), last_error = 'falha:' || sqlstate
      where d.organization_id = v_item.organization_id;
    end;
  end loop;

  return jsonb_build_object('deleted', v_deleted, 'skipped', v_skipped, 'failed', v_failed);
end;
$$;

comment on function private.execute_due_organization_deletions(integer) is
  'Rotina agendada (pg_cron imobiliaria-exclusao-diaria, 06:41 UTC): apaga as imobiliárias com exclusão vencida (cascata do banco) e registra em private.organization_storage_purges para o servidor remover os arquivos. Assinatura voltou a renovar: pula (last_error assinatura_ativa). Falha de uma não para as outras.';

select cron.schedule(
  'imobiliaria-exclusao-diaria',
  '41 6 * * *',
  $cron$ select private.execute_due_organization_deletions(); $cron$
);

-- -----------------------------------------------------------------------------
-- 5. RPCs com sessão
-- -----------------------------------------------------------------------------
create or replace function public.get_organization_deletion(p_organization_id uuid)
returns table (
  scheduled boolean,
  requested_at timestamptz,
  execute_after timestamptz,
  requested_by_name text,
  subscription_renews boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.organization_id is not null,
    d.requested_at,
    d.execute_after,
    nullif(btrim(pf.full_name), ''),
    private.organization_subscription_renews(p_organization_id)
  from (select 1) as one
  left join private.organization_deletions d on d.organization_id = p_organization_id
  left join public.profiles pf on pf.id = d.requested_by
  where private.is_member(p_organization_id);
$$;

comment on function public.get_organization_deletion(uuid) is
  'Exclusão agendada da imobiliária (membros ativos): se há agendamento, quando pediu, quando apaga, quem pediu e se a assinatura ainda renova. Quem não é membro recebe nada.';

create or replace function public.schedule_organization_deletion(p_organization_id uuid, p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_actor constant uuid := (select auth.uid());
  v_execute_after timestamptz;
begin
  if p_organization_id is null
     or not private.has_role(p_organization_id, '{owner}'::public.app_role[]) then
    raise exception 'Só o dono da imobiliária pode fazer isso.' using errcode = '42501';
  end if;

  select o.id, o.name, o.slug, o.brand into v_org
  from public.organizations o
  where o.id = p_organization_id
  for update;

  if exists (select 1 from private.organization_deletions d where d.organization_id = p_organization_id) then
    raise exception 'A exclusão desta imobiliária já está agendada.' using errcode = '55000';
  end if;

  if not private.trash_confirmation_matches(p_confirmation, v_org.name, v_org.slug) then
    raise exception 'Digite o nome ou o link da imobiliária exatamente como aparece para confirmar.'
      using errcode = '22023';
  end if;

  if private.organization_subscription_renews(p_organization_id) then
    raise exception 'Cancele a assinatura antes de agendar a exclusão.'
      using errcode = 'P0001', hint = 'assinatura_ativa';
  end if;

  v_execute_after := now() + interval '30 days';

  insert into private.organization_deletions (organization_id, requested_by, requested_at, execute_after)
  values (p_organization_id, v_actor, now(), v_execute_after);

  insert into public.audit_events (organization_id, actor_id, action, entity, entity_id, metadata)
  values (
    p_organization_id, v_actor, 'deletion_scheduled', 'organizations', p_organization_id,
    jsonb_build_object('execute_after', v_execute_after)
  );

  return jsonb_build_object(
    'execute_after', v_execute_after,
    'organization_slug', v_org.slug,
    'organization_name', v_org.name,
    'brand_color', nullif(v_org.brand ->> 'primary_color', ''),
    'owner_emails', to_jsonb(private.organization_owner_emails(p_organization_id))
  );
end;
$$;

comment on function public.schedule_organization_deletion(uuid, text) is
  'Excluir a imobiliária (só o dono): agenda para daqui a 30 dias; a conta fica em modo leitura até lá. p_confirmation = nome ou link (slug). Assinatura que ainda renova: P0001 hint assinatura_ativa. Devolve a data e os e-mails dos donos para o aviso.';

create or replace function public.cancel_organization_deletion(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null
     or not private.has_role(p_organization_id, '{owner}'::public.app_role[]) then
    raise exception 'Só o dono da imobiliária pode fazer isso.' using errcode = '42501';
  end if;

  delete from private.organization_deletions d where d.organization_id = p_organization_id;

  if not found then
    raise exception 'Não há exclusão agendada para esta imobiliária.' using errcode = '55000';
  end if;

  insert into public.audit_events (organization_id, actor_id, action, entity, entity_id, metadata)
  values (p_organization_id, (select auth.uid()), 'deletion_canceled', 'organizations', p_organization_id, '{}'::jsonb);
end;
$$;

comment on function public.cancel_organization_deletion(uuid) is
  'Cancelar a exclusão agendada (só o dono): a conta sai do modo leitura na hora.';

create or replace function public.get_my_account_deletion_blockers()
returns table (organization_id uuid, organization_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = (select auth.uid())
    and m.active
    and m.role = 'owner'
    and not exists (
      select 1
      from public.memberships m2
      where m2.organization_id = m.organization_id
        and m2.id <> m.id
        and m2.active
        and m2.role = 'owner'
    )
  order by o.name;
$$;

comment on function public.get_my_account_deletion_blockers() is
  'Imobiliárias em que o usuário da sessão é o único dono ativo: enquanto houver alguma, a própria conta não pode ser excluída.';

create or replace function public.delete_my_account(p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user constant uuid := (select auth.uid());
  v_email text;
  v_blockers text;
  v_memberships integer;
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  select lower(u.email::text) into v_email from auth.users u where u.id = v_user;

  if v_email is null or p_confirmation is null or lower(btrim(p_confirmation)) <> v_email then
    raise exception 'Digite o seu e-mail de acesso exatamente como aparece para confirmar.'
      using errcode = '22023';
  end if;

  select string_agg(b.organization_name, ', ' order by b.organization_name)
    into v_blockers
  from public.get_my_account_deletion_blockers() b;

  if v_blockers is not null then
    raise exception 'Você é o único dono de: %. Torne outra pessoa dona em Configurações > Equipe ou exclua a imobiliária antes de excluir a sua conta.', v_blockers
      using errcode = 'P0001', hint = 'unico_dono';
  end if;

  delete from public.lead_routing_members r where r.user_id = v_user;
  delete from public.client_shares s where s.user_id = v_user;
  delete from public.property_shares s where s.user_id = v_user;
  delete from public.push_subscriptions p where p.user_id = v_user;
  delete from public.email_preferences e where e.user_id = v_user;
  delete from public.platform_announcement_dismissals a where a.user_id = v_user;
  delete from public.caixa_favorites f where f.user_id = v_user;

  update public.memberships m set active = false where m.user_id = v_user and m.active;
  get diagnostics v_memberships = row_count;

  update public.profiles p
  set full_name = 'Usuário removido',
      email = null,
      phone = null,
      avatar_url = null,
      creci_number = null,
      creci_state = null,
      creci_valid_until = null
  where p.id = v_user;

  return jsonb_build_object('memberships_deactivated', v_memberships);
end;
$$;

comment on function public.delete_my_account(text) is
  'Excluir minha conta (usuário da sessão; p_confirmation = e-mail de acesso): anonimiza o perfil (nome "Usuário removido"; e-mail, telefone, foto e CRECI apagados), desativa todas as memberships e apaga aparelhos de push, preferências, favoritos, compartilhamentos recebidos e a vaga no rodízio. O que a pessoa registrou nas imobiliárias fica com elas. O login (auth.users) continua: o app encerra as sessões com signOut global. Único dono ativo: P0001 hint unico_dono.';

-- -----------------------------------------------------------------------------
-- 6. RPCs do servidor (chave organization_deletion_server_key; só anon)
-- -----------------------------------------------------------------------------
create or replace function public.list_organization_deletion_reminders(p_server_key text, p_limit integer)
returns table (
  organization_id uuid,
  organization_slug text,
  organization_name text,
  brand_color text,
  execute_after timestamptz,
  recipient_emails text[]
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.check_organization_deletion_server_key(p_server_key);

  return query
  select
    d.organization_id,
    o.slug,
    o.name,
    nullif(o.brand ->> 'primary_color', ''),
    d.execute_after,
    private.organization_owner_emails(d.organization_id)
  from private.organization_deletions d
  join public.organizations o on o.id = d.organization_id
  where d.reminder_sent_at is null
    and d.execute_after > now()
    and d.execute_after <= now() + interval '3 days'
  order by d.execute_after
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

comment on function public.list_organization_deletion_reminders(text, integer) is
  'Servidor (chave organization_deletion_server_key): exclusões que acontecem em até 3 dias e ainda sem aviso, com os e-mails dos donos ativos.';

create or replace function public.mark_organization_deletion_reminded(p_server_key text, p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_organization_deletion_server_key(p_server_key);

  update private.organization_deletions d
  set reminder_sent_at = now()
  where d.organization_id = p_organization_id and d.reminder_sent_at is null;

  return found;
end;
$$;

comment on function public.mark_organization_deletion_reminded(text, uuid) is
  'Servidor: marca o aviso de 3 dias como enviado (uma vez por agendamento).';

create or replace function public.claim_organization_storage_objects(p_server_key text, p_limit integer)
returns table (bucket_id text, object_path text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit constant integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
begin
  perform private.check_organization_deletion_server_key(p_server_key);

  return query
  with candidates as (
    select o.bucket_id as bucket, o.name as path, pu.organization_id as org
    from private.organization_storage_purges pu
    join storage.objects o
      on o.bucket_id in ('client-documents', 'property-media', 'property-documents', 'landing-assets')
     and o.name like pu.organization_id::text || '/%'
    where pu.finished_at is null
      and not exists (select 1 from public.organizations x where x.id = pu.organization_id)
      and not exists (
        select 1
        from private.organization_storage_claims c
        where c.bucket_id = o.bucket_id and c.object_path = o.name and c.expires_at > now()
      )
    order by pu.deleted_at, o.bucket_id, o.name
    limit v_limit
  ), claimed as (
    insert into private.organization_storage_claims as c (bucket_id, object_path, organization_id, expires_at)
    select k.bucket, k.path, k.org, now() + interval '10 minutes'
    from candidates k
    on conflict on constraint organization_storage_claims_pkey
      do update set expires_at = excluded.expires_at
    returning c.bucket_id as bucket, c.object_path as path
  )
  select cl.bucket, cl.path from claimed cl;
end;
$$;

comment on function public.claim_organization_storage_objects(text, integer) is
  'Servidor (chave organization_deletion_server_key): reserva por 10 minutos até p_limit (máx. 1.000) arquivos de imobiliárias já apagadas e devolve os caminhos para remoção pela Storage API.';

create or replace function public.settle_organization_storage_purge(p_server_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released integer;
  v_finished integer;
begin
  perform private.check_organization_deletion_server_key(p_server_key);

  delete from private.organization_storage_claims c
  where c.expires_at <= now()
     or not exists (
       select 1 from storage.objects o
       where o.bucket_id = c.bucket_id and o.name = c.object_path
     );
  get diagnostics v_released = row_count;

  update private.organization_storage_purges pu
  set finished_at = now()
  where pu.finished_at is null
    and not exists (select 1 from public.organizations x where x.id = pu.organization_id)
    and not exists (
      select 1 from private.organization_storage_claims c where c.organization_id = pu.organization_id
    )
    and not exists (
      select 1
      from storage.objects o
      where o.bucket_id in ('client-documents', 'property-media', 'property-documents', 'landing-assets')
        and o.name like pu.organization_id::text || '/%'
    );
  get diagnostics v_finished = row_count;

  return jsonb_build_object('released', v_released, 'finished', v_finished);
end;
$$;

comment on function public.settle_organization_storage_purge(text) is
  'Servidor: tira da reserva o que já sumiu do Storage (ou venceu) e conclui (finished_at) a imobiliária sem arquivo restante. Devolve released e finished.';

-- -----------------------------------------------------------------------------
-- 7. Storage: o servidor (anon) remove só o que reservou
-- -----------------------------------------------------------------------------
create policy "exclusão da imobiliária: servidor lê arquivo reservado" on storage.objects
  for select to anon
  using (
    bucket_id in ('client-documents', 'property-media', 'property-documents', 'landing-assets')
    and private.storage_object_claimed_for_organization_purge(bucket_id, name)
  );

create policy "exclusão da imobiliária: servidor remove arquivo reservado" on storage.objects
  for delete to anon
  using (
    bucket_id in ('client-documents', 'property-media', 'property-documents', 'landing-assets')
    and private.storage_object_claimed_for_organization_purge(bucket_id, name)
  );

-- -----------------------------------------------------------------------------
-- 8. Privilégios
-- -----------------------------------------------------------------------------
revoke all on function private.assert_owned_listing_restorable(uuid, uuid) from public, anon, authenticated;
revoke all on function private.organization_subscription_renews(uuid) from public, anon, authenticated;
revoke all on function private.organization_owner_emails(uuid) from public, anon, authenticated;
revoke all on function private.check_organization_deletion_server_key(text) from public, anon, authenticated;
revoke all on function private.execute_due_organization_deletions(integer) from public, anon, authenticated;

revoke all on function private.storage_object_claimed_for_organization_purge(text, text) from public, authenticated;
grant execute on function private.storage_object_claimed_for_organization_purge(text, text) to anon;

revoke all on function public.get_organization_deletion(uuid) from public, anon;
revoke all on function public.schedule_organization_deletion(uuid, text) from public, anon;
revoke all on function public.cancel_organization_deletion(uuid) from public, anon;
revoke all on function public.get_my_account_deletion_blockers() from public, anon;
revoke all on function public.delete_my_account(text) from public, anon;

grant execute on function public.get_organization_deletion(uuid) to authenticated;
grant execute on function public.schedule_organization_deletion(uuid, text) to authenticated;
grant execute on function public.cancel_organization_deletion(uuid) to authenticated;
grant execute on function public.get_my_account_deletion_blockers() to authenticated;
grant execute on function public.delete_my_account(text) to authenticated;

revoke all on function public.list_organization_deletion_reminders(text, integer) from public, authenticated;
revoke all on function public.mark_organization_deletion_reminded(text, uuid) from public, authenticated;
revoke all on function public.claim_organization_storage_objects(text, integer) from public, authenticated;
revoke all on function public.settle_organization_storage_purge(text) from public, authenticated;

grant execute on function public.list_organization_deletion_reminders(text, integer) to anon;
grant execute on function public.mark_organization_deletion_reminded(text, uuid) to anon;
grant execute on function public.claim_organization_storage_objects(text, integer) to anon;
grant execute on function public.settle_organization_storage_purge(text) to anon;
