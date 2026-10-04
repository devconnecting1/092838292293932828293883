-- =============================================================================
-- Dossiê do imóvel: matrícula e documentos com validade em bucket privado
-- =============================================================================
-- Sem matrícula, IPTU, planta, habite-se e certidões à mão, a diligência do
-- comprador atrasa semanas. Esta migração cria:
--
--  1. properties.registry_number: número da matrícula no registro de imóveis.
--  2. property_documents: um documento por linha, com tipo, descrição curta
--     opcional e data de validade (a tela marca "Vencido"). Linhas imutáveis:
--     para trocar um documento, envie outro e remova o antigo.
--  3. Bucket PRIVADO property-documents: PDF, JPG, PNG e WebP até 10 MB.
--     Caminho {organization_id}/properties/{property_id}/{uuid}.{extensão} —
--     o nome do arquivo nunca carrega dado pessoal (nome do proprietário etc.).
--     Download só por URL assinada de curta duração.
--  4. Acesso: lê quem vê o imóvel (inclusive a regra de imóvel restrito);
--     envia e remove quem gerencia o imóvel (dono, gerente, captador e corretor
--     responsável). O download fica registrado em audit_events
--     (log_access_event 'property_documents').

-- -----------------------------------------------------------------------------
-- 1. Número da matrícula
-- -----------------------------------------------------------------------------
alter table public.properties
  add column registry_number text
    constraint properties_registry_number_format check (
      registry_number is null
      or (
        char_length(registry_number) between 1 and 40
        and registry_number = btrim(registry_number)
        and registry_number !~ '[[:cntrl:]]'
      )
    );

comment on column public.properties.registry_number is
  'Número da matrícula do imóvel no cartório de registro de imóveis.';

-- -----------------------------------------------------------------------------
-- 2. property_documents
-- -----------------------------------------------------------------------------
create type public.property_document_kind as enum (
  'registry',
  'iptu',
  'floor_plan',
  'occupancy_permit',
  'certificate',
  'listing_agreement',
  'other'
);

comment on type public.property_document_kind is
  'Tipo de documento do dossiê: matrícula, IPTU, planta, habite-se, certidão, contrato de autorização e outros.';

create table public.property_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  property_id uuid not null,
  kind public.property_document_kind not null,
  description text
    constraint property_documents_description_format check (
      description is null
      or (
        char_length(description) between 1 and 120
        and description = btrim(description)
        and description !~ '[[:cntrl:]]'
      )
    ),
  valid_until date,
  storage_path text not null constraint property_documents_storage_path_key unique,
  mime_type text not null
    constraint property_documents_mime_type check (
      mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    ),
  size_bytes bigint not null
    constraint property_documents_size_bytes check (size_bytes between 1 and 10485760),
  uploaded_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint property_documents_property_fkey foreign key (organization_id, property_id)
    references public.properties (organization_id, id) on delete cascade,
  -- {organization_id}/properties/{property_id}/{uuid}.{extensão do tipo}
  constraint property_documents_storage_path_format check (
    storage_path ~ (
      '^' || organization_id::text || '/properties/' || property_id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.'
      || case mime_type
           when 'application/pdf' then 'pdf'
           when 'image/jpeg' then 'jpg'
           when 'image/png' then 'png'
           when 'image/webp' then 'webp'
         end
      || '$'
    )
  )
);

create index property_documents_organization_property_idx
  on public.property_documents (organization_id, property_id, created_at desc);
create index property_documents_uploaded_by_idx on public.property_documents (uploaded_by);

comment on table public.property_documents is
  'Dossiê do imóvel (matrícula, IPTU, planta, habite-se, certidões, contrato de autorização). Arquivos no bucket privado property-documents, baixados por URL assinada. Sem UPDATE.';
comment on column public.property_documents.valid_until is
  'Validade do documento (certidões, IPTU do ano). Depois dessa data a ficha mostra "Vencido".';
comment on column public.property_documents.description is
  'Descrição curta opcional (ex.: "Certidão de ônus reais"). Não é o nome do arquivo enviado.';

create trigger a0_billing_writable
  before insert on public.property_documents
  for each row execute function private.assert_billing_writable();
create trigger property_documents_enforce_author
  before insert on public.property_documents
  for each row execute function private.enforce_author_column('uploaded_by');
create trigger property_documents_audit
  after insert or delete on public.property_documents
  for each row execute function private.audit_row_change();

-- O arquivo precisa estar no bucket (enviado pelo navegador antes do registro).
create or replace function private.property_document_uploaded(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'property-documents'
      and o.name = p_storage_path
  );
$$;

revoke all on function private.property_document_uploaded(text) from public, anon;
grant execute on function private.property_document_uploaded(text) to authenticated;

alter table public.property_documents enable row level security;

revoke all on public.property_documents from anon;
revoke update, truncate, references, trigger on public.property_documents from authenticated;
grant select, insert, delete on public.property_documents to authenticated;

create policy "property_documents: quem vê o imóvel lê"
  on public.property_documents for select to authenticated
  using (
    private.is_member(organization_id)
    and not (property_id = any ((select private.hidden_property_ids())::uuid[]))
  );

create policy "property_documents: quem gerencia o imóvel envia"
  on public.property_documents for insert to authenticated
  with check (
    private.can_manage_property(property_id)
    and private.property_document_uploaded(storage_path)
  );

create policy "property_documents: quem gerencia o imóvel remove"
  on public.property_documents for delete to authenticated
  using (private.can_manage_property(property_id));

-- -----------------------------------------------------------------------------
-- 3. Bucket privado property-documents
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-documents',
  'property-documents',
  false,
  10 * 1024 * 1024,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Leitura (URL assinada, e o RETURNING do envio): quem vê o imóvel.
create policy "property-documents: quem vê o imóvel lê"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'property-documents'
    and private.storage_can_view_property(storage.foldername(name))
  );

-- Envio: quem gerencia o imóvel, com nome aleatório {uuid}.{extensão}.
create policy "property-documents: quem gerencia o imóvel envia"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'property-documents'
    and private.storage_can_manage_property(storage.foldername(name))
    and private.storage_org_writable(private.try_uuid((storage.foldername(name))[1]))
    and name ~ '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$'
  );

-- Sem UPDATE: documento enviado não é sobrescrito.
create policy "property-documents: quem gerencia o imóvel remove"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'property-documents'
    and private.storage_can_manage_property(storage.foldername(name))
  );

-- -----------------------------------------------------------------------------
-- 4. Registro de acesso: imóvel restrito e download de documento do dossiê
-- -----------------------------------------------------------------------------
create or replace function public.log_access_event(
  p_entity text,
  p_entity_id uuid,
  p_action text default 'view'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_allowed boolean := false;
  v_entity text := p_entity;
begin
  if v_user is null then
    raise exception 'Não autenticado.' using errcode = '42501';
  end if;

  if p_action is null or p_action not in ('view', 'download', 'export', 'print') then
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;

  case p_entity
    when 'clients' then
      select c.organization_id, private.can_access_client(c.id)
        into v_org, v_allowed
      from public.clients c where c.id = p_entity_id;
    when 'client_documents' then
      select d.organization_id, private.can_access_client(d.client_id)
        into v_org, v_allowed
      from public.client_documents d where d.id = p_entity_id;
    when 'properties' then
      select p.organization_id,
             private.can_view_property_row(
               p.organization_id, p.id, p.is_restricted, p.captured_by, p.broker_id
             )
        into v_org, v_allowed
      from public.properties p where p.id = p_entity_id;
    when 'property_documents' then
      select d.organization_id, private.can_view_property(d.property_id)
        into v_org, v_allowed
      from public.property_documents d where d.id = p_entity_id;
    when 'lead', 'leads' then
      v_entity := 'leads';
      select l.organization_id, private.can_access_lead_row(l.organization_id, l.assigned_to, false)
        into v_org, v_allowed
      from public.leads l where l.id = p_entity_id;
    else
      raise exception 'Entidade inválida.' using errcode = '22023';
  end case;

  if v_org is null or not coalesce(v_allowed, false) then
    raise exception 'Registro não encontrado.' using errcode = 'P0002';
  end if;

  insert into public.audit_events (organization_id, actor_id, action, entity, entity_id)
  values (v_org, v_user, p_action, v_entity, p_entity_id);
end;
$$;
