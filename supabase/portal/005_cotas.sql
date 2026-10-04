-- Arremate em cotas: cada cota vale 10% do investimento total do imóvel
-- (lance + despesas). O imóvel só é arrematado quando as 10 cotas fecham.
-- Os dados de quem reserva ficam privados; o público vê só quantas cotas faltam.

create table if not exists public.cotas_grupos (
  imovel_id text primary key,
  status text not null default 'aberto'
    check (status in ('aberto', 'fechado', 'arrematado', 'vendido', 'encerrado')),
  destaque boolean not null default true,
  titular text,
  observacao text,
  criado timestamptz not null default now(),
  atualizado timestamptz not null default now()
);

create table if not exists public.cotas_reservas (
  id uuid primary key default gen_random_uuid(),
  imovel_id text not null,
  nome text not null check (char_length(nome) between 3 and 120),
  telefone text not null check (char_length(telefone) between 8 and 30),
  email text check (email is null or char_length(email) <= 160),
  cotas int not null check (cotas between 1 and 10),
  quer_ser_titular boolean not null default false,
  consentimento boolean not null check (consentimento),
  status text not null default 'interesse'
    check (status in ('interesse', 'confirmada', 'cancelada')),
  criado timestamptz not null default now()
);
create index if not exists cotas_reservas_imovel on public.cotas_reservas (imovel_id);

alter table public.cotas_grupos enable row level security;
alter table public.cotas_reservas enable row level security;

drop policy if exists cotas_grupos_le on public.cotas_grupos;
create policy cotas_grupos_le on public.cotas_grupos for select using (true);
drop policy if exists cotas_grupos_admin on public.cotas_grupos;
create policy cotas_grupos_admin on public.cotas_grupos for all to authenticated
  using (public.sou_admin()) with check (public.sou_admin());

drop policy if exists cotas_reservas_cria on public.cotas_reservas;
create policy cotas_reservas_cria on public.cotas_reservas for insert to anon, authenticated
  with check (status = 'interesse');
drop policy if exists cotas_reservas_admin on public.cotas_reservas;
create policy cotas_reservas_admin on public.cotas_reservas for all to authenticated
  using (public.sou_admin()) with check (public.sou_admin());

-- Não deixa passar de 10 cotas (100%) por imóvel.
create or replace function public.cotas_limite() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  usadas int;
begin
  perform pg_advisory_xact_lock(hashtext('cotas:' || new.imovel_id));
  select coalesce(sum(cotas), 0) into usadas
    from cotas_reservas
   where imovel_id = new.imovel_id and status <> 'cancelada' and id <> new.id;
  if new.status <> 'cancelada' and usadas + new.cotas > 10 then
    raise exception 'Restam só % cota(s) neste imóvel.', 10 - usadas;
  end if;
  return new;
end $$;
drop trigger if exists cotas_limite on public.cotas_reservas;
create trigger cotas_limite before insert or update on public.cotas_reservas
  for each row execute function public.cotas_limite();

-- Quantas cotas já foram reservadas (sem dados pessoais).
create or replace function public.cotas_resumo(p_ids text[])
returns table (imovel_id text, reservadas int, status text)
language sql stable security definer set search_path = public as $$
  select i.id,
         coalesce((select sum(r.cotas)::int from cotas_reservas r
                    where r.imovel_id = i.id and r.status <> 'cancelada'), 0),
         coalesce(g.status, 'aberto')
    from unnest(p_ids) as i(id)
    left join cotas_grupos g on g.imovel_id = i.id
$$;
revoke all on function public.cotas_resumo(text[]) from public;
grant execute on function public.cotas_resumo(text[]) to anon, authenticated;
