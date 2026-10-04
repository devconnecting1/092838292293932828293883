-- Cadastro de corretores com Selo Verde: o corretor se cadastra sozinho e o dono só aprova.
-- Aprovação = perfis.creci_ok (já protegido pelas políticas existentes) + status.

alter table public.perfis
  add column if not exists whatsapp text,
  add column if not exists uf text,
  add column if not exists cidade text,
  add column if not exists endereco text,
  add column if not exists slug text,
  add column if not exists foto_path text,
  add column if not exists doc_creci_path text,
  add column if not exists doc_residencia_path text,
  add column if not exists doc_certidao_estadual_path text,
  add column if not exists doc_certidao_federal_path text,
  add column if not exists status text not null default 'pendente',
  add column if not exists motivo text,
  add column if not exists enviado_em timestamptz,
  add column if not exists aprovado_em timestamptz;

do $$ begin
  alter table public.perfis add constraint perfis_status_check check (status in ('pendente', 'aprovado', 'recusado'));
exception when duplicate_object then null; end $$;
create unique index if not exists perfis_slug_unico on public.perfis (slug) where slug is not null;

-- Quem não é admin não aprova a si mesmo nem troca o próprio endereço público depois de aprovado.
create or replace function public.perfis_protege_aprovacao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.sou_admin() then
    if new.status = 'aprovado' and (tg_op = 'INSERT' or old.status is distinct from 'aprovado') then
      new.aprovado_em := now();
      new.creci_ok := true;
    elsif new.status <> 'aprovado' then
      new.creci_ok := false;
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pendente';
    new.creci_ok := false;
    new.aprovado_em := null;
    new.motivo := null;
  else
    new.status := case when old.status = 'recusado' then 'pendente' else old.status end;
    new.creci_ok := old.creci_ok;
    new.aprovado_em := old.aprovado_em;
    new.motivo := old.motivo;
    if old.status = 'aprovado' then new.slug := old.slug; end if;
  end if;
  return new;
end $$;
drop trigger if exists perfis_protege_aprovacao on public.perfis;
create trigger perfis_protege_aprovacao before insert or update on public.perfis
  for each row execute function public.perfis_protege_aprovacao();

-- Arquivos: fotos e logos públicas; documentos do Selo Verde privados.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('corretores-fotos', 'corretores-fotos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp']),
  ('corretores-docs', 'corretores-docs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists corretor_envia_foto on storage.objects;
create policy corretor_envia_foto on storage.objects for insert to authenticated
  with check (bucket_id = 'corretores-fotos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists corretor_troca_foto on storage.objects;
create policy corretor_troca_foto on storage.objects for update to authenticated
  using (bucket_id = 'corretores-fotos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists corretor_envia_doc on storage.objects;
create policy corretor_envia_doc on storage.objects for insert to authenticated
  with check (bucket_id = 'corretores-docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists corretor_le_doc on storage.objects;
create policy corretor_le_doc on storage.objects for select to authenticated
  using (bucket_id = 'corretores-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.sou_admin()));

-- Página pública do corretor: só aprovados e só os dados de vitrine.
create or replace function public.corretor_publico(p_slug text)
returns table (slug text, nome text, creci text, creci_uf text, whatsapp text, cidade text, uf text, foto_path text)
language sql stable security definer set search_path = public as $$
  select slug, nome, creci, creci_uf, whatsapp, cidade, uf, foto_path
  from perfis where slug = p_slug and status = 'aprovado' and creci_ok and perfil in ('corretor', 'investidor')
$$;
revoke all on function public.corretor_publico(text) from public;
grant execute on function public.corretor_publico(text) to anon, authenticated;
