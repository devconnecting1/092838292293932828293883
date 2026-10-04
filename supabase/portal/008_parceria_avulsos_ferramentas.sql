-- Cadastro completo do corretor parceiro, contrato de parceria, imóveis avulsos (do proprietário),
-- leitura de certidões e consulta por CPF/CNPJ.
-- Depende de 003, 006 e 007.

-- 1. Perfis: dados do parceiro --------------------------------------------------------------
alter table public.perfis
  add column if not exists redes jsonb not null default '{}'::jsonb,
  add column if not exists recado_1 text,
  add column if not exists recado_2 text,
  add column if not exists pix_chave text,
  add column if not exists banco jsonb not null default '{}'::jsonb,
  add column if not exists doc_creci_frente_path text,
  add column if not exists doc_creci_verso_path text,
  add column if not exists doc_certidao_creci_path text,
  add column if not exists doc_print_creci_path text,
  add column if not exists parceria_versao text,
  add column if not exists parceria_aceite_em timestamptz,
  add column if not exists parceria_aceite_ip text;

-- O corretor aprovado precisa conseguir editar o próprio cadastro (PIX, redes, bairros).
-- A proteção de creci_ok, status e plano fica nos gatilhos perfis_protege_aprovacao e
-- perfis_protege_plano; aqui só se limita o tipo de perfil.
drop policy if exists perfis_edita on public.perfis;
create policy perfis_edita on public.perfis for update to authenticated
  using (user_id = auth.uid() or public.sou_admin())
  with check (public.sou_admin() or (user_id = auth.uid()
    and perfil in ('investidor', 'comprador', 'corretor', 'proprietario')));
drop policy if exists perfis_cria on public.perfis;
create policy perfis_cria on public.perfis for insert to authenticated
  with check (user_id = auth.uid() and perfil in ('investidor', 'comprador', 'corretor', 'proprietario')
    and creci_ok = false);

-- Ninguém se promove a admin nem troca de perfil depois de aprovado.
create or replace function public.perfis_protege_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.sou_admin() then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'aprovado' then new.perfil := old.perfil; end if;
  if new.perfil = 'admin' then raise exception 'perfil nao permitido'; end if;
  return new;
end $$;
drop trigger if exists perfis_protege_perfil on public.perfis;
create trigger perfis_protege_perfil before insert or update on public.perfis
  for each row execute function public.perfis_protege_perfil();

-- Página pública do corretor passa a mostrar as redes profissionais.
drop function if exists public.corretor_publico(text);
create or replace function public.corretor_publico(p_slug text)
returns table (slug text, nome text, creci text, creci_uf text, whatsapp text, cidade text, uf text,
               foto_path text, perfil text, redes jsonb)
language sql stable security definer set search_path = public as $$
  select slug, nome, creci, creci_uf, whatsapp, cidade, uf, foto_path, perfil, redes
  from perfis where slug = p_slug and status = 'aprovado' and creci_ok and perfil in ('corretor', 'investidor')
$$;
revoke all on function public.corretor_publico(text) from public;
grant execute on function public.corretor_publico(text) to anon, authenticated;

create or replace function public.sou_corretor_aprovado() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from perfis where user_id = auth.uid() and perfil = 'corretor'
                and status = 'aprovado' and creci_ok)
$$;

-- 2. Configuração geral (valores editáveis pelo admin) -----------------------------------------
create table if not exists public.config_portal (
  chave text primary key,
  valor jsonb not null,
  atualizado timestamptz not null default now()
);
alter table public.config_portal enable row level security;
drop policy if exists config_portal_le on public.config_portal;
create policy config_portal_le on public.config_portal for select using (true);
drop policy if exists config_portal_admin on public.config_portal;
create policy config_portal_admin on public.config_portal for all to authenticated
  using (public.sou_admin()) with check (public.sou_admin());
insert into public.config_portal (chave, valor) values
  ('comissao_avulso', '{"total": 6, "plataforma": 2, "corretor": 4}'),
  ('parceria_leilao', '{"corretor_com_documentacao": 40, "corretor_sem_documentacao": 20, "indicacao": null}'),
  ('plano_anuncio_proprietario', '{"preco": 99.9, "dias": 60}')
on conflict (chave) do nothing;

-- 3. Imóveis avulsos (do proprietário, do corretor ou do investidor) ---------------------------
create table if not exists public.imoveis_avulsos (
  id uuid primary key default gen_random_uuid(),
  dono_id uuid not null references auth.users(id) on delete cascade,
  origem text not null default 'proprietario' check (origem in ('proprietario', 'corretor', 'investidor')),
  tipo text not null,
  titulo text not null check (char_length(titulo) between 10 and 120),
  descricao text not null check (char_length(descricao) between 30 and 4000),
  preco numeric not null check (preco > 0),
  uf text not null,
  cidade text not null,
  bairro text,
  endereco text,            -- só o dono, os corretores aprovados e o admin veem
  quartos int,
  vagas int,
  area numeric,
  fotos text[] not null default '{}',
  contato_nome text not null,
  contato_telefone text not null,
  aceita_corretor boolean not null default true,
  comissao_total numeric not null default 6,
  autorizacao_versao text not null,
  autorizacao_aceite_em timestamptz not null,
  autorizacao_aceite_ip text,
  status text not null default 'pendente'
    check (status in ('pendente', 'aprovado', 'recusado', 'vendido', 'pausado')),
  motivo text,
  criado timestamptz not null default now(),
  atualizado timestamptz not null default now()
);
create index if not exists imoveis_avulsos_status on public.imoveis_avulsos (status, uf, cidade);
alter table public.imoveis_avulsos enable row level security;
drop policy if exists avulsos_le on public.imoveis_avulsos;
create policy avulsos_le on public.imoveis_avulsos for select to authenticated
  using (dono_id = auth.uid() or public.sou_admin()
         or (status = 'aprovado' and aceita_corretor and public.sou_corretor_aprovado()));
drop policy if exists avulsos_cria on public.imoveis_avulsos;
create policy avulsos_cria on public.imoveis_avulsos for insert to authenticated
  with check (dono_id = auth.uid() and status = 'pendente');
drop policy if exists avulsos_edita on public.imoveis_avulsos;
create policy avulsos_edita on public.imoveis_avulsos for update to authenticated
  using (dono_id = auth.uid() or public.sou_admin())
  with check (public.sou_admin() or (dono_id = auth.uid() and status in ('pendente', 'pausado', 'vendido')));

-- Se o dono muda o anúncio aprovado, volta para aprovação.
create or replace function public.avulsos_reaprova() returns trigger
language plpgsql as $$
begin
  new.atualizado := now();
  if not public.sou_admin() and old.status = 'aprovado'
     and (new.titulo, new.descricao, new.preco, new.fotos) is distinct from (old.titulo, old.descricao, old.preco, old.fotos) then
    new.status := 'pendente';
  end if;
  return new;
end $$;
drop trigger if exists avulsos_reaprova on public.imoveis_avulsos;
create trigger avulsos_reaprova before update on public.imoveis_avulsos
  for each row execute function public.avulsos_reaprova();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avulsos-fotos', 'avulsos-fotos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists avulsos_envia_foto on storage.objects;
create policy avulsos_envia_foto on storage.objects for insert to authenticated
  with check (bucket_id = 'avulsos-fotos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 4. Registro das leituras de certidão e das consultas por CPF/CNPJ (auditoria e limite) ------
create table if not exists public.uso_ferramentas (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ferramenta text not null check (ferramenta in ('certidao', 'cpf_cnpj')),
  referencia text,          -- CPF/CNPJ mascarado ou nome do arquivo; nunca o documento inteiro
  finalidade text,
  criado timestamptz not null default now()
);
create index if not exists uso_ferramentas_user on public.uso_ferramentas (user_id, ferramenta, criado);
alter table public.uso_ferramentas enable row level security;
drop policy if exists uso_le on public.uso_ferramentas;
create policy uso_le on public.uso_ferramentas for select to authenticated
  using (user_id = auth.uid() or public.sou_admin());
drop policy if exists uso_cria on public.uso_ferramentas;
create policy uso_cria on public.uso_ferramentas for insert to authenticated
  with check (user_id = auth.uid());

-- 5. Corretor parceiro (contrato de parceria aceito e cadastro aprovado) não paga mensalidade:
--    usa as ferramentas do plano Profissional.
create or replace function public.plano_ativo(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when perfil = 'admin' then 'premium'
    when plano <> 'gratis' and plano_ate > now() then plano
    when perfil = 'corretor' and status = 'aprovado' and creci_ok and parceria_aceite_em is not null then 'profissional'
    else 'gratis' end
  from perfis where user_id = p_user
$$;
