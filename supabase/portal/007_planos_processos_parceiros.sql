-- Assinaturas do portal, consulta processual e cadastro de parceiros.
-- Depende de 003_cadastro_corretores.sql.

alter table public.perfis
  add column if not exists plano text not null default 'gratis'
    check (plano in ('gratis', 'essencial', 'profissional', 'premium')),
  add column if not exists plano_ate timestamptz,
  add column if not exists stripe_cliente text,
  add column if not exists stripe_assinatura text;

-- Ninguém muda o próprio plano pelo navegador: só o webhook de pagamento (definir_plano) ou o admin.
create or replace function public.perfis_protege_plano() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.sou_admin() or current_setting('app.billing', true) = '1' then return new; end if;
  if tg_op = 'INSERT' then
    new.plano := 'gratis'; new.plano_ate := null; new.stripe_cliente := null; new.stripe_assinatura := null;
  else
    new.plano := old.plano; new.plano_ate := old.plano_ate;
    new.stripe_cliente := old.stripe_cliente; new.stripe_assinatura := old.stripe_assinatura;
  end if;
  return new;
end $$;
drop trigger if exists perfis_protege_plano on public.perfis;
create trigger perfis_protege_plano before insert or update on public.perfis
  for each row execute function public.perfis_protege_plano();

-- Chamada pelo webhook da Stripe, com o token guardado em config_privado.billing_token.
create or replace function public.definir_plano(
  p_token text, p_user uuid, p_plano text, p_ate timestamptz, p_cliente text, p_assinatura text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_token text;
begin
  select valor into v_token from config_privado where chave = 'billing_token';
  if v_token is null or length(v_token) < 24 or p_token is distinct from v_token then
    raise exception 'nao autorizado';
  end if;
  if p_plano not in ('essencial', 'profissional', 'premium') then raise exception 'plano invalido'; end if;
  perform set_config('app.billing', '1', true);
  update perfis set plano = p_plano, plano_ate = p_ate,
                    stripe_cliente = p_cliente, stripe_assinatura = p_assinatura
   where user_id = p_user;
  return found;
end $$;
revoke all on function public.definir_plano(text, uuid, text, timestamptz, text, text) from public;
grant execute on function public.definir_plano(text, uuid, text, timestamptz, text, text) to anon, authenticated;

create or replace function public.plano_ativo(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when perfil = 'admin' then 'premium'
    when plano <> 'gratis' and plano_ate > now() then plano
    else 'gratis' end
  from perfis where user_id = p_user
$$;

-- Registro das consultas processuais (limite mensal por plano).
create table if not exists public.consultas_processuais (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  numero text not null,
  criado timestamptz not null default now()
);
create index if not exists consultas_processuais_user on public.consultas_processuais (user_id, criado);
alter table public.consultas_processuais enable row level security;
drop policy if exists consultas_le on public.consultas_processuais;
create policy consultas_le on public.consultas_processuais for select to authenticated
  using (user_id = auth.uid() or public.sou_admin());
drop policy if exists consultas_cria on public.consultas_processuais;
create policy consultas_cria on public.consultas_processuais for insert to authenticated
  with check (user_id = auth.uid());

-- Prioridade no rodízio: dentro do mesmo nível (bairro, cidade, vizinha), plano maior vem antes.
create or replace function public.rank_plano(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select case public.plano_ativo(p_user) when 'premium' then 3 when 'profissional' then 2
                                         when 'essencial' then 1 else 0 end
$$;

-- Parceiros e correspondentes (advogados, despachantes, engenheiros, vistoriadores, leiloeiros...).
create table if not exists public.parceiros (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 3 and 120),
  empresa text,
  categoria text not null,
  registro text,
  telefone text not null,
  email text,
  cidade text,
  uf text,
  mensagem text,
  consentimento boolean not null check (consentimento),
  status text not null default 'novo' check (status in ('novo', 'aprovado', 'recusado')),
  criado timestamptz not null default now()
);
alter table public.parceiros enable row level security;
drop policy if exists parceiros_cria on public.parceiros;
create policy parceiros_cria on public.parceiros for insert to anon, authenticated with check (status = 'novo');
drop policy if exists parceiros_admin on public.parceiros;
create policy parceiros_admin on public.parceiros for all to authenticated
  using (public.sou_admin()) with check (public.sou_admin());
