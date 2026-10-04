-- =============================================================================
-- 0900 - Storage: buckets property-media (público) e client-documents (privado)
-- =============================================================================
-- Caminhos:
--   property-media:   {organization_id}/properties/{property_id}/{arquivo}
--   client-documents: {organization_id}/clients/{client_id}/{arquivo}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- Público para leitura: os portais baixam as fotos pelas URLs do feed VRSync.
  -- Imagens jpg/png/webp até 7 MB (limite do VRSync).
  ('property-media', 'property-media', true, 7 * 1024 * 1024,
    array['image/jpeg', 'image/png', 'image/webp']),
  -- Privado: documentos pessoais (RG, CPF, comprovantes). Acesso por URL assinada.
  ('client-documents', 'client-documents', false, 20 * 1024 * 1024,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- Funções auxiliares (recebem storage.foldername(name))
-- -----------------------------------------------------------------------------
create or replace function private.storage_can_edit_property(folders text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    cardinality(folders) = 3
    and folders[2] = 'properties'
    and exists (
      select 1
      from public.properties p
      where p.organization_id = private.try_uuid(folders[1])
        and p.id = private.try_uuid(folders[3])
        and private.can_edit_property_row(p.organization_id, p.captured_by, p.broker_id)
    ),
    false
  );
$$;

create or replace function private.storage_can_access_client(folders text[], for_write boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    cardinality(folders) = 3
    and folders[2] = 'clients'
    and exists (
      select 1
      from public.clients c
      where c.organization_id = private.try_uuid(folders[1])
        and c.id = private.try_uuid(folders[3])
        and private.can_access_client_row(c.organization_id, c.id, c.assigned_to, c.created_by, for_write)
    ),
    false
  );
$$;

revoke all on function private.storage_can_edit_property(text[]) from public;
revoke all on function private.storage_can_access_client(text[], boolean) from public;
grant execute on function private.storage_can_edit_property(text[]) to authenticated;
grant execute on function private.storage_can_access_client(text[], boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- property-media
-- -----------------------------------------------------------------------------
-- Download público é feito pela URL pública do bucket (não passa por RLS).
-- Listagem pela API fica restrita a membros da imobiliária.
create policy "property-media: membros listam"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'property-media'
    and private.is_member(private.try_uuid((storage.foldername(name))[1]))
  );

create policy "property-media: quem edita o imóvel envia"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'property-media'
    and private.is_member(private.try_uuid((storage.foldername(name))[1]))
    and private.storage_can_edit_property(storage.foldername(name))
  );

create policy "property-media: quem edita o imóvel substitui"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'property-media'
    and private.is_member(private.try_uuid((storage.foldername(name))[1]))
    and private.storage_can_edit_property(storage.foldername(name))
  )
  with check (
    bucket_id = 'property-media'
    and private.is_member(private.try_uuid((storage.foldername(name))[1]))
    and private.storage_can_edit_property(storage.foldername(name))
  );

create policy "property-media: quem edita o imóvel remove"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'property-media'
    and private.is_member(private.try_uuid((storage.foldername(name))[1]))
    and private.storage_can_edit_property(storage.foldername(name))
  );

-- -----------------------------------------------------------------------------
-- client-documents
-- -----------------------------------------------------------------------------
create policy "client-documents: quem acessa o cliente lê"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'client-documents'
    and private.is_member(private.try_uuid((storage.foldername(name))[1]))
    and private.storage_can_access_client(storage.foldername(name), false)
  );

create policy "client-documents: quem edita o cliente envia"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'client-documents'
    and private.is_member(private.try_uuid((storage.foldername(name))[1]))
    and private.storage_can_access_client(storage.foldername(name), true)
  );

-- Sem política de UPDATE: documento enviado não é sobrescrito (envie outro).
create policy "client-documents: dono e gerente removem"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[2] = 'clients'
    and private.has_role(private.try_uuid((storage.foldername(name))[1]), '{owner,manager}')
  );
