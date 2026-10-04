-- Banco do portal Vamos Arrematar (projeto Supabase "reidoape").
-- Várias origens (bancos, judiciais, leiloeiros) na mesma tabela de imóveis.
-- Só acrescenta colunas, tabelas e funções; o importador da Caixa continua igual.

create table if not exists public.origens (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  nome text not null,
  tipo text not null default 'banco' check (tipo in ('banco','judicial','extrajudicial','outro')),
  ordem int not null default 100,
  ativo boolean not null default true
);
alter table public.origens enable row level security;
drop policy if exists origens_publico on public.origens;
create policy origens_publico on public.origens for select to anon, authenticated using (true);

insert into public.origens (slug, nome, tipo, ordem) values
  ('caixa','Caixa','banco',1),
  ('banco-do-brasil','Banco do Brasil','banco',2),
  ('itau','Itaú','banco',3),
  ('bradesco','Bradesco','banco',4),
  ('santander','Santander','banco',5),
  ('safra','Safra','banco',6),
  ('inter','Banco Inter','banco',7),
  ('pan','Banco Pan','banco',8),
  ('bv','Banco BV','banco',9),
  ('brb','BRB','banco',10),
  ('sicoob','Sicoob','banco',11),
  ('porto-bank','Porto Bank','banco',12),
  ('judicial','Leilão judicial','judicial',50),
  ('extrajudicial','Leilão extrajudicial','extrajudicial',51),
  ('outros','Outras origens','outro',99)
on conflict (slug) do nothing;

alter table public.imoveis
  add column if not exists fonte text not null default 'caixa_lista',
  add column if not exists codigo_fonte text,
  add column if not exists codigo_banco text,
  add column if not exists codigo_leilao text,
  add column if not exists leiloeiro text,
  add column if not exists leiloeiro_registro text,
  add column if not exists intermediador text,
  add column if not exists matricula text,
  add column if not exists cartorio text,
  add column if not exists processo text,
  add column if not exists vara text,
  add column if not exists data_leilao_1 timestamptz,
  add column if not exists data_leilao_2 timestamptz,
  add column if not exists lance_leilao_2 numeric,
  add column if not exists data_encerramento timestamptz,
  add column if not exists edital_url text,
  add column if not exists fotos text[],
  add column if not exists latitude numeric,
  add column if not exists longitude numeric,
  add column if not exists cep text;

-- Imóveis da Caixa já existentes: o código do banco é o próprio id.
update public.imoveis set codigo_banco = id where origem = 'caixa' and codigo_banco is null;

create index if not exists imoveis_ativo_origem on public.imoveis (origem) where ativo;
create index if not exists imoveis_ativo_uf_cidade on public.imoveis (uf, cidade) where ativo;
create index if not exists imoveis_fonte on public.imoveis (fonte, codigo_fonte);
create index if not exists imoveis_codigo_banco on public.imoveis (origem, codigo_banco);

alter table public.importacoes add column if not exists fonte text not null default 'caixa_lista';

-- Contagem por origem para os filtros do portal.
create or replace function public.origens_resumo(p_uf text default null)
returns table (slug text, nome text, tipo text, n bigint)
language sql stable security definer set search_path = public as $$
  select o.slug, o.nome, o.tipo, count(i.id) n
  from origens o join imoveis i on i.origem = o.slug and i.ativo and (p_uf is null or i.uf = p_uf)
  where o.ativo
  group by o.slug, o.nome, o.tipo, o.ordem
  order by o.ordem
$$;
revoke all on function public.origens_resumo(text) from public;
grant execute on function public.origens_resumo(text) to anon, authenticated;

-- Leiloeiros com imóveis ativos (filtro).
create or replace function public.leiloeiros_resumo(p_uf text default null)
returns table (leiloeiro text, n bigint)
language sql stable security definer set search_path = public as $$
  select leiloeiro, count(*) n from imoveis
  where ativo and leiloeiro is not null and (p_uf is null or uf = p_uf)
  group by leiloeiro order by leiloeiro
$$;
revoke all on function public.leiloeiros_resumo(text) from public;
grant execute on function public.leiloeiros_resumo(text) to anon, authenticated;

-- Data de atualização passa a considerar qualquer fonte.
create or replace function public.resumo_vitrine()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('total', count(*), 'desconto_medio', round(avg(desconto),1), 'desconto_max', floor(max(desconto)), 'financiaveis', count(*) filter (where financiamento),
    'ufs', (select jsonb_agg(jsonb_build_object('uf',uf,'n',n) order by n desc) from (select uf, count(*) n from imoveis where ativo group by uf) x),
    'origens', (select count(distinct origem) from imoveis where ativo),
    'atualizado', (select max(fim) from importacoes where erro is null))
  from imoveis where ativo
$$;
