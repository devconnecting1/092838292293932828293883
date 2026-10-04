-- 016: valores definidos pelo CEO em Gestão > Configurações.
-- Cada imóvel avulso guarda a comissão que valia no dia da autorização de venda,
-- para que uma mudança futura na tabela não altere o que o proprietário já aceitou.

alter table public.imoveis_avulsos
  add column if not exists comissao_corretor numeric,
  add column if not exists comissao_plataforma numeric;

update public.imoveis_avulsos
   set comissao_corretor = coalesce(comissao_corretor, 4),
       comissao_plataforma = coalesce(comissao_plataforma, 2)
 where comissao_corretor is null or comissao_plataforma is null;

create or replace function public.avulsos_comissao_vigente() returns trigger
language plpgsql security definer set search_path = public as $$
declare c jsonb := (select valor from config_portal where chave = 'comissao_avulso');
begin
  new.comissao_total := coalesce((c ->> 'total')::numeric, 6);
  new.comissao_corretor := coalesce((c ->> 'corretor')::numeric, 4);
  new.comissao_plataforma := coalesce((c ->> 'plataforma')::numeric, 2);
  return new;
end $$;
drop trigger if exists avulsos_comissao_vigente on public.imoveis_avulsos;
create trigger avulsos_comissao_vigente before insert on public.imoveis_avulsos
  for each row execute function public.avulsos_comissao_vigente();

-- Só o CEO muda comissão de anúncio já existente.
create or replace function public.avulsos_protege_comissao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.sou_admin() then return new; end if;
  new.comissao_total := old.comissao_total;
  new.comissao_corretor := old.comissao_corretor;
  new.comissao_plataforma := old.comissao_plataforma;
  return new;
end $$;
drop trigger if exists avulsos_protege_comissao on public.imoveis_avulsos;
create trigger avulsos_protege_comissao before update on public.imoveis_avulsos
  for each row execute function public.avulsos_protege_comissao();

-- Data da última alteração sempre correta, mesmo se o painel não mandar.
create or replace function public.config_portal_carimbo() returns trigger
language plpgsql as $$
begin
  new.atualizado := now();
  return new;
end $$;
drop trigger if exists config_portal_carimbo on public.config_portal;
create trigger config_portal_carimbo before insert or update on public.config_portal
  for each row execute function public.config_portal_carimbo();

insert into public.config_portal (chave, valor) values
  ('planos', '{}'::jsonb)
on conflict (chave) do nothing;

update public.config_portal
   set valor = valor || '{"nao_aliciamento_meses": 12}'::jsonb
 where chave = 'termo_indicacao' and not valor ? 'nao_aliciamento_meses';
