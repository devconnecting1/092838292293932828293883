-- =============================================================================
-- Lixeira de 30 dias, exclusão permanente e pedido do titular (LGPD)
-- =============================================================================
-- Fase 1 da "exclusão permanente" para leads, clientes e imóveis.
--
-- Fontes (abertas em 17/09/2026):
--  * LGPD, Lei 13.709/2018 (planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm):
--    art. 5º XI, XIII e XIV (anonimização, bloqueio, eliminação); art. 16, I
--    (conservação autorizada para cumprir obrigação legal); art. 18, IV e VI
--    (anonimização/eliminação a pedido do titular, exceto nas hipóteses do
--    art. 16).
--  * Lei 9.613/1998 (planalto.gov.br/ccivil_03/leis/l9613.htm): art. 9º,
--    parágrafo único, X (promoção imobiliária e compra e venda de imóveis) e
--    art. 10, I, II e § 2º (cadastro de clientes e registro de transações
--    conservados por no mínimo cinco anos a partir da conclusão da transação).
--  * COFECI e DIMOB: nenhum prazo de guarda foi encontrado nas páginas oficiais
--    abertas hoje; nenhum prazo foi inventado.
--
-- O que muda:
--  1. leads, clients e properties ganham deleted_at/deleted_by: "Excluir" move
--     para a lixeira. clients ganha anonymized_at e identification_kept_until;
--     properties ganha anonymized_at.
--  2. RLS: política RESTRICTIVE de SELECT tira o que está na lixeira de toda
--     consulta com sessão (listas, buscas, exportações, painel, fichas). As
--     políticas de DELETE direto saem: apagar de verdade só pelas RPCs, que
--     conferem a guarda legal e gravam comprovante.
--  3. Funções security definer (ignoram RLS) passam a filtrar deleted_at:
--     página pública do imóvel, sitemap, feed dos portais, landing page,
--     formulário do imóvel, relatórios, resumo diário, rodízio/SLA e avisos de
--     lead. O gatilho de auditoria não registra mover/restaurar (as RPCs gravam
--     o próprio evento).
--  4. Guarda legal (private.record_legal_holds): proposta aceita, comissão
--     lançada, autorização assinada e documento do dossiê do imóvel. Com
--     guarda, apagar por inteiro é recusado e a ação vira anonimização:
--       * cliente: saem contato, endereço, RG, nascimento, observações,
--         etiquetas, perfis de busca, compartilhamentos e histórico. Com
--         transação (proposta aceita ou comissão, inclusive de imóvel de que é
--         proprietário), nome, CPF/CNPJ e documentos ficam até 5 anos após a
--         conclusão (Lei 9.613, art. 10, § 2º) e a rotina diária os apaga
--         depois; sem transação, saem na hora.
--       * imóvel: saem fotos, vídeo, tour e descrição e, sem transação, rua,
--         número, complemento e coordenadas; dossiê, propostas e comissões
--         ficam.
--     O registro anonimizado continua fora das telas (bloqueio).
--  5. Pedido do titular (erase_subject_data): apaga na hora ou anonimiza, e
--     grava comprovante sem dado pessoal em public.data_erasure_receipts (e
--     uma nota no histórico do cliente anonimizado).
--  6. Arquivos: o banco não apaga do Storage (storage.protect_delete; ver
--     20260915112227_storage_savings). O caminho vai para
--     private.storage_purge_queue e o servidor remove pela Storage API com a
--     sessão de dono/gerente (políticas novas valem só para arquivos na fila).
--  7. pg_cron lixeira-expurgo-diario (06:23 UTC): após 30 dias na lixeira
--     apaga de vez (ou anonimiza, com guarda) e conclui a anonimização cujo
--     prazo de guarda venceu.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Colunas
-- -----------------------------------------------------------------------------
alter table public.leads
  add column deleted_at timestamptz,
  add column deleted_by uuid;

alter table public.clients
  add column deleted_at timestamptz,
  add column deleted_by uuid,
  add column anonymized_at timestamptz,
  add column identification_kept_until date,
  add constraint clients_anonymized_in_trash check (anonymized_at is null or deleted_at is not null);

alter table public.properties
  add column deleted_at timestamptz,
  add column deleted_by uuid,
  add column anonymized_at timestamptz,
  add constraint properties_anonymized_in_trash check (anonymized_at is null or deleted_at is not null);

comment on column public.leads.deleted_at is
  'Quando foi para a lixeira (some das telas, buscas, relatórios e avisos). Após 30 dias a rotina lixeira-expurgo-diario apaga de vez.';
comment on column public.leads.deleted_by is
  'Quem moveu para a lixeira (auth.users.id, sem FK: a pessoa pode sair da imobiliária).';
comment on column public.clients.deleted_at is
  'Quando foi para a lixeira (some das telas). Após 30 dias a rotina apaga de vez ou, com guarda legal, anonimiza.';
comment on column public.clients.deleted_by is
  'Quem moveu para a lixeira (auth.users.id, sem FK).';
comment on column public.clients.anonymized_at is
  'Quando os dados pessoais foram anonimizados (guarda legal ou pedido do titular). O registro fica bloqueado, fora das telas.';
comment on column public.clients.identification_kept_until is
  'Nome, CPF/CNPJ e documentos guardados até esta data (5 anos da conclusão da transação, Lei 9.613/1998, art. 10, § 2º). Depois a rotina diária os apaga.';
comment on column public.properties.deleted_at is
  'Quando foi para a lixeira (some das telas, portais, sitemap e página pública). Após 30 dias a rotina apaga de vez ou, com guarda legal, anonimiza.';
comment on column public.properties.deleted_by is
  'Quem moveu para a lixeira (auth.users.id, sem FK).';
comment on column public.properties.anonymized_at is
  'Quando fotos, descrição e (sem transação) endereço foram apagados por guarda legal. O dossiê, as propostas e as comissões ficam.';

create index leads_trash_idx on public.leads (organization_id, deleted_at) where deleted_at is not null;
create index clients_trash_idx on public.clients (organization_id, deleted_at) where deleted_at is not null;
create index properties_trash_idx on public.properties (organization_id, deleted_at) where deleted_at is not null;

-- -----------------------------------------------------------------------------
-- 2. RLS: lixeira fora das consultas; sem DELETE direto
-- -----------------------------------------------------------------------------
drop policy "leads: dono e gerente removem" on public.leads;
drop policy "clients: dono e gerente removem" on public.clients;
drop policy "properties: dono e gerente removem" on public.properties;

create policy "leads: lixeira fora das consultas" on public.leads
  as restrictive for select to authenticated using (deleted_at is null);
create policy "clients: lixeira fora das consultas" on public.clients
  as restrictive for select to authenticated using (deleted_at is null);
create policy "properties: lixeira fora das consultas" on public.properties
  as restrictive for select to authenticated using (deleted_at is null);

comment on policy "leads: lixeira fora das consultas" on public.leads is
  'RESTRICTIVE: lead na lixeira não aparece em nenhuma consulta com sessão (e, por consequência, não é editado). Lixeira, restauração e exclusão só pelas RPCs move_to_trash, list_trash, restore_from_trash, purge_from_trash e erase_subject_data.';
comment on policy "clients: lixeira fora das consultas" on public.clients is
  'RESTRICTIVE: cliente na lixeira ou anonimizado não aparece em nenhuma consulta com sessão. Ver RPCs da lixeira.';
comment on policy "properties: lixeira fora das consultas" on public.properties is
  'RESTRICTIVE: imóvel na lixeira ou anonimizado não aparece em nenhuma consulta com sessão. Ver RPCs da lixeira.';

-- -----------------------------------------------------------------------------
-- 3. Comprovantes e fila de arquivos
-- -----------------------------------------------------------------------------
create table public.data_erasure_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity text not null check (entity in ('lead', 'client', 'property')),
  record_id uuid not null,
  reason text not null check (reason in ('subject_request', 'manual', 'trash_expired', 'hold_expired')),
  outcome text not null check (outcome in ('deleted', 'anonymized', 'identification_removed')),
  legal_holds text[] not null default '{}',
  identification_kept_until date,
  files_queued integer not null default 0 check (files_queued >= 0),
  executed_by uuid,
  executed_at timestamptz not null default now()
);

create index data_erasure_receipts_organization_idx
  on public.data_erasure_receipts (organization_id, executed_at desc);

comment on table public.data_erasure_receipts is
  'Comprovante de exclusão definitiva ou anonimização, SEM dado pessoal: tipo e id do registro, motivo (subject_request = pedido do titular, LGPD art. 18; manual; trash_expired = 30 dias na lixeira; hold_expired = fim da guarda), resultado, guardas legais, quem executou (null = rotina) e quando. Gravado só pelas funções da lixeira; dono e gerente leem.';

alter table public.data_erasure_receipts enable row level security;

create policy "data_erasure_receipts: dono e gerente leem" on public.data_erasure_receipts
  for select to authenticated
  using (private.has_role(organization_id, '{owner,manager}'::public.app_role[]));

revoke all on public.data_erasure_receipts from anon, authenticated;
grant select on public.data_erasure_receipts to authenticated;

create table private.storage_purge_queue (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  bucket_id text not null check (bucket_id in ('client-documents', 'property-media', 'property-documents')),
  object_path text not null check (char_length(object_path) between 1 and 1024),
  queued_at timestamptz not null default now(),
  constraint storage_purge_queue_object_key unique (bucket_id, object_path)
);

create index storage_purge_queue_organization_idx
  on private.storage_purge_queue (organization_id, queued_at);

comment on table private.storage_purge_queue is
  'Arquivos do Storage de registros já apagados/anonimizados. O banco não apaga arquivo (storage.protect_delete): o servidor lê a fila (list_storage_purge_queue), remove pela Storage API com a sessão de dono/gerente e baixa a fila (settle_storage_purge_queue).';

alter table private.storage_purge_queue enable row level security;

create policy "storage_purge_queue: sem acesso pela API" on private.storage_purge_queue
  as restrictive for all to anon, authenticated using (false) with check (false);

comment on policy "storage_purge_queue: sem acesso pela API" on private.storage_purge_queue is
  'Negação explícita (RESTRICTIVE): tabela interna, lida e gravada só por funções security definer e rotinas agendadas. Nunca crie política permissiva nem grant para anon/authenticated aqui.';

revoke all on private.storage_purge_queue from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Funções internas
-- -----------------------------------------------------------------------------
create or replace function private.trash_record(p_entity text, p_record_id uuid)
returns table (
  organization_id uuid,
  label text,
  code text,
  deleted_at timestamptz,
  anonymized_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.organization_id, l.name, null::text, l.deleted_at, null::timestamptz
  from public.leads l
  where p_entity = 'lead' and l.id = p_record_id
  union all
  select c.organization_id, c.name, null::text, c.deleted_at, c.anonymized_at
  from public.clients c
  where p_entity = 'client' and c.id = p_record_id
  union all
  select p.organization_id, p.title, p.code, p.deleted_at, p.anonymized_at
  from public.properties p
  where p_entity = 'property' and p.id = p_record_id;
$$;

comment on function private.trash_record(text, uuid) is
  'Estado de um lead/cliente/imóvel para as RPCs da lixeira: imobiliária, nome ou título, código (imóvel), deleted_at e anonymized_at.';

create or replace function private.trash_require_manager(p_organization_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null
     or not private.has_role(p_organization_id, '{owner,manager}'::public.app_role[]) then
    raise exception 'Só o dono e o gerente podem fazer isso.' using errcode = '42501';
  end if;
end;
$$;

comment on function private.trash_require_manager(uuid) is
  'Recusa (42501) quem não é dono ou gerente ativo. Registro inexistente cai na mesma recusa (não revela se existe).';

create or replace function private.trash_confirmation_matches(p_typed text, p_label text, p_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    btrim(p_typed) <> ''
    and lower(regexp_replace(btrim(p_typed), '\s+', ' ', 'g')) in (
      lower(regexp_replace(btrim(coalesce(p_label, '')), '\s+', ' ', 'g')),
      lower(coalesce(p_code, ''))
    ),
    false
  );
$$;

comment on function private.trash_confirmation_matches(text, text, text) is
  'Confirmação digitada: igual ao nome/título (sem diferença de maiúsculas e espaços) ou ao código do imóvel.';

create or replace function private.record_legal_holds(p_entity text, p_record_id uuid)
returns table (holds text[], concluded_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_holds text[] := '{}';
  v_concluded timestamptz;
  v_when timestamptz;
begin
  select r.organization_id into v_org from private.trash_record(p_entity, p_record_id) r;

  if v_org is null or p_entity = 'lead' then
    holds := v_holds;
    concluded_at := null;
    return next;
    return;
  end if;

  if p_entity = 'client' then
    select max(coalesce(pr.decided_at, pr.updated_at)) into v_when
    from public.proposals pr
    where pr.organization_id = v_org and pr.client_id = p_record_id and pr.status = 'accepted';
    if v_when is not null then
      v_holds := v_holds || 'proposta_aceita'::text;
      v_concluded := greatest(v_concluded, v_when);
    end if;

    select max(coalesce(cm.closed_at, cm.created_at)) into v_when
    from public.commissions cm
    where cm.organization_id = v_org and cm.client_id = p_record_id;
    if v_when is not null then
      v_holds := v_holds || 'comissao'::text;
      v_concluded := greatest(v_concluded, v_when);
    end if;

    select max(x.at) into v_when
    from (
      select coalesce(pr.decided_at, pr.updated_at) as at
      from public.property_owners po
      join public.proposals pr
        on pr.organization_id = po.organization_id
       and pr.property_id = po.property_id
       and pr.status = 'accepted'
      where po.organization_id = v_org and po.client_id = p_record_id
      union all
      select coalesce(cm.closed_at, cm.created_at)
      from public.property_owners po
      join public.commissions cm
        on cm.organization_id = po.organization_id and cm.property_id = po.property_id
      where po.organization_id = v_org and po.client_id = p_record_id
    ) x;
    if v_when is not null then
      v_holds := v_holds || 'negocio_do_imovel'::text;
      v_concluded := greatest(v_concluded, v_when);
    end if;

    if exists (
      select 1 from public.listing_authorizations la
      where la.organization_id = v_org and la.owner_client_id = p_record_id and la.signed_at is not null
    ) then
      v_holds := v_holds || 'autorizacao_assinada'::text;
    end if;
  else
    select max(coalesce(pr.decided_at, pr.updated_at)) into v_when
    from public.proposals pr
    where pr.organization_id = v_org and pr.property_id = p_record_id and pr.status = 'accepted';
    if v_when is not null then
      v_holds := v_holds || 'proposta_aceita'::text;
      v_concluded := greatest(v_concluded, v_when);
    end if;

    select max(coalesce(cm.closed_at, cm.created_at)) into v_when
    from public.commissions cm
    where cm.organization_id = v_org and cm.property_id = p_record_id;
    if v_when is not null then
      v_holds := v_holds || 'comissao'::text;
      v_concluded := greatest(v_concluded, v_when);
    end if;

    if exists (
      select 1 from public.listing_authorizations la
      where la.organization_id = v_org and la.property_id = p_record_id and la.signed_at is not null
    ) then
      v_holds := v_holds || 'autorizacao_assinada'::text;
    end if;

    if exists (
      select 1 from public.property_documents d
      where d.organization_id = v_org and d.property_id = p_record_id
    ) then
      v_holds := v_holds || 'documento_dossie'::text;
    end if;
  end if;

  holds := v_holds;
  concluded_at := v_concluded;
  return next;
end;
$$;

comment on function private.record_legal_holds(text, uuid) is
  'Guardas legais de um cliente ou imóvel (lead não tem): proposta_aceita, comissao, negocio_do_imovel (cliente proprietário de imóvel com proposta aceita/comissão), autorizacao_assinada e documento_dossie. concluded_at = conclusão mais recente de transação (início dos 5 anos da Lei 9.613/1998, art. 10, § 2º).';

create or replace function private.property_photo_thumb_path(p_path text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_path is null or p_path like '%\_\_thumb.webp' then null
    else left(p_path, length(p_path) - length(f.name))
      || case
        when strpos(reverse(f.name), '.') > 0 and strpos(reverse(f.name), '.') < length(f.name)
          then left(f.name, length(f.name) - strpos(reverse(f.name), '.'))
        else f.name
      end
      || '__thumb.webp'
  end
  from (select substring(p_path from '[^/]*$') as name) f;
$$;

comment on function private.property_photo_thumb_path(text) is
  'Miniatura {nome}__thumb.webp de uma foto de property-media (mesma regra de thumbPathFor em packages/core/src/media/paths.ts).';

create or replace function private.enqueue_record_files(
  p_entity text,
  p_organization_id uuid,
  p_record_id uuid,
  p_include_documents boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with paths as (
    select 'client-documents'::text as bucket_id, d.storage_path as object_path
    from public.client_documents d
    where p_entity = 'client' and p_include_documents
      and d.organization_id = p_organization_id and d.client_id = p_record_id
    union all
    select 'property-media', m.storage_path
    from public.property_media m
    where p_entity = 'property'
      and m.organization_id = p_organization_id and m.property_id = p_record_id
    union all
    select 'property-media', private.property_photo_thumb_path(m.storage_path)
    from public.property_media m
    where p_entity = 'property'
      and m.organization_id = p_organization_id and m.property_id = p_record_id
    union all
    select 'property-documents', d.storage_path
    from public.property_documents d
    where p_entity = 'property' and p_include_documents
      and d.organization_id = p_organization_id and d.property_id = p_record_id
  ), inserted as (
    insert into private.storage_purge_queue (organization_id, bucket_id, object_path)
    select distinct p_organization_id, x.bucket_id, x.object_path
    from paths x
    where x.object_path is not null and x.object_path <> ''
    on conflict (bucket_id, object_path) do nothing
    returning 1
  )
  select count(*)::integer into v_count from inserted;

  return v_count;
end;
$$;

comment on function private.enqueue_record_files(text, uuid, uuid, boolean) is
  'Põe na fila de remoção do Storage os arquivos do registro: documentos do cliente; fotos (+ miniatura) e, com p_include_documents, dossiê do imóvel. Devolve quantos entraram.';

create or replace function private.trash_audit(
  p_organization_id uuid,
  p_action text,
  p_entity text,
  p_record_id uuid,
  p_metadata jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events (organization_id, actor_id, action, entity, entity_id, metadata)
  values (
    p_organization_id,
    (select auth.uid()),
    p_action,
    case p_entity when 'lead' then 'leads' when 'client' then 'clients' else 'properties' end,
    p_record_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
$$;

comment on function private.trash_audit(uuid, text, text, uuid, jsonb) is
  'Evento em audit_events das ações da lixeira (trash, restore, purge, anonymize, subject_request). Metadados sem dado pessoal.';

create or replace function private.purge_record(p_entity text, p_record_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_files integer;
begin
  select r.organization_id into v_org from private.trash_record(p_entity, p_record_id) r;

  if v_org is null then
    return 0;
  end if;

  v_files := private.enqueue_record_files(p_entity, v_org, p_record_id, true);

  if p_entity = 'lead' then
    delete from public.leads l where l.id = p_record_id;
  elsif p_entity = 'client' then
    delete from public.clients c where c.id = p_record_id;
  else
    delete from public.properties p where p.id = p_record_id;
  end if;

  insert into public.data_erasure_receipts (
    organization_id, entity, record_id, reason, outcome, files_queued, executed_by
  )
  values (v_org, p_entity, p_record_id, p_reason, 'deleted', v_files, (select auth.uid()));

  perform private.trash_audit(
    v_org, 'purge', p_entity, p_record_id,
    jsonb_build_object('reason', p_reason, 'files_queued', v_files)
  );

  return v_files;
end;
$$;

comment on function private.purge_record(text, uuid, text) is
  'Apaga de vez (cascata do banco), põe os arquivos na fila do Storage, grava comprovante e auditoria. Não confere papel nem guarda: quem chama confere.';

create or replace function private.anonymize_client(
  p_client_id uuid,
  p_reason text,
  p_holds text[],
  p_concluded_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_keep boolean := coalesce(p_holds && array['proposta_aceita', 'comissao', 'negocio_do_imovel'], false);
  v_until date;
  v_files integer := 0;
  v_actor uuid := (select auth.uid());
begin
  select c.organization_id into v_org from public.clients c where c.id = p_client_id for update;

  if v_org is null then
    return null;
  end if;

  if v_keep then
    v_until := (coalesce(p_concluded_at, now()) + interval '5 years')::date;
  else
    v_files := private.enqueue_record_files('client', v_org, p_client_id, true);
    delete from public.client_documents d where d.organization_id = v_org and d.client_id = p_client_id;
  end if;

  delete from public.client_interests i where i.organization_id = v_org and i.client_id = p_client_id;
  delete from public.client_shares s where s.organization_id = v_org and s.client_id = p_client_id;
  delete from public.activities a where a.organization_id = v_org and a.client_id = p_client_id;

  update public.clients c
  set name = case when v_keep then c.name else 'Titular anonimizado' end,
      trade_name = case when c.kind = 'pj' then c.trade_name end,
      document = case when v_keep then c.document end,
      rg = null,
      birth_date = null,
      email = null,
      phone = null,
      whatsapp = null,
      postal_code = null,
      street = null,
      street_number = null,
      complement = null,
      neighborhood = null,
      city = null,
      state = null,
      notes = null,
      tags = '{}',
      identification_kept_until = v_until,
      anonymized_at = now(),
      deleted_at = coalesce(c.deleted_at, now()),
      deleted_by = coalesce(c.deleted_by, v_actor)
  where c.id = p_client_id;

  insert into public.data_erasure_receipts (
    organization_id, entity, record_id, reason, outcome, legal_holds,
    identification_kept_until, files_queued, executed_by
  )
  values (v_org, 'client', p_client_id, p_reason, 'anonymized', coalesce(p_holds, '{}'), v_until, v_files, v_actor);

  perform private.trash_audit(
    v_org, 'anonymize', 'client', p_client_id,
    jsonb_build_object('reason', p_reason, 'legal_holds', to_jsonb(coalesce(p_holds, '{}')), 'files_queued', v_files)
  );

  return jsonb_build_object(
    'outcome', 'anonymized',
    'legal_holds', to_jsonb(coalesce(p_holds, '{}')),
    'identification_kept_until', v_until,
    'files_queued', v_files
  );
end;
$$;

comment on function private.anonymize_client(uuid, text, text[], timestamptz) is
  'Anonimiza cliente com guarda legal (ver comentário da migração 4). Mantém nome, CPF/CNPJ e documentos só com transação, até 5 anos da conclusão. Não confere papel: quem chama confere.';

create or replace function private.anonymize_property(p_property_id uuid, p_reason text, p_holds text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_keep boolean := coalesce(p_holds && array['proposta_aceita', 'comissao'], false);
  v_files integer;
  v_actor uuid := (select auth.uid());
begin
  select p.organization_id into v_org from public.properties p where p.id = p_property_id for update;

  if v_org is null then
    return null;
  end if;

  v_files := private.enqueue_record_files('property', v_org, p_property_id, false);
  delete from public.property_media m where m.organization_id = v_org and m.property_id = p_property_id;

  update public.properties p
  set description = null,
      street = case when v_keep then p.street end,
      street_number = case when v_keep then p.street_number end,
      complement = case when v_keep then p.complement end,
      latitude = case when v_keep then p.latitude end,
      longitude = case when v_keep then p.longitude end,
      published_to_portals = false,
      anonymized_at = now(),
      deleted_at = coalesce(p.deleted_at, now()),
      deleted_by = coalesce(p.deleted_by, v_actor)
  where p.id = p_property_id;

  insert into public.data_erasure_receipts (
    organization_id, entity, record_id, reason, outcome, legal_holds, files_queued, executed_by
  )
  values (v_org, 'property', p_property_id, p_reason, 'anonymized', coalesce(p_holds, '{}'), v_files, v_actor);

  perform private.trash_audit(
    v_org, 'anonymize', 'property', p_property_id,
    jsonb_build_object('reason', p_reason, 'legal_holds', to_jsonb(coalesce(p_holds, '{}')), 'files_queued', v_files)
  );

  return jsonb_build_object(
    'outcome', 'anonymized',
    'legal_holds', to_jsonb(coalesce(p_holds, '{}')),
    'files_queued', v_files
  );
end;
$$;

comment on function private.anonymize_property(uuid, text, text[]) is
  'Imóvel com guarda legal: apaga fotos/vídeo/tour (arquivos na fila), descrição e, sem transação, rua, número, complemento e coordenadas; tira dos portais. Dossiê, propostas e comissões ficam. Não confere papel.';

create or replace function private.erase_client_for_subject(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_lead record;
  v_holds text[];
  v_concluded timestamptz;
  v_result jsonb;
  v_files integer;
  v_actor uuid := (select auth.uid());
  v_actor_name text;
  v_labels text;
begin
  select c.organization_id into v_org from public.clients c where c.id = p_client_id;

  if v_org is null then
    return null;
  end if;

  -- Conversas de WhatsApp e leads da mesma pessoa saem junto (sem guarda legal).
  delete from public.whatsapp_conversations w where w.organization_id = v_org and w.client_id = p_client_id;

  for v_lead in
    select l.id from public.leads l where l.organization_id = v_org and l.client_id = p_client_id
  loop
    delete from public.whatsapp_conversations w where w.organization_id = v_org and w.lead_id = v_lead.id;
    perform private.purge_record('lead', v_lead.id, 'subject_request');
  end loop;

  select h.holds, h.concluded_at into v_holds, v_concluded
  from private.record_legal_holds('client', p_client_id) h;

  if coalesce(cardinality(v_holds), 0) = 0 then
    v_files := private.purge_record('client', p_client_id, 'subject_request');
    return jsonb_build_object('outcome', 'deleted', 'legal_holds', '[]'::jsonb, 'files_queued', v_files);
  end if;

  v_result := private.anonymize_client(p_client_id, 'subject_request', v_holds, v_concluded);

  select nullif(btrim(pf.full_name), '') into v_actor_name from public.profiles pf where pf.id = v_actor;

  select string_agg(
      case h
        when 'proposta_aceita' then 'proposta aceita'
        when 'comissao' then 'comissão lançada'
        when 'negocio_do_imovel' then 'negócio de imóvel do qual é proprietário'
        when 'autorizacao_assinada' then 'autorização assinada'
        else h
      end,
      ', '
    )
    into v_labels
  from unnest(v_holds) as h;

  insert into public.activities (organization_id, client_id, type, body, occurred_at, created_by)
  values (
    v_org,
    p_client_id,
    'note',
    format(
      'Pedido do titular (LGPD, art. 18) atendido em %s por %s: dados pessoais anonimizados. Mantido por obrigação legal: %s.%s',
      to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI'),
      coalesce(v_actor_name, 'dono ou gerente'),
      v_labels,
      case
        when v_result ->> 'identification_kept_until' is not null then
          format(
            ' Nome e CPF/CNPJ guardados até %s (Lei 9.613/1998, art. 10, § 2º).',
            to_char((v_result ->> 'identification_kept_until')::date, 'DD/MM/YYYY')
          )
        else ''
      end
    ),
    now(),
    v_actor
  );

  return v_result;
end;
$$;

comment on function private.erase_client_for_subject(uuid) is
  'Pedido do titular sobre um cliente: apaga conversas de WhatsApp e leads ligados, e então apaga o cliente (sem guarda) ou anonimiza (com guarda), com nota no histórico. Não confere papel.';

-- -----------------------------------------------------------------------------
-- 5. RPCs (sessão de dono/gerente)
-- -----------------------------------------------------------------------------
create or replace function public.move_to_trash(p_entity text, p_record_id uuid)
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

  if v_record.deleted_at is not null then
    raise exception 'Este registro já está na lixeira.' using errcode = '55000';
  end if;

  if p_entity = 'lead' then
    update public.leads l set deleted_at = now(), deleted_by = (select auth.uid()) where l.id = p_record_id;
  elsif p_entity = 'client' then
    update public.clients c set deleted_at = now(), deleted_by = (select auth.uid()) where c.id = p_record_id;
  else
    update public.properties p set deleted_at = now(), deleted_by = (select auth.uid()) where p.id = p_record_id;
  end if;

  perform private.trash_audit(v_record.organization_id, 'trash', p_entity, p_record_id, '{}'::jsonb);
end;
$$;

comment on function public.move_to_trash(text, uuid) is
  'Excluir (dono/gerente): move lead, cliente ou imóvel para a lixeira por 30 dias. p_entity: lead | client | property.';

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
    update public.properties p set deleted_at = null, deleted_by = null where p.id = p_record_id;
  end if;

  perform private.trash_audit(v_record.organization_id, 'restore', p_entity, p_record_id, '{}'::jsonb);
end;
$$;

comment on function public.restore_from_trash(text, uuid) is
  'Restaurar (dono/gerente): tira da lixeira. Anonimizado não volta.';

create or replace function public.list_trash(p_organization_id uuid)
returns table (
  entity text,
  record_id uuid,
  label text,
  code text,
  deleted_at timestamptz,
  deleted_by_name text,
  purge_after timestamptz,
  anonymized_at timestamptz,
  identification_kept_until date,
  legal_holds text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with itens as (
    select 'lead'::text as entity, l.id, l.name as label, null::text as code, l.deleted_at, l.deleted_by,
      null::timestamptz as anonymized_at, null::date as kept_until
    from public.leads l
    where l.organization_id = p_organization_id and l.deleted_at is not null
    union all
    select 'client', c.id, c.name, null, c.deleted_at, c.deleted_by, c.anonymized_at, c.identification_kept_until
    from public.clients c
    where c.organization_id = p_organization_id and c.deleted_at is not null
    union all
    select 'property', p.id, p.title, p.code, p.deleted_at, p.deleted_by, p.anonymized_at, null
    from public.properties p
    where p.organization_id = p_organization_id and p.deleted_at is not null
  )
  select
    i.entity,
    i.id,
    i.label,
    i.code,
    i.deleted_at,
    nullif(btrim(pf.full_name), ''),
    i.deleted_at + interval '30 days',
    i.anonymized_at,
    i.kept_until,
    h.holds
  from itens i
  left join public.profiles pf on pf.id = i.deleted_by
  cross join lateral private.record_legal_holds(i.entity, i.id) h
  where private.has_role(p_organization_id, '{owner,manager}'::public.app_role[])
  order by i.anonymized_at is not null, i.deleted_at desc
  limit 500;
$$;

comment on function public.list_trash(uuid) is
  'Lixeira (dono/gerente): leads, clientes e imóveis excluídos, com quem excluiu, data de exclusão definitiva (30 dias) e guardas legais. Anonimizados vêm por último. Outros papéis recebem lista vazia.';

create or replace function public.purge_from_trash(p_entity text, p_record_id uuid, p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record record;
  v_holds text[];
  v_files integer;
begin
  select * into v_record from private.trash_record(p_entity, p_record_id);
  perform private.trash_require_manager(v_record.organization_id);

  if v_record.deleted_at is null or v_record.anonymized_at is not null then
    raise exception 'Este registro não está na lixeira.' using errcode = '55000';
  end if;

  if not private.trash_confirmation_matches(p_confirmation, v_record.label, v_record.code) then
    raise exception 'Digite o nome exatamente como aparece para confirmar.' using errcode = '22023';
  end if;

  select h.holds into v_holds from private.record_legal_holds(p_entity, p_record_id) h;

  if coalesce(cardinality(v_holds), 0) > 0 then
    raise exception 'Este registro tem guarda legal e não pode ser apagado por inteiro.'
      using errcode = 'P0001', hint = 'guarda_legal', detail = array_to_string(v_holds, ',');
  end if;

  v_files := private.purge_record(p_entity, p_record_id, 'manual');

  return jsonb_build_object('outcome', 'deleted', 'files_queued', v_files);
end;
$$;

comment on function public.purge_from_trash(text, uuid, text) is
  'Excluir permanentemente (dono/gerente), só o que está na lixeira e sem guarda legal; p_confirmation = nome/título (ou código do imóvel). Guarda legal: P0001 com hint guarda_legal e detail = guardas.';

create or replace function public.anonymize_from_trash(p_entity text, p_record_id uuid, p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record record;
  v_holds text[];
  v_concluded timestamptz;
begin
  if p_entity is distinct from 'client' and p_entity is distinct from 'property' then
    raise exception 'Só clientes e imóveis têm guarda legal.' using errcode = '22023';
  end if;

  select * into v_record from private.trash_record(p_entity, p_record_id);
  perform private.trash_require_manager(v_record.organization_id);

  if v_record.deleted_at is null or v_record.anonymized_at is not null then
    raise exception 'Este registro não está na lixeira.' using errcode = '55000';
  end if;

  if not private.trash_confirmation_matches(p_confirmation, v_record.label, v_record.code) then
    raise exception 'Digite o nome exatamente como aparece para confirmar.' using errcode = '22023';
  end if;

  select h.holds, h.concluded_at into v_holds, v_concluded
  from private.record_legal_holds(p_entity, p_record_id) h;

  if coalesce(cardinality(v_holds), 0) = 0 then
    raise exception 'Este registro não tem guarda legal: use Excluir permanentemente.' using errcode = '55000';
  end if;

  if p_entity = 'client' then
    return private.anonymize_client(p_record_id, 'manual', v_holds, v_concluded);
  end if;

  return private.anonymize_property(p_record_id, 'manual', v_holds);
end;
$$;

comment on function public.anonymize_from_trash(text, uuid, text) is
  'Anonimizar dados pessoais (dono/gerente) de cliente ou imóvel da lixeira com guarda legal; p_confirmation = nome/título (ou código).';

create or replace function public.erase_subject_data(p_entity text, p_record_id uuid, p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record record;
  v_client_id uuid;
  v_result jsonb;
begin
  if p_entity is distinct from 'lead' and p_entity is distinct from 'client' then
    raise exception 'O pedido do titular vale para leads e clientes.' using errcode = '22023';
  end if;

  select * into v_record from private.trash_record(p_entity, p_record_id);
  perform private.trash_require_manager(v_record.organization_id);

  if v_record.anonymized_at is not null then
    raise exception 'Os dados deste titular já foram anonimizados.' using errcode = '55000';
  end if;

  if not private.trash_confirmation_matches(p_confirmation, v_record.label, null) then
    raise exception 'Digite o nome exatamente como aparece para confirmar.' using errcode = '22023';
  end if;

  if p_entity = 'client' then
    v_result := private.erase_client_for_subject(p_record_id);
  else
    select l.client_id into v_client_id from public.leads l where l.id = p_record_id;

    delete from public.whatsapp_conversations w
    where w.organization_id = v_record.organization_id and w.lead_id = p_record_id;

    v_result := jsonb_build_object(
      'outcome', 'deleted',
      'legal_holds', '[]'::jsonb,
      'files_queued', private.purge_record('lead', p_record_id, 'subject_request')
    );

    if v_client_id is not null and exists (
      select 1 from public.clients c where c.id = v_client_id and c.anonymized_at is null
    ) then
      v_result := v_result || jsonb_build_object('linked_client', private.erase_client_for_subject(v_client_id));
    end if;
  end if;

  perform private.trash_audit(
    v_record.organization_id, 'subject_request', p_entity, p_record_id,
    jsonb_build_object('outcome', v_result ->> 'outcome')
  );

  return v_result;
end;
$$;

comment on function public.erase_subject_data(text, uuid, text) is
  'Excluir dados a pedido do titular (LGPD art. 18; dono/gerente): lead ou cliente, dentro ou fora da lixeira. Sem guarda legal apaga na hora; com guarda anonimiza. Lead leva junto o cliente vinculado. Comprovante em data_erasure_receipts.';

create or replace function public.list_storage_purge_queue(p_organization_id uuid, p_limit integer)
returns table (bucket_id text, object_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select q.bucket_id, q.object_path
  from private.storage_purge_queue q
  where q.organization_id = p_organization_id
    and private.has_role(p_organization_id, '{owner,manager}'::public.app_role[])
  order by q.queued_at, q.id
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;

comment on function public.list_storage_purge_queue(uuid, integer) is
  'Arquivos a remover do Storage (dono/gerente da imobiliária). O servidor remove pela Storage API e chama settle_storage_purge_queue.';

create or replace function public.settle_storage_purge_queue(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.trash_require_manager(p_organization_id);

  delete from private.storage_purge_queue q
  where q.organization_id = p_organization_id
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = q.bucket_id and o.name = q.object_path
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.settle_storage_purge_queue(uuid) is
  'Baixa da fila os arquivos que já não existem no Storage (dono/gerente). Devolve quantos saíram.';

create or replace function private.storage_object_queued_for_purge(p_bucket_id text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.storage_purge_queue q
    where q.bucket_id = p_bucket_id
      and q.object_path = p_name
      and q.organization_id = private.try_uuid(split_part(p_name, '/', 1))
  );
$$;

comment on function private.storage_object_queued_for_purge(text, text) is
  'Política de Storage da lixeira: o objeto está na fila de remoção da própria imobiliária (primeira pasta).';

-- -----------------------------------------------------------------------------
-- 6. Storage: dono e gerente removem só o que está na fila
-- -----------------------------------------------------------------------------
create policy "lixeira: dono e gerente leem arquivos na fila de remoção" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('client-documents', 'property-media', 'property-documents')
    and private.has_role(private.try_uuid((storage.foldername(name))[1]), '{owner,manager}'::public.app_role[])
    and private.storage_object_queued_for_purge(bucket_id, name)
  );

create policy "lixeira: dono e gerente removem arquivos na fila de remoção" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('client-documents', 'property-media', 'property-documents')
    and private.has_role(private.try_uuid((storage.foldername(name))[1]), '{owner,manager}'::public.app_role[])
    and private.storage_object_queued_for_purge(bucket_id, name)
  );

-- -----------------------------------------------------------------------------
-- 7. Rotina diária
-- -----------------------------------------------------------------------------
create or replace function private.purge_expired_trash(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_holds text[];
  v_concluded timestamptz;
  v_files integer;
  v_deleted integer := 0;
  v_anonymized integer := 0;
  v_identification integer := 0;
  v_failed integer := 0;
  v_limit constant integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
begin
  for v_item in
    select x.entity, x.id
    from (
      select 'lead'::text as entity, l.id, l.deleted_at
      from public.leads l
      where l.deleted_at < now() - interval '30 days'
      union all
      select 'client', c.id, c.deleted_at
      from public.clients c
      where c.deleted_at < now() - interval '30 days' and c.anonymized_at is null
      union all
      select 'property', p.id, p.deleted_at
      from public.properties p
      where p.deleted_at < now() - interval '30 days' and p.anonymized_at is null
    ) x
    order by x.deleted_at
    limit v_limit
  loop
    begin
      select h.holds, h.concluded_at into v_holds, v_concluded
      from private.record_legal_holds(v_item.entity, v_item.id) h;

      if coalesce(cardinality(v_holds), 0) = 0 then
        perform private.purge_record(v_item.entity, v_item.id, 'trash_expired');
        v_deleted := v_deleted + 1;
      elsif v_item.entity = 'client' then
        perform private.anonymize_client(v_item.id, 'trash_expired', v_holds, v_concluded);
        v_anonymized := v_anonymized + 1;
      else
        perform private.anonymize_property(v_item.id, 'trash_expired', v_holds);
        v_anonymized := v_anonymized + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  for v_item in
    select c.id, c.organization_id
    from public.clients c
    where c.anonymized_at is not null
      and c.identification_kept_until < current_date
    order by c.identification_kept_until
    limit v_limit
  loop
    begin
      v_files := private.enqueue_record_files('client', v_item.organization_id, v_item.id, true);
      delete from public.client_documents d
      where d.organization_id = v_item.organization_id and d.client_id = v_item.id;

      update public.clients c
      set name = 'Titular anonimizado', document = null, identification_kept_until = null
      where c.id = v_item.id;

      update public.commissions cm
      set client_name = 'Titular anonimizado'
      where cm.organization_id = v_item.organization_id and cm.client_id = v_item.id;

      insert into public.data_erasure_receipts (
        organization_id, entity, record_id, reason, outcome, files_queued
      )
      values (v_item.organization_id, 'client', v_item.id, 'hold_expired', 'identification_removed', v_files);

      perform private.trash_audit(
        v_item.organization_id, 'anonymize', 'client', v_item.id,
        jsonb_build_object('reason', 'hold_expired', 'files_queued', v_files)
      );
      v_identification := v_identification + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object(
    'deleted', v_deleted,
    'anonymized', v_anonymized,
    'identification_removed', v_identification,
    'failed', v_failed
  );
end;
$$;

comment on function private.purge_expired_trash(integer) is
  'Rotina agendada (pg_cron, job lixeira-expurgo-diario, 06:23 UTC): o que está há mais de 30 dias na lixeira é apagado de vez (sem guarda) ou anonimizado (com guarda); cliente cuja guarda de identificação venceu perde nome, CPF/CNPJ e documentos. Até p_limit registros por etapa; falha de um registro não para os outros. Arquivos vão para a fila do Storage.';

select cron.schedule(
  'lixeira-expurgo-diario',
  '23 6 * * *',
  $cron$ select private.purge_expired_trash(); $cron$
);

-- -----------------------------------------------------------------------------
-- 8. Funções que ignoram RLS passam a filtrar a lixeira
-- -----------------------------------------------------------------------------
-- Troca de trecho exato na definição atual (pg_get_functiondef), para não
-- sobrescrever mudanças recentes de outras migrações. Falha se o trecho sumir.
do $patch$
declare
  v_patch record;
  v_def text;
begin
  for v_patch in
    select t.fn, t.from_text, t.to_text
    from (
      values
        (1, 'public.get_public_property(text, text)',
          'and not p.is_restricted', 'and not p.is_restricted and p.deleted_at is null'),
        (2, 'public.get_public_sitemap(text)',
          'and not p.is_restricted', 'and not p.is_restricted and p.deleted_at is null'),
        (3, 'public.get_portal_feed(text, text)',
          'and not p.is_restricted', 'and not p.is_restricted and p.deleted_at is null'),
        (4, 'public.get_public_landing_page(text, text)',
          'and not p.is_restricted', 'and not p.is_restricted and p.deleted_at is null'),
        (5, 'public.submit_property_lead(text, text, jsonb, text, text, text)',
          'and not p.is_restricted', 'and not p.is_restricted and p.deleted_at is null'),
        (6, 'private.report_broker_performance(uuid, timestamptz, timestamptz, uuid, uuid)',
          'where l.organization_id = p_organization_id',
          'where l.organization_id = p_organization_id and l.deleted_at is null'),
        (7, 'private.report_broker_performance(uuid, timestamptz, timestamptz, uuid, uuid)',
          'on l.organization_id = ev.organization_id and l.id = ev.lead_id',
          'on l.organization_id = ev.organization_id and l.id = ev.lead_id and l.deleted_at is null'),
        (8, 'private.report_broker_performance(uuid, timestamptz, timestamptz, uuid, uuid)',
          'and p.captured_by = e.user_id', 'and p.captured_by = e.user_id and p.deleted_at is null'),
        (9, 'private.report_lead_lost_reasons(uuid, timestamptz, timestamptz, uuid, integer, uuid)',
          'on l.organization_id = ev.organization_id and l.id = ev.lead_id',
          'on l.organization_id = ev.organization_id and l.id = ev.lead_id and l.deleted_at is null'),
        (10, 'private.report_stage_funnel(uuid, timestamptz, timestamptz, uuid, uuid)',
          'on l.organization_id = ev.organization_id and l.id = ev.lead_id',
          'on l.organization_id = ev.organization_id and l.id = ev.lead_id and l.deleted_at is null'),
        (11, 'private.report_lead_sources(uuid, timestamptz, timestamptz, uuid, integer, uuid)',
          'where l.organization_id = p_organization_id',
          'where l.organization_id = p_organization_id and l.deleted_at is null'),
        (12, 'private.report_sales_goals(uuid, date, uuid, uuid)',
          'where l.organization_id = p_organization_id',
          'where l.organization_id = p_organization_id and l.deleted_at is null'),
        (13, 'private.daily_digest_content(uuid, uuid, date, integer, integer)',
          'where ld.organization_id = p_organization_id',
          'where ld.organization_id = p_organization_id and ld.deleted_at is null'),
        (14, 'private.daily_digest_content(uuid, uuid, date, integer, integer)',
          'and c.assigned_to = p_user_id', 'and c.assigned_to = p_user_id and c.deleted_at is null'),
        (15, 'private.run_lead_routing_pass(integer)',
          'join public.lead_routing_settings s on s.organization_id = l.organization_id',
          'join public.lead_routing_settings s on s.organization_id = l.organization_id and l.deleted_at is null'),
        (16, 'public.claim_lead_notifications(text, integer)',
          'join public.leads l on l.id = r.lead_id',
          'join public.leads l on l.id = r.lead_id and l.deleted_at is null'),
        (17, 'private.audit_row_change()',
          '-- Funil (kanban): só a ordem do card mudou.',
          E'-- Lixeira: mover e restaurar gravam o próprio evento (trash/restore).\n    if v_changed <@ array[''deleted_at'', ''deleted_by'']::text[] then\n      return null;\n    end if;\n\n    -- Funil (kanban): só a ordem do card mudou.')
    ) as t(ord, fn, from_text, to_text)
    order by t.ord
  loop
    v_def := pg_get_functiondef(v_patch.fn::regprocedure);

    if strpos(v_def, v_patch.from_text) = 0 then
      raise exception 'Trecho não encontrado em %: %', v_patch.fn, v_patch.from_text;
    end if;

    if strpos(v_def, v_patch.to_text) > 0 then
      raise exception 'Função % já tem o filtro: %', v_patch.fn, v_patch.to_text;
    end if;

    execute replace(v_def, v_patch.from_text, v_patch.to_text);
  end loop;
end
$patch$;

-- -----------------------------------------------------------------------------
-- 9. Privilégios
-- -----------------------------------------------------------------------------
revoke all on function private.trash_record(text, uuid) from public, anon, authenticated;
revoke all on function private.trash_require_manager(uuid) from public, anon, authenticated;
revoke all on function private.trash_confirmation_matches(text, text, text) from public, anon, authenticated;
revoke all on function private.record_legal_holds(text, uuid) from public, anon, authenticated;
revoke all on function private.property_photo_thumb_path(text) from public, anon, authenticated;
revoke all on function private.enqueue_record_files(text, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function private.trash_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.purge_record(text, uuid, text) from public, anon, authenticated;
revoke all on function private.anonymize_client(uuid, text, text[], timestamptz) from public, anon, authenticated;
revoke all on function private.anonymize_property(uuid, text, text[]) from public, anon, authenticated;
revoke all on function private.erase_client_for_subject(uuid) from public, anon, authenticated;
revoke all on function private.purge_expired_trash(integer) from public, anon, authenticated;

revoke all on function private.storage_object_queued_for_purge(text, text) from public, anon;
grant execute on function private.storage_object_queued_for_purge(text, text) to authenticated;

revoke all on function public.move_to_trash(text, uuid) from public, anon;
revoke all on function public.restore_from_trash(text, uuid) from public, anon;
revoke all on function public.list_trash(uuid) from public, anon;
revoke all on function public.purge_from_trash(text, uuid, text) from public, anon;
revoke all on function public.anonymize_from_trash(text, uuid, text) from public, anon;
revoke all on function public.erase_subject_data(text, uuid, text) from public, anon;
revoke all on function public.list_storage_purge_queue(uuid, integer) from public, anon;
revoke all on function public.settle_storage_purge_queue(uuid) from public, anon;

grant execute on function public.move_to_trash(text, uuid) to authenticated;
grant execute on function public.restore_from_trash(text, uuid) to authenticated;
grant execute on function public.list_trash(uuid) to authenticated;
grant execute on function public.purge_from_trash(text, uuid, text) to authenticated;
grant execute on function public.anonymize_from_trash(text, uuid, text) to authenticated;
grant execute on function public.erase_subject_data(text, uuid, text) to authenticated;
grant execute on function public.list_storage_purge_queue(uuid, integer) to authenticated;
grant execute on function public.settle_storage_purge_queue(uuid) to authenticated;
