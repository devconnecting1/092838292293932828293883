-- Venda de anúncios nos portais imobiliários (ZAP, Viva Real, OLX, Imovelweb...).
-- Quem publica nos portais é só a empresa (dona da conta em cada portal).
-- Corretor ou cliente escolhe os imóveis e os portais, o sistema calcula o valor,
-- a pessoa paga, o dono aprova e os imóveis entram no feed do portal.

create table if not exists public.portais (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  nome text not null,
  formato text not null default 'vrsync' check (formato in ('vrsync')),
  preco_por_imovel numeric check (preco_por_imovel is null or preco_por_imovel >= 0),
  dias int not null default 30 check (dias between 1 and 365),
  ativo boolean not null default true,
  ordem int not null default 100
);
alter table public.portais enable row level security;
drop policy if exists portais_publico on public.portais;
create policy portais_publico on public.portais for select to anon, authenticated using (ativo);
drop policy if exists portais_admin on public.portais;
create policy portais_admin on public.portais for all to authenticated using (public.sou_admin()) with check (public.sou_admin());

-- Preço fica em branco até o dono definir (painel). Sem preço, o pedido sai "sob consulta".
insert into public.portais (slug, nome, formato, ordem) values
  ('grupo-olx', 'ZAP Imóveis, Viva Real e OLX (Grupo OLX)', 'vrsync', 1),
  ('imovelweb', 'Imovelweb', 'vrsync', 2),
  ('chaves-na-mao', 'Chaves na Mão', 'vrsync', 3)
on conflict (slug) do nothing;

create table if not exists public.anuncio_pedidos (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  nome text not null check (length(nome) between 2 and 120),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  telefone text not null check (length(regexp_replace(telefone, '\D', '', 'g')) between 10 and 13),
  perfil text not null check (perfil in ('corretor', 'cliente', 'proprietario', 'admin')),
  creci text,
  imoveis text[] not null check (cardinality(imoveis) between 1 and 200),
  portais text[] not null check (cardinality(portais) between 1 and 10),
  dias int not null default 30,
  valor numeric,
  status text not null default 'aguardando_pagamento'
    check (status in ('aguardando_pagamento', 'pago', 'aprovado', 'recusado', 'expirado', 'cancelado')),
  consentimento boolean not null check (consentimento),
  aceite_termo boolean not null check (aceite_termo),
  inicio timestamptz,
  fim timestamptz,
  observacao text,
  criado timestamptz not null default now(),
  atualizado timestamptz not null default now()
);
alter table public.anuncio_pedidos enable row level security;
drop policy if exists anuncio_pedidos_admin on public.anuncio_pedidos;
create policy anuncio_pedidos_admin on public.anuncio_pedidos for all to authenticated
  using (public.sou_admin()) with check (public.sou_admin());
create index if not exists anuncio_pedidos_status on public.anuncio_pedidos (status, fim);

-- Pedido público: o valor é sempre calculado aqui, nunca vem do navegador.
create or replace function public.criar_pedido_anuncio(
  p_nome text, p_email text, p_telefone text, p_perfil text, p_creci text,
  p_imoveis text[], p_portais text[], p_consentimento boolean, p_aceite_termo boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_imoveis text[];
  v_portais text[];
  v_preco numeric;
  v_sem_preco boolean;
  v_dias int;
  v_valor numeric;
  v_ped anuncio_pedidos;
begin
  if p_perfil not in ('corretor', 'cliente', 'proprietario') then raise exception 'perfil inválido'; end if;
  if p_perfil = 'corretor' and coalesce(trim(p_creci), '') = '' then raise exception 'informe o CRECI'; end if;
  select array_agg(distinct id) into v_imoveis from imoveis where ativo and id = any(p_imoveis);
  select array_agg(slug), sum(preco_por_imovel), bool_or(preco_por_imovel is null), max(dias)
    into v_portais, v_preco, v_sem_preco, v_dias
    from portais where ativo and slug = any(p_portais);
  if coalesce(cardinality(v_imoveis), 0) = 0 then raise exception 'escolha ao menos um imóvel'; end if;
  if coalesce(cardinality(v_portais), 0) = 0 then raise exception 'escolha ao menos um portal'; end if;
  v_valor := case when v_sem_preco then null else v_preco * cardinality(v_imoveis) end;
  insert into anuncio_pedidos (nome, email, telefone, perfil, creci, imoveis, portais, dias, valor, consentimento, aceite_termo)
  values (trim(p_nome), nullif(trim(p_email), ''), trim(p_telefone), p_perfil, nullif(trim(p_creci), ''),
          v_imoveis, v_portais, coalesce(v_dias, 30), v_valor, p_consentimento, p_aceite_termo)
  returning * into v_ped;
  return jsonb_build_object('codigo', v_ped.codigo, 'valor', v_ped.valor, 'imoveis', cardinality(v_imoveis), 'portais', v_portais, 'dias', v_ped.dias);
end $$;
revoke all on function public.criar_pedido_anuncio(text, text, text, text, text, text[], text[], boolean, boolean) from public;
grant execute on function public.criar_pedido_anuncio(text, text, text, text, text, text[], text[], boolean, boolean) to anon, authenticated;

-- Imóveis que entram no feed de um portal: pedidos aprovados e dentro do prazo.
create or replace function public.feed_portal(p_portal text)
returns setof imoveis
language sql stable security definer set search_path = public as $$
  select distinct on (i.id) i.*
  from anuncio_pedidos p
  join imoveis i on i.id = any(p.imoveis) and i.ativo
  where p.status = 'aprovado' and p_portal = any(p.portais)
    and (p.inicio is null or p.inicio <= now()) and (p.fim is null or p.fim > now())
$$;
revoke all on function public.feed_portal(text) from public;
grant execute on function public.feed_portal(text) to anon, authenticated;

-- Ao aprovar, o prazo começa a contar.
create or replace function public.anuncio_pedidos_prazo() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    new.inicio := coalesce(new.inicio, now());
    new.fim := coalesce(new.fim, new.inicio + make_interval(days => new.dias));
  end if;
  new.atualizado := now();
  return new;
end $$;
drop trigger if exists anuncio_pedidos_prazo on public.anuncio_pedidos;
create trigger anuncio_pedidos_prazo before update on public.anuncio_pedidos
  for each row execute function public.anuncio_pedidos_prazo();
