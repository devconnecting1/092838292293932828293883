-- Vamos Arrematar: instalação completa no banco de produção (001 a 020, sem a carga de municípios, já feita).
begin;

-- ===== 001_imoveis_multiplas_origens.sql =====
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

-- ===== 002_anuncios_portais.sql =====
-- Venda de anúncios nos portais imobiliários parceiros e nas redes sociais.
-- No site os canais aparecem sem nome de terceiro; o slug técnico só identifica o feed.
-- Quem publica nos portais é só a empresa (dona da conta em cada portal).
-- Corretor ou cliente escolhe os imóveis e os portais, o sistema calcula o valor,
-- a pessoa paga, o dono aprova e os imóveis entram no feed do portal.

create table if not exists public.portais (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  nome text not null,
  formato text not null default 'vrsync' check (formato in ('vrsync', 'social')),
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
  ('grupo-olx', 'Maiores portais imobiliários do Brasil', 'vrsync', 1),
  ('imovelweb', 'Portais imobiliários parceiros', 'vrsync', 2),
  ('chaves-na-mao', 'Portais regionais parceiros', 'vrsync', 3),
  ('redes-sociais', 'Redes sociais da plataforma', 'social', 4)
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

-- ===== 003_cadastro_corretores.sql =====
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

-- ===== 004_automacao.sql =====
-- Atualização automática dos imóveis: entram, mudam de preço e saem sozinhos.
-- A cada hora o banco chama as funções de importação:
--  * importar-caixa: lista oficial da Caixa por estado (pula o estado atualizado há menos de 6 h);
--  * importar-feed: cada parceiro com link de dados cadastrado em config_privado (feed_<fonte>_url).
-- Quando a lista de um estado não vem (proteção anti-robô da Caixa), nada é apagado: o erro fica
-- registrado em importacoes e o estado é tentado de novo na hora seguinte.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.disparar_importacoes() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_token text;
  v_base text := 'https://pgkrhbyvinhffobniktg.supabase.co/functions/v1/';
  f record;
begin
  select valor into v_token from config_privado where chave = 'import_token';
  if v_token is null then return; end if;

  perform net.http_post(
    url := v_base || 'importar-caixa',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-import-token', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );

  for f in
    select substring(chave from '^feed_(.+)_url$') as fonte
    from config_privado where chave ~ '^feed_[a-z0-9_]+_url$' and coalesce(valor, '') <> ''
  loop
    perform net.http_post(
      url := v_base || 'importar-feed',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-import-token', v_token),
      body := jsonb_build_object('fonte', f.fonte, 'completo', true),
      timeout_milliseconds := 150000
    );
  end loop;
end $$;
revoke all on function public.disparar_importacoes() from public, anon, authenticated;

-- Anúncios pagos vencidos saem do feed dos portais.
create or replace function public.expirar_anuncios() returns void
language sql security definer set search_path = public as $$
  update anuncio_pedidos set status = 'expirado'
  where status = 'aprovado' and fim is not null and fim < now();
$$;
revoke all on function public.expirar_anuncios() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('importar-imoveis', 'expirar-anuncios');
select cron.schedule('importar-imoveis', '17 * * * *', 'select public.disparar_importacoes()');
select cron.schedule('expirar-anuncios', '5 3 * * *', 'select public.expirar_anuncios()');

-- ===== 005_cotas.sql =====
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

-- ===== 006_rodizio_leads.sql =====
-- Rodízio de leads "tipo Uber": o contato vai para o corretor mais perto do que o cliente pediu.
--
-- Ordem de escolha, sempre DENTRO DO MESMO ESTADO do imóvel/pedido:
--   1. corretor da mesma cidade que atende o bairro pedido;
--   2. corretor da mesma cidade (sorteio justo: quem recebeu lead há mais tempo vem primeiro,
--      empate decidido por sorteio);
--   3. corretor das cidades vizinhas, da mais perto para a mais longe (distância entre
--      municípios do IBGE).
-- Ninguém fora do estado recebe. Sem corretor disponível, o lead fica na fila do dono (admin).
--
-- Prazo: o corretor tem 30 minutos para falar com o cliente e marcar "já falei". Se não marcar,
-- o lead passa para o próximo da lista, e assim por diante (até 10 rodadas). Fora do horário
-- comercial (8h às 21h, horário de Brasília) o relógio só começa às 8h.
-- Depende de: 003_cadastro_corretores.sql e 006a_municipios.sql.

create or replace function public.chave_cidade(t text) returns text
language sql immutable as $$
  select nullif(regexp_replace(lower(translate(coalesce(t, ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç''-',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc  ')), '\s+', ' ', 'g'), '')
$$;

alter table public.perfis
  add column if not exists bairros_atuacao text[] not null default '{}',
  add column if not exists recebe_leads boolean not null default true,
  add column if not exists ultimo_lead_em timestamptz;

alter table public.leads
  add column if not exists cidade text,
  add column if not exists uf text,
  add column if not exists bairro text,
  add column if not exists distribuido_em timestamptz,
  add column if not exists atendido_em timestamptz,
  add column if not exists rodadas int not null default 0;

create table if not exists public.lead_ofertas (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  corretor_id uuid not null references auth.users(id) on delete cascade,
  nivel text not null check (nivel in ('bairro', 'cidade', 'vizinha')),
  distancia_km numeric,
  ofertado_em timestamptz not null default now(),
  prazo_ate timestamptz not null,
  status text not null default 'aguardando'
    check (status in ('aguardando', 'atendido', 'expirado', 'devolvido')),
  respondido_em timestamptz
);
create index if not exists lead_ofertas_lead on public.lead_ofertas (lead_id);
create index if not exists lead_ofertas_aguardando on public.lead_ofertas (prazo_ate) where status = 'aguardando';
alter table public.lead_ofertas enable row level security;
drop policy if exists lead_ofertas_le on public.lead_ofertas;
create policy lead_ofertas_le on public.lead_ofertas for select to authenticated
  using (corretor_id = auth.uid() or public.sou_admin());

-- Prioridade por plano (007_planos... substitui esta versão; aqui todos empatam).
create or replace function public.rank_plano(p_user uuid) returns int
language sql stable as $$ select 0 $$;

-- Prazo de resposta respeitando o horário comercial de Brasília.
create or replace function public.prazo_lead(p_minutos int default 30) returns timestamptz
language plpgsql stable as $$
declare
  agora timestamp := now() at time zone 'America/Sao_Paulo';
  inicio timestamp;
begin
  if agora::time >= time '08:00' and agora::time < time '21:00' then
    inicio := agora;
  elsif agora::time < time '08:00' then
    inicio := date_trunc('day', agora) + time '08:00';
  else
    inicio := date_trunc('day', agora) + interval '1 day' + time '08:00';
  end if;
  return (inicio + make_interval(mins => p_minutos)) at time zone 'America/Sao_Paulo';
end $$;

-- Escolhe o próximo corretor e cria a oferta. Devolve o corretor escolhido (ou null).
create or replace function public.distribuir_lead(p_lead uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  l record;
  v_uf text;
  v_cidade text;
  v_bairro text;
  m0 record;
  c record;
  v_prazo timestamptz;
begin
  select * into l from leads where id = p_lead for update;
  if not found or l.atendido_em is not null then return null; end if;

  select coalesce(l.uf, i.uf), coalesce(l.cidade, i.cidade), coalesce(l.bairro, i.bairro)
    into v_uf, v_cidade, v_bairro
    from (select 1) x left join imoveis i on i.id = l.imovel_id;

  if v_uf is null or l.rodadas >= 10 then
    update leads set corretor_id = null, trava_ate = null where id = p_lead;
    return null;
  end if;

  select latitude, longitude into m0 from municipios
   where uf = upper(v_uf) and chave = chave_cidade(v_cidade) limit 1;

  select p.user_id,
         case
           when chave_cidade(p.cidade) = chave_cidade(v_cidade) and v_bairro is not null
                and exists (select 1 from unnest(p.bairros_atuacao) b
                             where chave_cidade(b) = chave_cidade(v_bairro)) then 'bairro'
           when chave_cidade(p.cidade) = chave_cidade(v_cidade) then 'cidade'
           else 'vizinha'
         end as nivel,
         case when m0.latitude is not null and m.latitude is not null then
           round((6371 * acos(least(1, cos(radians(m0.latitude)) * cos(radians(m.latitude))
             * cos(radians(m.longitude) - radians(m0.longitude))
             + sin(radians(m0.latitude)) * sin(radians(m.latitude)))))::numeric, 1)
         end as km
    into c
    from perfis p
    left join municipios m on m.uf = upper(p.uf) and m.chave = chave_cidade(p.cidade)
   where p.perfil in ('corretor', 'imobiliaria') and p.status = 'aprovado' and p.creci_ok and p.recebe_leads
     and upper(p.uf) = upper(v_uf)
     and not exists (select 1 from lead_ofertas o where o.lead_id = p_lead and o.corretor_id = p.user_id)
   order by
     case
       when chave_cidade(p.cidade) = chave_cidade(v_cidade) and v_bairro is not null
            and exists (select 1 from unnest(p.bairros_atuacao) b
                         where chave_cidade(b) = chave_cidade(v_bairro)) then 0
       when chave_cidade(p.cidade) = chave_cidade(v_cidade) then 1
       else 2
     end,
     case when chave_cidade(p.cidade) = chave_cidade(v_cidade) then 0
          when m0.latitude is null or m.latitude is null then 1e9
          else (m.latitude - m0.latitude) ^ 2 + ((m.longitude - m0.longitude) * cos(radians(m0.latitude))) ^ 2
     end,
     public.rank_plano(p.user_id) desc,
     p.ultimo_lead_em asc nulls first,
     random()
   limit 1;

  if c.user_id is null then
    update leads set corretor_id = null, trava_ate = null where id = p_lead;
    return null;
  end if;

  v_prazo := prazo_lead(30);
  insert into lead_ofertas (lead_id, corretor_id, nivel, distancia_km, prazo_ate)
  values (p_lead, c.user_id, c.nivel, c.km, v_prazo);
  update leads set corretor_id = c.user_id, trava_ate = v_prazo, distribuido_em = now(),
                   rodadas = rodadas + 1
   where id = p_lead;
  update perfis set ultimo_lead_em = now() where user_id = c.user_id;
  return c.user_id;
end $$;
revoke all on function public.distribuir_lead(uuid) from public, anon, authenticated;

-- Todo lead novo de interesse em imóvel entra no rodízio. Assessoria, financiamento e
-- anúncio são serviços da empresa e ficam na fila do dono.
create or replace function public.leads_rodizio_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.interesse in ('visita', 'duvida') then
    perform distribuir_lead(new.id);
  end if;
  return null;
end $$;
drop trigger if exists leads_rodizio on public.leads;
create trigger leads_rodizio after insert on public.leads
  for each row execute function public.leads_rodizio_trigger();

-- Passa adiante as ofertas vencidas. Roda pelo pg_cron a cada 5 minutos e também quando
-- alguém abre o painel (por isso pode ser chamada por qualquer um: só mexe no que venceu).
create or replace function public.redistribuir_leads_vencidos() returns int
language plpgsql security definer set search_path = public as $$
declare
  o record;
  n int := 0;
begin
  for o in
    select id, lead_id from lead_ofertas
     where status = 'aguardando' and prazo_ate < now()
     order by prazo_ate
     limit 200
     for update skip locked
  loop
    update lead_ofertas set status = 'expirado', respondido_em = now() where id = o.id;
    perform distribuir_lead(o.lead_id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.redistribuir_leads_vencidos() from public;
grant execute on function public.redistribuir_leads_vencidos() to anon, authenticated;

-- O corretor confirma que falou com o cliente: o lead passa a ser dele.
create or replace function public.assumir_lead(p_lead uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  o record;
begin
  select * into o from lead_ofertas
   where lead_id = p_lead and corretor_id = auth.uid() and status = 'aguardando'
     and prazo_ate >= now()
   for update;
  if not found then return false; end if;
  update lead_ofertas set status = 'atendido', respondido_em = now() where id = o.id;
  update leads set atendido_em = now(), trava_ate = null, status = 'em_atendimento'
   where id = p_lead;
  return true;
end $$;
revoke all on function public.assumir_lead(uuid) from public, anon;
grant execute on function public.assumir_lead(uuid) to authenticated;

-- O corretor não pode atender: passa na hora para o próximo.
create or replace function public.devolver_lead(p_lead uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  o record;
begin
  select * into o from lead_ofertas
   where lead_id = p_lead and corretor_id = auth.uid() and status = 'aguardando'
   for update;
  if not found then return false; end if;
  update lead_ofertas set status = 'devolvido', respondido_em = now() where id = o.id;
  perform distribuir_lead(p_lead);
  return true;
end $$;
revoke all on function public.devolver_lead(uuid) from public, anon;
grant execute on function public.devolver_lead(uuid) to authenticated;

-- A cada 5 minutos, se o pg_cron estiver ligado (004_automacao.sql cria a extensão).
do $$ begin
  perform cron.schedule('rodizio-leads', '*/5 * * * *', 'select public.redistribuir_leads_vencidos()');
exception when others then null; end $$;

-- ===== 007_planos_processos_parceiros.sql =====
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

-- ===== 008_parceria_avulsos_ferramentas.sql =====
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

-- ===== 009_adm_auditoria_chamados.sql =====
-- ADM do CEO: equipe de atendimento sem acesso ao financeiro, trilha de auditoria de tudo
-- e central de chamados (suporte com protocolo).
-- Depende de 003, 007 e 008.
--
-- Papéis:
--   admin       = CEO (Fabrício Damião). Vê e muda tudo, inclusive o financeiro.
--   atendente   = equipe escolhida pelo CEO. Vê clientes (sem dados bancários nem documentos),
--                 a situação da cobrança de cada um, atende chamados e pede troca de senha.
--                 Não vê valores recebidos, totais nem relatórios financeiros.
--   corretor, investidor, proprietario, comprador = clientes do portal.

-- 1. Papel de atendente ---------------------------------------------------------------------
create or replace function public.sou_equipe() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from perfis where user_id = auth.uid() and perfil in ('admin', 'atendente'))
$$;

-- Só o CEO promove alguém a atendente ou tira da equipe (o gatilho de perfil já impede
-- auto-promoção a admin; aqui também a atendente).
create or replace function public.perfis_protege_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.sou_admin() then return new; end if;
  if tg_op = 'UPDATE' and (old.status = 'aprovado' or old.perfil = 'atendente') then
    new.perfil := old.perfil;
  end if;
  if new.perfil in ('admin', 'atendente') and (tg_op = 'INSERT' or new.perfil is distinct from old.perfil) then
    raise exception 'perfil nao permitido';
  end if;
  return new;
end $$;

-- 2. Lista de clientes para a equipe (sem PIX, banco nem documentos) ---------------------------
create or replace function public.equipe_clientes(p_tipo text default null, p_busca text default null)
returns table (user_id uuid, nome text, email text, whatsapp text, perfil text, cidade text, uf text,
               creci text, creci_uf text, status text, plano text, plano_ate timestamptz,
               parceiro boolean, criado timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.sou_equipe() then raise exception 'nao autorizado'; end if;
  return query
    select p.user_id, p.nome, p.email, p.whatsapp, p.perfil, p.cidade, p.uf, p.creci, p.creci_uf,
           p.status, p.plano, p.plano_ate, p.parceria_aceite_em is not null, p.criado
      from perfis p
     where p.perfil not in ('admin')
       and (p_tipo is null or p.perfil = p_tipo)
       and (p_busca is null or p.nome ilike '%' || p_busca || '%' or p.email ilike '%' || p_busca || '%'
            or p.whatsapp ilike '%' || p_busca || '%' or p.creci ilike '%' || p_busca || '%')
     order by p.criado desc
     limit 500;
end $$;
revoke all on function public.equipe_clientes(text, text) from public, anon;
grant execute on function public.equipe_clientes(text, text) to authenticated;

-- 3. Trilha de auditoria -----------------------------------------------------------------------
create table if not exists public.auditoria (
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  autor_id uuid,
  autor_nome text,
  tabela text not null,
  registro text,
  acao text not null,
  detalhe jsonb
);
create index if not exists auditoria_quando on public.auditoria (quando desc);
create index if not exists auditoria_autor on public.auditoria (autor_id, quando desc);
create index if not exists auditoria_registro on public.auditoria (tabela, registro);
alter table public.auditoria enable row level security;
drop policy if exists auditoria_ceo on public.auditoria;
create policy auditoria_ceo on public.auditoria for select to authenticated using (public.sou_admin());
-- Ninguém altera nem apaga o histórico (nem pela API): sem políticas de insert/update/delete.

create or replace function public.auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_novo jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_velho jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_mudou jsonb := '{}'::jsonb;
  k text;
  v_nome text;
  sensiveis text[] := array['pix_chave', 'banco', 'telefone', 'telefone_1', 'telefone_2', 'contato_telefone', 'email', 'endereco', 'numero', 'cep', 'whatsapp'];
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_novo) loop
      if k in ('atualizado') then continue; end if;
      if v_novo -> k is distinct from v_velho -> k then
        v_mudou := v_mudou || jsonb_build_object(k,
          case when k = any(sensiveis) then '"(alterado)"'::jsonb
               else jsonb_build_object('de', v_velho -> k, 'para', v_novo -> k) end);
      end if;
    end loop;
    if v_mudou = '{}'::jsonb then return null; end if;
  end if;
  select nome into v_nome from perfis where user_id = auth.uid();
  insert into auditoria (autor_id, autor_nome, tabela, registro, acao, detalhe)
  values (auth.uid(), coalesce(v_nome, case when auth.uid() is null then 'sistema' end), tg_table_name,
          coalesce(v_novo ->> 'id', v_velho ->> 'id', v_novo ->> 'user_id', v_velho ->> 'user_id',
                   v_novo ->> 'chave', v_velho ->> 'chave'),
          lower(tg_op), case when tg_op = 'UPDATE' then v_mudou else null end);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['perfis', 'leads', 'lead_ofertas', 'imoveis_avulsos', 'parceiros',
                           'cotas_reservas', 'cotas_grupos', 'config_portal', 'pedidos'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists auditar on public.%I', t);
      execute format('create trigger auditar after insert or update or delete on public.%I
                      for each row execute function public.auditar()', t);
    end if;
  end loop;
end $$;

-- Registro manual de ações que não mudam tabela (ex.: pediu troca de senha, ligou para o cliente).
create or replace function public.registrar_acao(p_acao text, p_alvo text, p_detalhe text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  if not public.sou_equipe() then raise exception 'nao autorizado'; end if;
  select nome into v_nome from perfis where user_id = auth.uid();
  insert into auditoria (autor_id, autor_nome, tabela, registro, acao, detalhe)
  values (auth.uid(), v_nome, 'acao_manual', left(p_alvo, 200), left(p_acao, 80),
          case when p_detalhe is null then null else jsonb_build_object('nota', left(p_detalhe, 2000)) end);
end $$;
revoke all on function public.registrar_acao(text, text, text) from public, anon;
grant execute on function public.registrar_acao(text, text, text) to authenticated;

-- 4. Central de chamados ------------------------------------------------------------------------
create sequence if not exists public.chamados_protocolo_seq;

create table if not exists public.chamados (
  id uuid primary key default gen_random_uuid(),
  protocolo text not null unique
    default 'VA-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY') || '-'
            || lpad(nextval('public.chamados_protocolo_seq')::text, 6, '0'),
  cliente_id uuid references auth.users(id) on delete set null,
  cliente_nome text not null,
  cliente_contato text,
  assunto text not null check (char_length(assunto) between 3 and 160),
  categoria text not null default 'duvida'
    check (categoria in ('duvida', 'acesso', 'cobranca', 'anuncio', 'leilao', 'parceria', 'reclamacao', 'outro')),
  canal text not null default 'site' check (canal in ('site', 'whatsapp', 'email', 'telefone')),
  status text not null default 'aberto'
    check (status in ('aberto', 'em_atendimento', 'aguardando_cliente', 'resolvido', 'fechado')),
  responsavel_id uuid references auth.users(id) on delete set null,
  criado timestamptz not null default now(),
  atualizado timestamptz not null default now(),
  resolvido_em timestamptz
);
create index if not exists chamados_status on public.chamados (status, atualizado desc);
create index if not exists chamados_cliente on public.chamados (cliente_id);

create table if not exists public.chamado_mensagens (
  id bigint generated always as identity primary key,
  chamado_id uuid not null references public.chamados(id) on delete cascade,
  autor_id uuid,
  autor_nome text,
  da_equipe boolean not null default false,
  interna boolean not null default false,
  texto text not null check (char_length(texto) between 1 and 5000),
  email_enviado boolean not null default false,
  criado timestamptz not null default now()
);
create index if not exists chamado_mensagens_chamado on public.chamado_mensagens (chamado_id, criado);

alter table public.chamados enable row level security;
alter table public.chamado_mensagens enable row level security;

drop policy if exists chamados_le on public.chamados;
create policy chamados_le on public.chamados for select to authenticated
  using (cliente_id = auth.uid() or public.sou_equipe());
drop policy if exists chamados_cria on public.chamados;
create policy chamados_cria on public.chamados for insert to authenticated
  with check ((cliente_id = auth.uid() and status = 'aberto' and responsavel_id is null) or public.sou_equipe());
drop policy if exists chamados_edita on public.chamados;
create policy chamados_edita on public.chamados for update to authenticated
  using (public.sou_equipe()) with check (public.sou_equipe());

drop policy if exists msgs_le on public.chamado_mensagens;
create policy msgs_le on public.chamado_mensagens for select to authenticated
  using (public.sou_equipe()
         or (not interna and exists (select 1 from chamados c where c.id = chamado_id and c.cliente_id = auth.uid())));
drop policy if exists msgs_cria on public.chamado_mensagens;
create policy msgs_cria on public.chamado_mensagens for insert to authenticated
  with check (
    (public.sou_equipe() and da_equipe)
    or (not da_equipe and not interna and autor_id = auth.uid()
        and exists (select 1 from chamados c where c.id = chamado_id and c.cliente_id = auth.uid()
                    and c.status <> 'fechado')));
drop policy if exists msgs_marca_email on public.chamado_mensagens;
create policy msgs_marca_email on public.chamado_mensagens for update to authenticated
  using (public.sou_equipe()) with check (public.sou_equipe());

-- Nome do autor e data de atualização preenchidos pelo banco; cliente que responde reabre.
create or replace function public.chamado_mensagem_antes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.autor_id := auth.uid();
  select nome into new.autor_nome from perfis where user_id = auth.uid();
  update chamados set atualizado = now(),
         status = case when not new.da_equipe and status in ('aguardando_cliente', 'resolvido') then 'em_atendimento'
                       when new.da_equipe and not new.interna and status = 'aberto' then 'em_atendimento'
                       else status end,
         responsavel_id = case when new.da_equipe and responsavel_id is null then auth.uid() else responsavel_id end
   where id = new.chamado_id;
  return new;
end $$;
drop trigger if exists chamado_mensagem_antes on public.chamado_mensagens;
create trigger chamado_mensagem_antes before insert on public.chamado_mensagens
  for each row execute function public.chamado_mensagem_antes();

create or replace function public.chamados_antes() returns trigger
language plpgsql as $$
begin
  new.atualizado := now();
  if new.status in ('resolvido', 'fechado') and (tg_op = 'INSERT' or old.status not in ('resolvido', 'fechado')) then
    new.resolvido_em := now();
  end if;
  return new;
end $$;
drop trigger if exists chamados_antes on public.chamados;
create trigger chamados_antes before insert or update on public.chamados
  for each row execute function public.chamados_antes();

do $$ begin
  drop trigger if exists auditar on public.chamados;
  create trigger auditar after insert or update or delete on public.chamados
    for each row execute function public.auditar();
  drop trigger if exists auditar on public.chamado_mensagens;
  create trigger auditar after insert on public.chamado_mensagens
    for each row execute function public.auditar();
end $$;

-- 5. Financeiro: só o CEO -------------------------------------------------------------------
create or replace function public.financeiro_resumo() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.sou_admin() then raise exception 'nao autorizado'; end if;
  return jsonb_build_object(
    'assinantes', (select coalesce(jsonb_object_agg(plano, n), '{}'::jsonb)
                     from (select plano, count(*) n from perfis
                            where plano <> 'gratis' and plano_ate > now() group by plano) x),
    'parceiros', (select count(*) from perfis where parceria_aceite_em is not null and status = 'aprovado'),
    'clientes', (select coalesce(jsonb_object_agg(perfil, n), '{}'::jsonb)
                   from (select perfil, count(*) n from perfis group by perfil) y),
    'leads_mes', (select count(*) from leads where criado >= date_trunc('month', now())),
    'leads_atendidos_mes', (select count(*) from leads where atendido_em >= date_trunc('month', now())),
    'avulsos', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                  from (select status, count(*) n from imoveis_avulsos group by status) z),
    'chamados_abertos', (select count(*) from chamados where status not in ('resolvido', 'fechado'))
  );
end $$;
revoke all on function public.financeiro_resumo() from public, anon;
grant execute on function public.financeiro_resumo() to authenticated;

-- ===== 010_leads_ceo_imobiliarias.sql =====
-- Distribuição de leads pelo CEO (roleta manual), imobiliárias parceiras, termo de indicação
-- ("este cliente é nosso") e feedback obrigatório do atendimento.
-- Depende de 006, 008 e 009.
--
-- Regras:
--  * Todo lead cai primeiro no ADM do CEO. O sistema sugere os parceiros mais próximos
--    (mesma lógica do rodízio: bairro, cidade, cidades vizinhas, sempre no mesmo estado) e o CEO
--    escolhe para quem encaminhar.
--  * Recebem leads só corretores e imobiliárias parceiras aprovadas. Investidor nunca recebe.
--  * O parceiro aceita o termo de indicação antes de ver o contato; tem o prazo para atender e
--    precisa registrar o andamento (feedback). Se o prazo vencer, o lead volta para o CEO.
--  * Comissão: corretor parceiro 40%; imobiliária parceira 50%, emitindo nota fiscal.

-- 1. Imobiliária como categoria de cadastro -----------------------------------------------------
drop policy if exists perfis_edita on public.perfis;
create policy perfis_edita on public.perfis for update to authenticated
  using (user_id = auth.uid() or public.sou_admin())
  with check (public.sou_admin() or (user_id = auth.uid()
    and perfil in ('investidor', 'comprador', 'corretor', 'proprietario', 'imobiliaria')));
drop policy if exists perfis_cria on public.perfis;
create policy perfis_cria on public.perfis for insert to authenticated
  with check (user_id = auth.uid()
    and perfil in ('investidor', 'comprador', 'corretor', 'proprietario', 'imobiliaria')
    and creci_ok = false);

insert into public.config_portal (chave, valor) values
  ('rodizio', '{"modo": "manual", "prazo_minutos": 30}'),
  ('parceria_leilao_imobiliaria', '{"imobiliaria": 50, "emite_nota_fiscal": true}'),
  ('termo_indicacao', '{"versao": "2026-10-v1"}')
on conflict (chave) do nothing;

create or replace function public.rodizio_manual() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select valor ->> 'modo' from config_portal where chave = 'rodizio'), 'manual') = 'manual'
$$;

-- 2. Colunas novas ------------------------------------------------------------------------------
alter table public.lead_ofertas
  add column if not exists termo_versao text,
  add column if not exists termo_aceite_em timestamptz,
  add column if not exists encaminhado_por uuid;
alter table public.leads
  add column if not exists etapa text;

create table if not exists public.lead_feedbacks (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  autor_id uuid not null default auth.uid(),
  etapa text not null check (etapa in ('contato', 'visita', 'proposta', 'vendido', 'perdido', 'sem_resposta')),
  texto text not null check (char_length(texto) between 5 and 2000),
  criado timestamptz not null default now()
);
create index if not exists lead_feedbacks_lead on public.lead_feedbacks (lead_id, criado);
alter table public.lead_feedbacks enable row level security;
drop policy if exists feedback_le on public.lead_feedbacks;
create policy feedback_le on public.lead_feedbacks for select to authenticated
  using (autor_id = auth.uid() or public.sou_equipe());
drop policy if exists feedback_cria on public.lead_feedbacks;
create policy feedback_cria on public.lead_feedbacks for insert to authenticated
  with check (autor_id = auth.uid()
    and exists (select 1 from leads l where l.id = lead_id and l.corretor_id = auth.uid() and l.atendido_em is not null));

create or replace function public.feedback_etapa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update leads set etapa = new.etapa,
                   status = case new.etapa when 'vendido' then 'vendido' when 'perdido' then 'perdido' else status end
   where id = new.lead_id;
  return null;
end $$;
drop trigger if exists feedback_etapa on public.lead_feedbacks;
create trigger feedback_etapa after insert on public.lead_feedbacks
  for each row execute function public.feedback_etapa();
drop trigger if exists auditar on public.lead_feedbacks;
create trigger auditar after insert on public.lead_feedbacks
  for each row execute function public.auditar();

-- 3. Quem pode receber: corretor e imobiliária (nunca investidor) ------------------------------
create or replace function public.parceiro_elegivel(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from perfis where user_id = p_user and perfil in ('corretor', 'imobiliaria')
                and status = 'aprovado' and creci_ok and recebe_leads)
$$;

-- Sugestão dos parceiros mais próximos para o CEO escolher.
create or replace function public.sugerir_parceiros(p_lead uuid)
returns table (user_id uuid, nome text, perfil text, cidade text, uf text, nivel text, km numeric,
               ja_recebeu boolean, ultimo_lead_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uf text; v_cidade text; v_bairro text; m0 record;
begin
  if not public.sou_admin() then raise exception 'nao autorizado'; end if;
  select coalesce(l.uf, i.uf), coalesce(l.cidade, i.cidade), coalesce(l.bairro, i.bairro)
    into v_uf, v_cidade, v_bairro
    from leads l left join imoveis i on i.id = l.imovel_id where l.id = p_lead;
  select mm.latitude, mm.longitude into m0 from municipios mm
   where mm.uf = upper(v_uf) and mm.chave = chave_cidade(v_cidade) limit 1;
  return query
    select p.user_id, p.nome, p.perfil, p.cidade, p.uf,
           case
             when chave_cidade(p.cidade) = chave_cidade(v_cidade) and v_bairro is not null
                  and exists (select 1 from unnest(p.bairros_atuacao) b where chave_cidade(b) = chave_cidade(v_bairro)) then 'bairro'
             when chave_cidade(p.cidade) = chave_cidade(v_cidade) then 'cidade'
             else 'vizinha'
           end,
           case when m0.latitude is not null and m.latitude is not null then
             round((6371 * acos(least(1, cos(radians(m0.latitude)) * cos(radians(m.latitude))
               * cos(radians(m.longitude) - radians(m0.longitude))
               + sin(radians(m0.latitude)) * sin(radians(m.latitude)))))::numeric, 1)
           end,
           exists (select 1 from lead_ofertas o where o.lead_id = p_lead and o.corretor_id = p.user_id),
           p.ultimo_lead_em
      from perfis p
      left join municipios m on m.uf = upper(p.uf) and m.chave = chave_cidade(p.cidade)
     where p.perfil in ('corretor', 'imobiliaria') and p.status = 'aprovado' and p.creci_ok and p.recebe_leads
       and (v_uf is null or upper(p.uf) = upper(v_uf))
     order by
       case
         when chave_cidade(p.cidade) = chave_cidade(v_cidade) and v_bairro is not null
              and exists (select 1 from unnest(p.bairros_atuacao) b where chave_cidade(b) = chave_cidade(v_bairro)) then 0
         when chave_cidade(p.cidade) = chave_cidade(v_cidade) then 1 else 2 end,
       case when m0.latitude is null or m.latitude is null then 1e9
            else (m.latitude - m0.latitude) ^ 2 + ((m.longitude - m0.longitude) * cos(radians(m0.latitude))) ^ 2 end,
       p.ultimo_lead_em asc nulls first
     limit 30;
end $$;
revoke all on function public.sugerir_parceiros(uuid) from public, anon;
grant execute on function public.sugerir_parceiros(uuid) to authenticated;

-- O CEO encaminha o lead ao parceiro escolhido.
create or replace function public.encaminhar_lead(p_lead uuid, p_parceiro uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_min int := coalesce((select (valor ->> 'prazo_minutos')::int from config_portal where chave = 'rodizio'), 30);
  v_prazo timestamptz;
  v_nivel text;
begin
  if not public.sou_admin() then raise exception 'nao autorizado'; end if;
  if not public.parceiro_elegivel(p_parceiro) then raise exception 'parceiro nao elegivel'; end if;
  perform 1 from leads where id = p_lead and atendido_em is null for update;
  if not found then return false; end if;
  update lead_ofertas set status = 'devolvido', respondido_em = now()
   where lead_id = p_lead and status = 'aguardando';
  v_prazo := prazo_lead(v_min);
  select nivel into v_nivel from sugerir_parceiros(p_lead) s where s.user_id = p_parceiro;
  insert into lead_ofertas (lead_id, corretor_id, nivel, prazo_ate, encaminhado_por)
  values (p_lead, p_parceiro, coalesce(v_nivel, 'vizinha'), v_prazo, auth.uid());
  update leads set corretor_id = p_parceiro, trava_ate = v_prazo, distribuido_em = now(),
                   rodadas = rodadas + 1, status = 'encaminhado'
   where id = p_lead;
  update perfis set ultimo_lead_em = now() where user_id = p_parceiro;
  return true;
end $$;
revoke all on function public.encaminhar_lead(uuid, uuid) from public, anon;
grant execute on function public.encaminhar_lead(uuid, uuid) to authenticated;

-- O parceiro aceita o termo de indicação e assume o atendimento.
create or replace function public.aceitar_lead(p_lead uuid, p_versao text) returns boolean
language plpgsql security definer set search_path = public as $$
declare o record;
begin
  if p_versao is distinct from (select valor ->> 'versao' from config_portal where chave = 'termo_indicacao') then
    raise exception 'versao do termo desatualizada';
  end if;
  select * into o from lead_ofertas
   where lead_id = p_lead and corretor_id = auth.uid() and status = 'aguardando' and prazo_ate >= now()
   for update;
  if not found then return false; end if;
  update lead_ofertas set status = 'atendido', respondido_em = now(),
                          termo_versao = p_versao, termo_aceite_em = now()
   where id = o.id;
  update leads set atendido_em = now(), trava_ate = null, status = 'em_atendimento', etapa = 'contato'
   where id = p_lead;
  return true;
end $$;
revoke all on function public.aceitar_lead(uuid, text) from public, anon;
grant execute on function public.aceitar_lead(uuid, text) to authenticated;

-- No modo manual, o lead não sai sozinho: fica com o CEO.
create or replace function public.leads_rodizio_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.rodizio_manual() and new.interesse in ('visita', 'duvida') then
    perform distribuir_lead(new.id);
  end if;
  return null;
end $$;

-- Prazo vencido: no modo manual volta para o CEO; no automático vai para o próximo.
create or replace function public.redistribuir_leads_vencidos() returns int
language plpgsql security definer set search_path = public as $$
declare o record; n int := 0;
begin
  for o in
    select id, lead_id from lead_ofertas
     where status = 'aguardando' and prazo_ate < now()
     order by prazo_ate limit 200 for update skip locked
  loop
    update lead_ofertas set status = 'expirado', respondido_em = now() where id = o.id;
    if public.rodizio_manual() then
      update leads set corretor_id = null, trava_ate = null, status = 'novo'
       where id = o.lead_id and atendido_em is null;
    else
      perform distribuir_lead(o.lead_id);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- O rodízio automático (quando ligado) também passa a aceitar imobiliárias.
create or replace function public.rank_plano(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select case
    when (select perfil from perfis where user_id = p_user) = 'imobiliaria' then 4
    else case public.plano_ativo(p_user) when 'premium' then 3 when 'profissional' then 2
                                         when 'essencial' then 1 else 0 end
  end
$$;

-- 4. Regras do corretor parceiro grátis --------------------------------------------------------
--  * Parceiro (contrato aceito) não paga mensalidade enquanto estiver ativo.
--  * Ativo = fechou negócio nos últimos 3 meses, ou está dentro dos 3 primeiros meses da parceria,
--    ou ganhou o bônus de 1 ano por ter vendido um imóvel.
--  * 3 meses sem fechar nada: perde a gratuidade e é convidado a pagar a taxa de administração.
--  * Quem anuncia sozinho (sem parceria) paga a taxa de adesão e a mensalidade do plano.
insert into public.config_portal (chave, valor) values
  ('parceria_regras', '{"inatividade_meses": 3, "bonus_venda_meses": 12, "taxa_adesao": 50, "taxa_administracao": null}')
on conflict (chave) do nothing;

alter table public.perfis
  add column if not exists ultimo_fechamento_em timestamptz,
  add column if not exists gratis_ate timestamptz;

create or replace function public.parceria_ativa(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.parceria_aceite_em is not null and p.status = 'aprovado' and p.creci_ok and (
             p.gratis_ate > now()
          or p.ultimo_fechamento_em > now() - make_interval(months => r.meses)
          or p.parceria_aceite_em > now() - make_interval(months => r.meses))
      from perfis p,
           (select coalesce((valor ->> 'inatividade_meses')::int, 3) meses
              from config_portal where chave = 'parceria_regras') r
     where p.user_id = p_user), false)
$$;

create or replace function public.plano_ativo(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when perfil = 'admin' then 'premium'
    when plano <> 'gratis' and plano_ate > now() then plano
    when perfil in ('corretor', 'imobiliaria') and public.parceria_ativa(p_user) then 'profissional'
    else 'gratis' end
  from perfis where user_id = p_user
$$;

-- Venda registrada no feedback: conta como fechamento e garante mais 1 ano grátis.
create or replace function public.feedback_etapa() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_bonus int := coalesce((select (valor ->> 'bonus_venda_meses')::int from config_portal where chave = 'parceria_regras'), 12);
begin
  update leads set etapa = new.etapa,
                   status = case new.etapa when 'vendido' then 'vendido' when 'perdido' then 'perdido' else status end
   where id = new.lead_id;
  if new.etapa in ('vendido', 'proposta') then
    update perfis set ultimo_fechamento_em = now(),
                      gratis_ate = case when new.etapa = 'vendido'
                                        then greatest(coalesce(gratis_ate, now()), now()) + make_interval(months => v_bonus)
                                        else gratis_ate end
     where user_id = new.autor_id;
  end if;
  return null;
end $$;

-- Fechamentos registrados pelo CEO (serviço ou venda fora do sistema de leads).
create or replace function public.registrar_fechamento(p_user uuid, p_venda boolean, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare v_bonus int := coalesce((select (valor ->> 'bonus_venda_meses')::int from config_portal where chave = 'parceria_regras'), 12);
begin
  if not public.sou_admin() then raise exception 'nao autorizado'; end if;
  update perfis set ultimo_fechamento_em = now(),
                    gratis_ate = case when p_venda
                                      then greatest(coalesce(gratis_ate, now()), now()) + make_interval(months => v_bonus)
                                      else gratis_ate end
   where user_id = p_user;
  perform public.registrar_acao(case when p_venda then 'registrou venda' else 'registrou servico fechado' end,
                                p_user::text, p_nota);
end $$;
revoke all on function public.registrar_fechamento(uuid, boolean, text) from public, anon;
grant execute on function public.registrar_fechamento(uuid, boolean, text) to authenticated;

-- ===== 011_cadastro_seguro.sql =====
-- Cadastro mais seguro para todos os participantes: dois telefones (WhatsApp ou recado),
-- endereço completo com CEP, documento de identidade com foto e aceite da LGPD registrado.
alter table public.perfis
  add column if not exists telefone_1 text,
  add column if not exists telefone_1_whats boolean,
  add column if not exists telefone_2 text,
  add column if not exists telefone_2_whats boolean,
  add column if not exists cep text,
  add column if not exists numero text,
  add column if not exists complemento text,
  add column if not exists bairro text,
  add column if not exists doc_identidade_path text,
  add column if not exists lgpd_aceite_em timestamptz;

-- O aceite da LGPD não pode ser apagado nem antecipado pelo próprio usuário.
create or replace function public.perfis_protege_lgpd() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.lgpd_aceite_em is not null then
    new.lgpd_aceite_em := old.lgpd_aceite_em;
  elsif new.lgpd_aceite_em is not null and new.lgpd_aceite_em > now() + interval '5 minutes' then
    new.lgpd_aceite_em := now();
  end if;
  return new;
end $$;
drop trigger if exists perfis_protege_lgpd on public.perfis;
create trigger perfis_protege_lgpd before insert or update on public.perfis
  for each row execute function public.perfis_protege_lgpd();

-- ===== 012_publicidade_paga.sql =====
-- Publicidade paga do corretor: anúncio simples ou destaque, tabela de preços definida pelo CEO,
-- pagamento antes (pré-pago), aprovação e publicação pelo CEO, avisos de renovação e retirada.
-- Depende de 002, 009 e 010.
--
-- Fluxo:
--  1. O corretor logado escolhe os imóveis e, para cada um, simples ou destaque.
--  2. O banco calcula o valor pela tabela do CEO (nunca pelo navegador). Parceiro ativo não paga.
--  3. O corretor paga (Stripe). O webhook marca o pedido como pago.
--  4. O CEO confere e aprova: a publicação começa e conta 30 dias.
--  5. Avisos de renovação no 20º dia, 3 dias antes e no último dia. Sim: novo pedido com link de
--     pagamento. Não, ou sem resposta: o anúncio sai 2 dias depois do fim.

alter table public.portais add column if not exists preco_destaque numeric
  check (preco_destaque is null or preco_destaque >= 0);

alter table public.anuncio_pedidos
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists itens jsonb,
  add column if not exists gratuito boolean not null default false,
  add column if not exists pago_em timestamptz,
  add column if not exists pagamento_ref text,
  add column if not exists renovacao_de uuid references public.anuncio_pedidos(id) on delete set null,
  add column if not exists renovar boolean,
  add column if not exists avisos int not null default 0,
  add column if not exists ultimo_aviso_em timestamptz;

-- O corretor vê os próprios pedidos.
drop policy if exists anuncio_pedidos_dono on public.anuncio_pedidos;
create policy anuncio_pedidos_dono on public.anuncio_pedidos for select to authenticated
  using (user_id = auth.uid());

-- Pedido do corretor logado. p_itens = [{"imovel": "123", "tipo": "simples|destaque"}]
create or replace function public.criar_pedido_publicidade(p_itens jsonb, p_portais text[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  p record;
  v_itens jsonb := '[]'::jsonb;
  v_ids text[] := '{}';
  v_valor numeric := 0;
  v_sem_preco boolean := false;
  v_dias int := 30;
  v_portais text[];
  it jsonb;
  v_tipo text;
  v_gratis boolean;
  v_ped anuncio_pedidos;
begin
  if v_user is null then raise exception 'entre na sua conta'; end if;
  select * into p from perfis where user_id = v_user;
  if p.perfil not in ('corretor', 'imobiliaria', 'admin') or p.status <> 'aprovado' then
    raise exception 'so corretor ou imobiliaria aprovados';
  end if;
  select array_agg(slug), coalesce(max(dias), 30) into v_portais, v_dias
    from portais where ativo and slug = any(p_portais);
  if coalesce(cardinality(v_portais), 0) = 0 then raise exception 'escolha onde anunciar'; end if;

  for it in select * from jsonb_array_elements(p_itens) loop
    v_tipo := case when it ->> 'tipo' = 'destaque' then 'destaque' else 'simples' end;
    if exists (select 1 from imoveis where id = it ->> 'imovel' and ativo)
       and not (it ->> 'imovel') = any(v_ids) then
      v_ids := v_ids || (it ->> 'imovel');
      v_itens := v_itens || jsonb_build_object('imovel', it ->> 'imovel', 'tipo', v_tipo);
      select v_valor + coalesce(sum(case when v_tipo = 'destaque' then preco_destaque else preco_por_imovel end), 0),
             v_sem_preco or bool_or(case when v_tipo = 'destaque' then preco_destaque else preco_por_imovel end is null)
        into v_valor, v_sem_preco
        from portais where slug = any(v_portais);
    end if;
  end loop;
  if cardinality(v_ids) = 0 then raise exception 'escolha ao menos um imovel'; end if;
  if cardinality(v_ids) > 200 then raise exception 'no maximo 200 imoveis por pedido'; end if;

  v_gratis := public.parceria_ativa(v_user) or p.perfil = 'admin';
  insert into anuncio_pedidos (nome, email, telefone, perfil, creci, imoveis, portais, dias, valor,
                               consentimento, aceite_termo, user_id, itens, gratuito, status)
  values (coalesce(p.nome, 'Corretor'), p.email, coalesce(nullif(p.whatsapp, ''), '0000000000'),
          case when p.perfil = 'admin' then 'admin' else 'corretor' end, p.creci, v_ids, v_portais, v_dias,
          case when v_gratis then 0 when v_sem_preco then null else round(v_valor, 2) end,
          true, true, v_user, v_itens, v_gratis,
          case when v_gratis then 'pago' else 'aguardando_pagamento' end)
  returning * into v_ped;
  return jsonb_build_object('id', v_ped.id, 'codigo', v_ped.codigo, 'valor', v_ped.valor,
                            'gratuito', v_gratis, 'imoveis', cardinality(v_ids), 'dias', v_ped.dias);
end $$;
revoke all on function public.criar_pedido_publicidade(jsonb, text[]) from public, anon;
grant execute on function public.criar_pedido_publicidade(jsonb, text[]) to authenticated;

-- Webhook de pagamento (token em config_privado.billing_token, o mesmo das assinaturas).
create or replace function public.marcar_pedido_pago(p_token text, p_pedido uuid, p_ref text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  select valor into v_token from config_privado where chave = 'billing_token';
  if v_token is null or length(v_token) < 24 or p_token is distinct from v_token then
    raise exception 'nao autorizado';
  end if;
  update anuncio_pedidos set status = 'pago', pago_em = now(), pagamento_ref = p_ref
   where id = p_pedido and status = 'aguardando_pagamento';
  return found;
end $$;
revoke all on function public.marcar_pedido_pago(text, uuid, text) from public;
grant execute on function public.marcar_pedido_pago(text, uuid, text) to anon, authenticated;

-- Resposta do corretor ao aviso de renovação. Sim: cria o pedido novo para pagamento.
create or replace function public.responder_renovacao(p_pedido uuid, p_renovar boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v anuncio_pedidos; r jsonb;
begin
  select * into v from anuncio_pedidos where id = p_pedido and user_id = auth.uid() and status = 'aprovado';
  if not found then raise exception 'pedido nao encontrado'; end if;
  update anuncio_pedidos set renovar = p_renovar where id = p_pedido;
  if not p_renovar then return jsonb_build_object('renovar', false); end if;
  r := public.criar_pedido_publicidade(coalesce(v.itens,
         (select jsonb_agg(jsonb_build_object('imovel', x, 'tipo', 'simples')) from unnest(v.imoveis) x)),
       v.portais);
  update anuncio_pedidos set renovacao_de = p_pedido where id = (r ->> 'id')::uuid;
  return r || jsonb_build_object('renovar', true);
end $$;
revoke all on function public.responder_renovacao(uuid, boolean) from public, anon;
grant execute on function public.responder_renovacao(uuid, boolean) to authenticated;

-- Pedido renovado e pago/aprovado emenda no fim do anterior (sem perder dias).
create or replace function public.anuncio_pedidos_prazo() returns trigger
language plpgsql set search_path = public as $$
declare v_fim_anterior timestamptz;
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    if new.renovacao_de is not null then
      select fim into v_fim_anterior from anuncio_pedidos where id = new.renovacao_de;
    end if;
    new.inicio := coalesce(new.inicio, greatest(now(), coalesce(v_fim_anterior, now())));
    new.fim := coalesce(new.fim, new.inicio + make_interval(days => new.dias));
  end if;
  new.atualizado := now();
  return new;
end $$;

-- O anúncio continua no feed até 2 dias depois do fim (prazo para renovar).
create or replace function public.feed_portal(p_portal text)
returns setof imoveis
language sql stable security definer set search_path = public as $$
  select distinct on (i.id) i.*
  from anuncio_pedidos p
  join imoveis i on i.id = any(p.imoveis) and i.ativo
  where p.status = 'aprovado' and p_portal = any(p.portais)
    and (p.inicio is null or p.inicio <= now())
    and (p.fim is null or p.fim + interval '2 days' > now())
$$;

-- Avisos dentro do sistema (painel do corretor) e fila de e-mail.
create table if not exists public.notificacoes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  titulo text not null,
  texto text not null,
  link text,
  lida boolean not null default false,
  email_enviado boolean not null default false,
  criado timestamptz not null default now()
);
create index if not exists notificacoes_user on public.notificacoes (user_id, lida, criado desc);
alter table public.notificacoes enable row level security;
drop policy if exists notificacoes_le on public.notificacoes;
create policy notificacoes_le on public.notificacoes for select to authenticated
  using (user_id = auth.uid() or public.sou_admin());
drop policy if exists notificacoes_marca on public.notificacoes;
create policy notificacoes_marca on public.notificacoes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Roda todo dia: avisa 3 vezes (20º dia, 3 dias antes, último dia) e encerra 2 dias após o fim.
create or replace function public.ciclo_publicidade() returns int
language plpgsql security definer set search_path = public as $$
declare v record; n int := 0; v_dias_rest numeric;
begin
  for v in select * from anuncio_pedidos where status = 'aprovado' and fim is not null loop
    v_dias_rest := extract(epoch from (v.fim - now())) / 86400;
    if v.user_id is not null and v.renovar is null and (
         (v.avisos = 0 and v_dias_rest <= 10) or
         (v.avisos = 1 and v_dias_rest <= 3) or
         (v.avisos = 2 and v_dias_rest <= 0.5)) then
      insert into notificacoes (user_id, titulo, texto, link)
      values (v.user_id, 'Renovar a publicidade?',
              format('O pedido %s (%s imóveis) termina em %s. Quer renovar por mais %s dias?',
                     v.codigo, cardinality(v.imoveis), to_char(v.fim at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), v.dias),
              '/corretores/painel#publicidade');
      update anuncio_pedidos set avisos = avisos + 1, ultimo_aviso_em = now() where id = v.id;
      n := n + 1;
    end if;
    if now() > v.fim + interval '2 days' then
      update anuncio_pedidos set status = 'expirado' where id = v.id;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.ciclo_publicidade() from public, anon, authenticated;

do $$ begin
  perform cron.schedule('ciclo-publicidade', '7 11 * * *', 'select public.ciclo_publicidade()');
exception when others then null; end $$;

-- Fila de e-mails para o servidor enviar (chamada pela rota protegida do site).
create or replace function public.notificacoes_pendentes(p_token text)
returns table (id bigint, email text, nome text, titulo text, texto text, link text)
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  select valor into v_token from config_privado where chave = 'billing_token';
  if v_token is null or length(v_token) < 24 or p_token is distinct from v_token then
    raise exception 'nao autorizado';
  end if;
  return query
    select n.id, p.email, p.nome, n.titulo, n.texto, n.link
      from notificacoes n join perfis p on p.user_id = n.user_id
     where not n.email_enviado and p.email is not null
     order by n.id limit 100;
end $$;
revoke all on function public.notificacoes_pendentes(text) from public;
grant execute on function public.notificacoes_pendentes(text) to anon, authenticated;

create or replace function public.notificacao_enviada(p_token text, p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  select valor into v_token from config_privado where chave = 'billing_token';
  if v_token is null or length(v_token) < 24 or p_token is distinct from v_token then
    raise exception 'nao autorizado';
  end if;
  update notificacoes set email_enviado = true where id = p_id;
end $$;
revoke all on function public.notificacao_enviada(text, bigint) from public;
grant execute on function public.notificacao_enviada(text, bigint) to anon, authenticated;

do $$ begin
  drop trigger if exists auditar on public.anuncio_pedidos;
  create trigger auditar after insert or update or delete on public.anuncio_pedidos
    for each row execute function public.auditar();
  drop trigger if exists auditar on public.portais;
  create trigger auditar after insert or update or delete on public.portais
    for each row execute function public.auditar();
end $$;

-- ===== 013_selo_verde_verificacoes.sql =====
-- Cadastro do corretor só com CRECI ativo (foto do CRECI). O Selo Verde passa a ser uma
-- verificação opcional (CRECI ativo conferido e sem pendência criminal), mostrada na página
-- do corretor, junto com "e-mail verificado", "WhatsApp verificado" (no CPF do corretor) e
-- "redes verificadas". Só o CEO marca as verificações.
alter table public.perfis
  add column if not exists bio text check (bio is null or char_length(bio) <= 1500),
  add column if not exists atua_desde int check (atua_desde is null or atua_desde between 1950 and 2100),
  add column if not exists selo_verde boolean not null default false,
  add column if not exists email_verificado boolean not null default false,
  add column if not exists whatsapp_verificado boolean not null default false,
  add column if not exists redes_verificadas boolean not null default false;

create or replace function public.perfis_protege_verificacoes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.sou_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.selo_verde := false; new.email_verificado := false;
    new.whatsapp_verificado := false; new.redes_verificadas := false;
  else
    new.selo_verde := old.selo_verde;
    -- Trocou o dado, perde a verificação daquele dado.
    new.email_verificado := old.email_verificado and new.email is not distinct from old.email;
    new.whatsapp_verificado := old.whatsapp_verificado and new.whatsapp is not distinct from old.whatsapp;
    new.redes_verificadas := old.redes_verificadas and new.redes is not distinct from old.redes;
  end if;
  return new;
end $$;
drop trigger if exists perfis_protege_verificacoes on public.perfis;
create trigger perfis_protege_verificacoes before insert or update on public.perfis
  for each row execute function public.perfis_protege_verificacoes();

-- Página pública com história, tempo de mercado, bairros e selos.
drop function if exists public.corretor_publico(text);
create or replace function public.corretor_publico(p_slug text)
returns table (slug text, nome text, creci text, creci_uf text, whatsapp text, cidade text, uf text,
               foto_path text, perfil text, redes jsonb, bio text, atua_desde int, bairros text[],
               email text, selo_verde boolean, email_verificado boolean, whatsapp_verificado boolean,
               redes_verificadas boolean)
language sql stable security definer set search_path = public as $$
  select slug, nome, creci, creci_uf, whatsapp, cidade, uf, foto_path, perfil, redes, bio, atua_desde,
         bairros_atuacao, email, selo_verde, email_verificado, whatsapp_verificado, redes_verificadas
  from perfis
  where slug = p_slug and status = 'aprovado' and creci_ok and perfil in ('corretor', 'imobiliaria', 'investidor')
$$;
revoke all on function public.corretor_publico(text) from public;
grant execute on function public.corretor_publico(text) to anon, authenticated;

-- ===== 014_crm_tarefas_agenda.sql =====
-- CRM interno de cada usuário (corretor, imobiliária, investidor, CEO e equipe): quadro Kanban
-- de tarefas e a agenda do Google de cada um (separada; ninguém vê a de outro).
create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  dono_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titulo text not null check (char_length(titulo) between 2 and 160),
  detalhe text check (detalhe is null or char_length(detalhe) <= 2000),
  coluna text not null default 'a_fazer' check (coluna in ('a_fazer', 'fazendo', 'feito')),
  etiqueta text check (etiqueta is null or char_length(etiqueta) <= 30),
  prazo timestamptz,
  lead_id uuid references public.leads(id) on delete set null,
  ordem int not null default 0,
  criado timestamptz not null default now(),
  atualizado timestamptz not null default now()
);
create index if not exists tarefas_dono on public.tarefas (dono_id, coluna, ordem);
alter table public.tarefas enable row level security;
drop policy if exists tarefas_dono on public.tarefas;
create policy tarefas_dono on public.tarefas for all to authenticated
  using (dono_id = auth.uid()) with check (dono_id = auth.uid());

-- Agenda do Google de cada usuário (ID ou e-mail da agenda), para mostrar no painel.
alter table public.perfis add column if not exists agenda_google text
  check (agenda_google is null or char_length(agenda_google) <= 200);

-- ===== 015_radar_selecoes.sql =====
-- Radar de oportunidades (filtros salvos por usuário) e seleções compartilháveis:
-- o usuário marca imóveis e gera um link público com a cara dele (foto, nome, CRECI, WhatsApp).
create table if not exists public.radares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null default 'Meu radar' check (char_length(nome) between 2 and 60),
  criterios jsonb not null default '{}'::jsonb,
  criado timestamptz not null default now()
);
create index if not exists radares_user on public.radares (user_id);
alter table public.radares enable row level security;
drop policy if exists radares_dono on public.radares;
create policy radares_dono on public.radares for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.selecoes (
  codigo text primary key default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titulo text not null default 'Oportunidades selecionadas' check (char_length(titulo) between 2 and 120),
  mensagem text check (mensagem is null or char_length(mensagem) <= 600),
  imoveis text[] not null check (cardinality(imoveis) between 1 and 60),
  criado timestamptz not null default now()
);
alter table public.selecoes enable row level security;
drop policy if exists selecoes_dono on public.selecoes;
create policy selecoes_dono on public.selecoes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Página pública da seleção: imóveis ativos + dados de vitrine de quem compartilhou.
create or replace function public.selecao_publica(p_codigo text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'titulo', s.titulo,
    'mensagem', s.mensagem,
    'imoveis', s.imoveis,
    'criado', s.criado,
    'autor', jsonb_build_object(
      'nome', p.nome, 'perfil', p.perfil, 'creci', p.creci, 'creci_uf', p.creci_uf,
      'whatsapp', p.whatsapp, 'foto_path', p.foto_path, 'slug', p.slug,
      'verificado', coalesce(p.selo_verde, false)))
  from selecoes s join perfis p on p.user_id = s.user_id
  where s.codigo = p_codigo and p_codigo ~ '^[a-z0-9]{6,20}$'
$$;
revoke all on function public.selecao_publica(text) from public;
grant execute on function public.selecao_publica(text) to anon, authenticated;

-- ===== 016_configuracoes_ceo.sql =====
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

-- ===== 017_plano_anuncio_proprietario.sql =====
-- 017: plano de anúncio do proprietário (sem corretor), publicado no site para compradores.
-- Depende de 008 (imoveis_avulsos), 009 (auditar), 010/016 (config_portal) e 012 (notificacoes).
--
-- Fluxo:
--  1. O proprietário cadastra o imóvel (grátis) e pede o plano. O preço e os dias vêm da
--     configuração do CEO (config_portal.plano_anuncio_proprietario), nunca do navegador.
--  2. Paga (Stripe) ou combina o PIX com a equipe; o CEO pode marcar como pago.
--  3. Com o pagamento e o anúncio aprovado, o plano começa a contar e o imóvel aparece em
--     /imoveis-a-venda, com o nome e o telefone que o proprietário autorizou mostrar.
--  4. Avisos de renovação a 10 dias, 3 dias e no último dia. Renovou: o novo período emenda no fim
--     do anterior. Não renovou: o anúncio sai do site 2 dias depois do fim.

create sequence if not exists public.avulsos_planos_seq;

create table if not exists public.avulsos_planos (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null
    default 'PA-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.avulsos_planos_seq')::text, 5, '0'),
  avulso_id uuid not null references public.imoveis_avulsos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  valor numeric not null check (valor >= 0),
  dias int not null check (dias between 1 and 365),
  status text not null default 'aguardando_pagamento'
    check (status in ('aguardando_pagamento', 'pago', 'ativo', 'expirado', 'cancelado')),
  aceite_publico_em timestamptz not null default now(),
  pago_em timestamptz,
  pagamento_ref text,
  inicio timestamptz,
  fim timestamptz,
  avisos int not null default 0,
  ultimo_aviso_em timestamptz,
  renovar boolean,
  renovacao_de uuid references public.avulsos_planos(id) on delete set null,
  criado timestamptz not null default now(),
  atualizado timestamptz not null default now()
);
create index if not exists avulsos_planos_avulso on public.avulsos_planos (avulso_id, status);
create index if not exists avulsos_planos_ativos on public.avulsos_planos (status, fim);

alter table public.avulsos_planos enable row level security;
drop policy if exists avulsos_planos_le on public.avulsos_planos;
create policy avulsos_planos_le on public.avulsos_planos for select to authenticated
  using (user_id = auth.uid() or public.sou_admin());
drop policy if exists avulsos_planos_admin on public.avulsos_planos;
create policy avulsos_planos_admin on public.avulsos_planos for update to authenticated
  using (public.sou_admin()) with check (public.sou_admin());

-- Começa a contar os planos pagos de um anúncio aprovado (emendando no período anterior).
create or replace function public.ativar_planos_avulso(p_avulso uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v record; v_ini timestamptz; n int := 0;
begin
  if not exists (select 1 from imoveis_avulsos where id = p_avulso and status = 'aprovado') then
    return 0;
  end if;
  for v in select * from avulsos_planos where avulso_id = p_avulso and status = 'pago' order by pago_em loop
    select max(fim) into v_ini from avulsos_planos
     where avulso_id = p_avulso and status = 'ativo' and fim > now();
    v_ini := greatest(now(), coalesce(v_ini, now()));
    update avulsos_planos
       set status = 'ativo', inicio = v_ini, fim = v_ini + make_interval(days => dias), atualizado = now()
     where id = v.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.ativar_planos_avulso(uuid) from public, anon, authenticated;

-- Quando o CEO aprova o anúncio, o plano já pago entra no ar.
create or replace function public.avulsos_aprovado_ativa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    perform public.ativar_planos_avulso(new.id);
  end if;
  return null;
end $$;
drop trigger if exists avulsos_aprovado_ativa on public.imoveis_avulsos;
create trigger avulsos_aprovado_ativa after update on public.imoveis_avulsos
  for each row execute function public.avulsos_aprovado_ativa();

-- Pedido do plano pelo dono do anúncio. Reaproveita o pedido em aberto, se houver.
create or replace function public.criar_plano_avulso(p_avulso uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a imoveis_avulsos;
  c jsonb := (select valor from config_portal where chave = 'plano_anuncio_proprietario');
  v_preco numeric := coalesce((c ->> 'preco')::numeric, 99.9);
  v_dias int := coalesce((c ->> 'dias')::int, 60);
  v avulsos_planos;
  v_ant uuid;
begin
  select * into a from imoveis_avulsos where id = p_avulso;
  if not found or a.dono_id is distinct from auth.uid() then raise exception 'anuncio nao encontrado'; end if;
  if a.status in ('recusado', 'vendido') then raise exception 'anuncio recusado ou vendido'; end if;
  if v_preco <= 0 or v_dias <= 0 then raise exception 'plano sem preco definido'; end if;

  select * into v from avulsos_planos where avulso_id = p_avulso and status = 'aguardando_pagamento'
   order by criado desc limit 1;
  if found then
    return jsonb_build_object('id', v.id, 'codigo', v.codigo, 'valor', v.valor, 'dias', v.dias);
  end if;

  select id into v_ant from avulsos_planos where avulso_id = p_avulso and status = 'ativo'
   order by fim desc limit 1;
  insert into avulsos_planos (avulso_id, user_id, valor, dias, renovacao_de)
  values (p_avulso, auth.uid(), round(v_preco, 2), v_dias, v_ant)
  returning * into v;
  return jsonb_build_object('id', v.id, 'codigo', v.codigo, 'valor', v.valor, 'dias', v.dias);
end $$;
revoke all on function public.criar_plano_avulso(uuid) from public, anon;
grant execute on function public.criar_plano_avulso(uuid) to authenticated;

-- Webhook da Stripe (mesmo token das assinaturas).
create or replace function public.marcar_plano_avulso_pago(p_token text, p_plano uuid, p_ref text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_token text; v_avulso uuid;
begin
  select valor into v_token from config_privado where chave = 'billing_token';
  if v_token is null or length(v_token) < 24 or p_token is distinct from v_token then
    raise exception 'nao autorizado';
  end if;
  update avulsos_planos set status = 'pago', pago_em = now(), pagamento_ref = p_ref, atualizado = now()
   where id = p_plano and status = 'aguardando_pagamento'
  returning avulso_id into v_avulso;
  if v_avulso is null then return false; end if;
  perform public.ativar_planos_avulso(v_avulso);
  return true;
end $$;
revoke all on function public.marcar_plano_avulso_pago(text, uuid, text) from public;
grant execute on function public.marcar_plano_avulso_pago(text, uuid, text) to anon, authenticated;

-- CEO: pagamento recebido fora do site (PIX, transferência) ou cortesia.
create or replace function public.ceo_plano_avulso_pago(p_plano uuid, p_ref text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_avulso uuid;
begin
  if not public.sou_admin() then raise exception 'nao autorizado'; end if;
  update avulsos_planos
     set status = 'pago', pago_em = now(), pagamento_ref = coalesce(nullif(trim(p_ref), ''), 'manual'),
         atualizado = now()
   where id = p_plano and status = 'aguardando_pagamento'
  returning avulso_id into v_avulso;
  if v_avulso is null then return false; end if;
  perform public.ativar_planos_avulso(v_avulso);
  return true;
end $$;
revoke all on function public.ceo_plano_avulso_pago(uuid, text) from public, anon;
grant execute on function public.ceo_plano_avulso_pago(uuid, text) to authenticated;

-- Resposta do proprietário ao aviso de renovação.
create or replace function public.responder_renovacao_avulso(p_plano uuid, p_renovar boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v avulsos_planos;
begin
  select * into v from avulsos_planos where id = p_plano and user_id = auth.uid() and status = 'ativo';
  if not found then raise exception 'plano nao encontrado'; end if;
  update avulsos_planos set renovar = p_renovar, atualizado = now() where id = p_plano;
  if not p_renovar then return jsonb_build_object('renovar', false); end if;
  return public.criar_plano_avulso(v.avulso_id) || jsonb_build_object('renovar', true);
end $$;
revoke all on function public.responder_renovacao_avulso(uuid, boolean) from public, anon;
grant execute on function public.responder_renovacao_avulso(uuid, boolean) to authenticated;

-- Todo dia: 3 avisos e encerramento 2 dias após o fim.
create or replace function public.ciclo_planos_avulsos() returns int
language plpgsql security definer set search_path = public as $$
declare v record; n int := 0; v_rest numeric; v_titulo text;
begin
  for v in select p.*, a.titulo as anuncio from avulsos_planos p join imoveis_avulsos a on a.id = p.avulso_id
            where p.status = 'ativo' and p.fim is not null loop
    v_rest := extract(epoch from (v.fim - now())) / 86400;
    if v.renovar is null
       and not exists (select 1 from avulsos_planos x where x.renovacao_de = v.id and x.status <> 'cancelado')
       and ((v.avisos = 0 and v_rest <= 10) or (v.avisos = 1 and v_rest <= 3) or (v.avisos = 2 and v_rest <= 0.5)) then
      v_titulo := left(v.anuncio, 60);
      insert into notificacoes (user_id, titulo, texto, link)
      values (v.user_id, 'Renovar o anúncio do seu imóvel?',
              format('O anúncio "%s" fica no site até %s. Quer renovar por mais %s dias?',
                     v_titulo, to_char(v.fim at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), v.dias),
              '/anuncie-gratis#meus-anuncios');
      update avulsos_planos set avisos = avisos + 1, ultimo_aviso_em = now() where id = v.id;
      n := n + 1;
    end if;
    if now() > v.fim + interval '2 days' then
      update avulsos_planos set status = 'expirado', atualizado = now() where id = v.id;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.ciclo_planos_avulsos() from public, anon, authenticated;

do $$ begin
  perform cron.schedule('ciclo-planos-avulsos', '17 11 * * *', 'select public.ciclo_planos_avulsos()');
exception when others then null; end $$;

-- Vitrine pública: só anúncio aprovado com plano no ar. Sem endereço completo.
create or replace function public.avulsos_publicos(p_uf text default null, p_cidade text default null,
                                                   p_id uuid default null)
returns table (id uuid, tipo text, titulo text, descricao text, preco numeric, uf text, cidade text,
               bairro text, quartos int, vagas int, area numeric, fotos text[], contato_nome text,
               contato_telefone text, no_ar_ate timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.tipo, a.titulo, a.descricao, a.preco, a.uf, a.cidade, a.bairro, a.quartos, a.vagas,
         a.area, a.fotos, a.contato_nome, a.contato_telefone, max(p.fim) + interval '2 days'
    from imoveis_avulsos a
    join avulsos_planos p on p.avulso_id = a.id and p.status = 'ativo'
   where a.status = 'aprovado'
     and p.inicio <= now() and p.fim + interval '2 days' > now()
     and (p_uf is null or a.uf = upper(p_uf))
     and (p_cidade is null or a.cidade ilike p_cidade)
     and (p_id is null or a.id = p_id)
   group by a.id
   order by min(p.inicio) desc
   limit 300
$$;
revoke all on function public.avulsos_publicos(text, text, uuid) from public;
grant execute on function public.avulsos_publicos(text, text, uuid) to anon, authenticated;

-- E-mail dos avisos: usa o e-mail do login quando o perfil não tem e-mail.
create or replace function public.notificacoes_pendentes(p_token text)
returns table (id bigint, email text, nome text, titulo text, texto text, link text)
language plpgsql security definer set search_path = public, auth as $$
declare v_token text;
begin
  select valor into v_token from config_privado where chave = 'billing_token';
  if v_token is null or length(v_token) < 24 or p_token is distinct from v_token then
    raise exception 'nao autorizado';
  end if;
  return query
    select n.id, coalesce(nullif(p.email, ''), u.email)::text, p.nome, n.titulo, n.texto, n.link
      from notificacoes n
      join auth.users u on u.id = n.user_id
      left join perfis p on p.user_id = n.user_id
     where not n.email_enviado and coalesce(nullif(p.email, ''), u.email) is not null
     order by n.id limit 100;
end $$;
revoke all on function public.notificacoes_pendentes(text) from public;
grant execute on function public.notificacoes_pendentes(text) to anon, authenticated;

do $$ begin
  drop trigger if exists auditar on public.avulsos_planos;
  create trigger auditar after insert or update or delete on public.avulsos_planos
    for each row execute function public.auditar();
end $$;

-- ===== 018_alugar_vender_calculadora.sql =====
-- 018: anúncio para vender ou alugar, vitrine pública por finalidade e calculadora de preço.
-- Depende de 008, 016 e 017.

alter table public.imoveis_avulsos
  add column if not exists finalidade text not null default 'venda',
  add column if not exists valor_condominio numeric check (valor_condominio is null or valor_condominio >= 0),
  add column if not exists valor_iptu numeric check (valor_iptu is null or valor_iptu >= 0);
do $$ begin
  alter table public.imoveis_avulsos add constraint imoveis_avulsos_finalidade_check
    check (finalidade in ('venda', 'aluguel'));
exception when duplicate_object then null; end $$;

-- Comparação de cidade sem acento e sem diferença de maiúscula (sem depender da extensão unaccent).
create or replace function public.unaccent_ci(t text) returns text
language sql immutable as $$
  select lower(translate(coalesce(t, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'))
$$;

-- Vitrine pública com finalidade (venda ou aluguel) e filtros simples.
drop function if exists public.avulsos_publicos(text, text, uuid);
create or replace function public.avulsos_publicos(
  p_uf text default null, p_cidade text default null, p_id uuid default null,
  p_finalidade text default null, p_quartos int default null)
returns table (id uuid, finalidade text, tipo text, titulo text, descricao text, preco numeric,
               valor_condominio numeric, valor_iptu numeric, uf text, cidade text, bairro text,
               quartos int, vagas int, area numeric, fotos text[], contato_nome text,
               contato_telefone text, no_ar_ate timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.finalidade, a.tipo, a.titulo, a.descricao, a.preco, a.valor_condominio, a.valor_iptu,
         a.uf, a.cidade, a.bairro, a.quartos, a.vagas, a.area, a.fotos, a.contato_nome,
         a.contato_telefone, max(p.fim) + interval '2 days'
    from imoveis_avulsos a
    join avulsos_planos p on p.avulso_id = a.id and p.status = 'ativo'
   where a.status = 'aprovado'
     and p.inicio <= now() and p.fim + interval '2 days' > now()
     and (p_uf is null or a.uf = upper(p_uf))
     and (p_cidade is null or unaccent_ci(a.cidade) = unaccent_ci(p_cidade))
     and (p_id is null or a.id = p_id)
     and (p_finalidade is null or a.finalidade = p_finalidade)
     and (p_quartos is null or a.quartos >= p_quartos)
   group by a.id
   order by min(p.inicio) desc
   limit 300
$$;

revoke all on function public.avulsos_publicos(text, text, uuid, text, int) from public;
grant execute on function public.avulsos_publicos(text, text, uuid, text, int) to anon, authenticated;

-- Premissas da calculadora, editáveis pelo CEO em Configurações.
insert into public.config_portal (chave, valor) values
  ('calculadora', '{"aluguel_min_pct": 0.4, "aluguel_max_pct": 0.6, "minimo_amostras": 5}')
on conflict (chave) do nothing;

-- Valor do m² pelas avaliações dos imóveis de leilão ativos na região: bairro, depois cidade,
-- depois estado. Só devolve agregados (mediana e quartis), nunca imóvel por imóvel.
create or replace function public.estimar_m2(p_uf text, p_cidade text default null,
                                             p_bairro text default null, p_tipo text default null)
returns table (escopo text, amostras int, m2_p25 numeric, m2_mediana numeric, m2_p75 numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_min int := greatest(coalesce((select (valor ->> 'minimo_amostras')::int from config_portal
                                   where chave = 'calculadora'), 5), 3);
  v_tipo text := nullif(split_part(trim(coalesce(p_tipo, '')), ' ', 1), '');
  r record;
begin
  for r in
    select * from (values
      (1, 'bairro', true, true, true), (2, 'bairro', true, true, false),
      (3, 'cidade', true, false, true), (4, 'cidade', true, false, false),
      (5, 'estado', false, false, true), (6, 'estado', false, false, false)) as e(ord, nome, usa_cidade, usa_bairro, usa_tipo)
    order by ord
  loop
    if r.usa_bairro and nullif(trim(coalesce(p_bairro, '')), '') is null then continue; end if;
    if r.usa_cidade and nullif(trim(coalesce(p_cidade, '')), '') is null then continue; end if;
    if r.usa_tipo and v_tipo is null then continue; end if;
    return query
      with base as (
        select (i.avaliacao::numeric / nullif(coalesce(nullif(i.area_privativa::numeric, 0), i.area_total::numeric), 0)) as m2
          from imoveis i
         where i.ativo
           and i.uf = upper(p_uf)
           and (not r.usa_cidade or unaccent_ci(i.cidade) = unaccent_ci(p_cidade))
           and (not r.usa_bairro or unaccent_ci(i.bairro) = unaccent_ci(p_bairro))
           and (not r.usa_tipo or i.tipo ilike v_tipo || '%')
           and coalesce(nullif(i.area_privativa::numeric, 0), i.area_total::numeric) between 15 and 3000
           and i.avaliacao::numeric > 0
      ), ok as (select m2 from base where m2 between 200 and 60000)
      select r.nome || case when r.usa_tipo then ' e tipo' else '' end, count(*)::int,
             round(percentile_cont(0.25) within group (order by m2)::numeric, 2),
             round(percentile_cont(0.5) within group (order by m2)::numeric, 2),
             round(percentile_cont(0.75) within group (order by m2)::numeric, 2)
        from ok
      having count(*) >= v_min;
    if found then return; end if;
  end loop;
end $$;
revoke all on function public.estimar_m2(text, text, text, text) from public;
grant execute on function public.estimar_m2(text, text, text, text) to anon, authenticated;

-- ===== 019_crm_alertas.sql =====
-- 019: alertas do CRM. Nenhum cliente fica esperando e nenhum prazo passa sem aviso.
-- Depende de 006, 009, 010, 012 (notificacoes) e 014 (tarefas).
--
-- O que dispara alerta (a cada 10 minutos):
--  * Lead parado na central sem encaminhar            -> CEO.
--  * Parceiro aceitou e não registrou o 1º contato    -> parceiro; se continuar, CEO.
--  * Data de retorno ao cliente vencida               -> parceiro; se continuar, CEO.
--  * Chamado de suporte sem resposta da equipe        -> equipe; se continuar, CEO.
--  * Tarefa do Kanban perto de vencer e atrasada      -> dono da tarefa.
-- Os prazos ficam em config_portal.crm_alertas e o CEO muda em Configurações.

insert into public.config_portal (chave, valor) values
  ('crm_alertas', '{"central_minutos": 30, "primeiro_contato_horas": 2, "retorno_horas": 48,
                    "escalar_horas": 24, "chamado_horas": 4, "lembrete_tarefa_minutos": 60}')
on conflict (chave) do nothing;

alter table public.notificacoes
  add column if not exists tipo text not null default 'aviso',
  add column if not exists urgente boolean not null default false,
  add column if not exists referencia text;
create index if not exists notificacoes_ref on public.notificacoes (user_id, tipo, referencia);

alter table public.leads
  add column if not exists ultimo_contato_em timestamptz,
  add column if not exists proximo_contato_em timestamptz,
  add column if not exists alerta_parceiro_em timestamptz,
  add column if not exists alerta_ceo_em timestamptz;

alter table public.tarefas
  add column if not exists prioridade text not null default 'normal',
  add column if not exists lembrete_em timestamptz,
  add column if not exists atraso_em timestamptz;
do $$ begin
  alter table public.tarefas add constraint tarefas_prioridade_check
    check (prioridade in ('normal', 'alta', 'urgente'));
exception when duplicate_object then null; end $$;

-- Prazo mudou: o aviso volta a valer.
create or replace function public.tarefas_rearma_alerta() returns trigger
language plpgsql as $$
begin
  if new.prazo is distinct from old.prazo then
    new.lembrete_em := null; new.atraso_em := null;
  end if;
  new.atualizado := now();
  return new;
end $$;
drop trigger if exists tarefas_rearma_alerta on public.tarefas;
create trigger tarefas_rearma_alerta before update on public.tarefas
  for each row execute function public.tarefas_rearma_alerta();

-- Feedback do parceiro: registra o contato e agenda o próximo retorno.
alter table public.lead_feedbacks add column if not exists proximo_contato_em timestamptz;

create or replace function public.feedback_agenda_retorno() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_h int := coalesce((select (valor ->> 'retorno_horas')::int from config_portal where chave = 'crm_alertas'), 48);
begin
  update leads
     set ultimo_contato_em = new.criado,
         proximo_contato_em = case when new.etapa in ('vendido', 'perdido') then null
                                   else coalesce(new.proximo_contato_em, new.criado + make_interval(hours => v_h)) end,
         alerta_parceiro_em = null, alerta_ceo_em = null
   where id = new.lead_id;
  return null;
end $$;
drop trigger if exists feedback_agenda_retorno on public.lead_feedbacks;
create trigger feedback_agenda_retorno after insert on public.lead_feedbacks
  for each row execute function public.feedback_agenda_retorno();

-- Aviso sem repetição: o mesmo alerta (tipo + referência) só sai uma vez a cada 12 horas.
create or replace function public.avisar(p_user uuid, p_tipo text, p_ref text, p_titulo text, p_texto text,
                                         p_link text, p_urgente boolean default true) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return false; end if;
  if exists (select 1 from notificacoes where user_id = p_user and tipo = p_tipo and referencia = p_ref
              and criado > now() - interval '12 hours') then
    return false;
  end if;
  insert into notificacoes (user_id, tipo, referencia, titulo, texto, link, urgente)
  values (p_user, p_tipo, p_ref, p_titulo, p_texto, p_link, p_urgente);
  return true;
end $$;
revoke all on function public.avisar(uuid, text, text, text, text, text, boolean) from public, anon, authenticated;

create or replace function public.ciclo_alertas_crm() returns int
language plpgsql security definer set search_path = public as $$
declare
  c jsonb := coalesce((select valor from config_portal where chave = 'crm_alertas'), '{}'::jsonb);
  v_central int := coalesce((c ->> 'central_minutos')::int, 30);
  v_primeiro int := coalesce((c ->> 'primeiro_contato_horas')::int, 2);
  v_escalar int := coalesce((c ->> 'escalar_horas')::int, 24);
  v_chamado int := coalesce((c ->> 'chamado_horas')::int, 4);
  v_lembrete int := coalesce((c ->> 'lembrete_tarefa_minutos')::int, 60);
  l record; t record; ch record; adm uuid; n int := 0; v_venc timestamptz; v_parc text;
begin
  -- 1. Lead parado na central.
  for l in select * from leads
            where status = 'novo' and corretor_id is null
              and criado < now() - make_interval(mins => v_central) loop
    for adm in select user_id from perfis where perfil = 'admin' loop
      if avisar(adm, 'lead_central', l.id::text, 'Cliente esperando na central',
                format('%s chegou há %s e ainda não foi encaminhado a um parceiro.',
                       coalesce(l.nome, 'Cliente'), to_char(now() - l.criado, 'HH24"h"MI')),
                '/gestao/leads') then n := n + 1; end if;
    end loop;
  end loop;

  -- 2 e 3. Parceiro sem primeiro contato ou com retorno vencido.
  for l in select * from leads
            where status = 'em_atendimento' and corretor_id is not null and atendido_em is not null loop
    v_venc := coalesce(l.proximo_contato_em,
                       case when l.ultimo_contato_em is null then l.atendido_em + make_interval(hours => v_primeiro) end);
    continue when v_venc is null or v_venc > now();
    if l.alerta_parceiro_em is null then
      perform avisar(l.corretor_id, 'lead_retorno', l.id::text,
                     case when l.ultimo_contato_em is null then 'Fale com o cliente agora' else 'Retorno ao cliente vencido' end,
                     format('%s está esperando o seu contato desde %s. Registre o atendimento no painel.',
                            coalesce(l.nome, 'O cliente'),
                            to_char(v_venc at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')),
                     '/corretores/painel#leads');
      update leads set alerta_parceiro_em = now() where id = l.id;
      n := n + 1;
    elsif l.alerta_ceo_em is null and l.alerta_parceiro_em < now() - make_interval(hours => v_escalar) then
      select coalesce(nome, 'parceiro') into v_parc from perfis where user_id = l.corretor_id;
      for adm in select user_id from perfis where perfil = 'admin' loop
        perform avisar(adm, 'lead_escalado', l.id::text, 'Parceiro sem retorno ao cliente',
                       format('%s não registrou contato com %s desde %s. Cobre o parceiro ou retire o cliente.',
                              v_parc, coalesce(l.nome, 'o cliente'),
                              to_char(v_venc at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')),
                       '/gestao/leads');
      end loop;
      update leads set alerta_ceo_em = now() where id = l.id;
      n := n + 1;
    end if;
  end loop;

  -- 4. Chamado de suporte sem resposta.
  if to_regclass('public.chamados') is not null then
    for ch in select * from chamados
               where status = 'aberto' and criado < now() - make_interval(hours => v_chamado) loop
      for adm in select user_id from perfis
                  where perfil = 'atendente'
                     or (perfil = 'admin' and ch.criado < now() - make_interval(hours => v_chamado + v_escalar)) loop
        if avisar(adm, 'chamado', ch.id::text, format('Chamado %s sem resposta', ch.protocolo),
                  format('%s: "%s" aberto em %s.', ch.cliente_nome, left(ch.assunto, 80),
                         to_char(ch.criado at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')),
                  '/gestao/chamados') then n := n + 1; end if;
      end loop;
    end loop;
  end if;

  -- 5. Tarefas: lembrete antes do prazo e aviso de atraso.
  for t in select * from tarefas where coluna <> 'feito' and prazo is not null loop
    if t.lembrete_em is null and t.prazo > now() and t.prazo - make_interval(mins => v_lembrete) <= now() then
      perform avisar(t.dono_id, 'tarefa', t.id::text || ':lembrete', 'Tarefa vence em breve',
                     format('"%s" vence às %s.', t.titulo, to_char(t.prazo at time zone 'America/Sao_Paulo', 'HH24:MI')),
                     '/minha-conta#crm', t.prioridade <> 'normal');
      update tarefas set lembrete_em = now() where id = t.id;
      n := n + 1;
    elsif t.atraso_em is null and t.prazo <= now() then
      perform avisar(t.dono_id, 'tarefa', t.id::text || ':atraso', 'Tarefa atrasada',
                     format('"%s" venceu em %s.', t.titulo,
                            to_char(t.prazo at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')),
                     '/minha-conta#crm', true);
      update tarefas set atraso_em = now() where id = t.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.ciclo_alertas_crm() from public, anon, authenticated;

do $$ begin
  perform cron.schedule('ciclo-alertas-crm', '*/10 * * * *', 'select public.ciclo_alertas_crm()');
exception when others then null; end $$;

-- Resumo para a Central de alertas do CEO e da equipe.
create or replace function public.painel_alertas() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c jsonb := coalesce((select valor from config_portal where chave = 'crm_alertas'), '{}'::jsonb);
  v_central int := coalesce((c ->> 'central_minutos')::int, 30);
  v_primeiro int := coalesce((c ->> 'primeiro_contato_horas')::int, 2);
  r jsonb;
begin
  if not public.sou_equipe() then raise exception 'nao autorizado'; end if;
  select jsonb_build_object(
    'leads_central', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'cidade', cidade,
                         'desde', criado) order by criado)
                       from leads where status = 'novo' and corretor_id is null), '[]'::jsonb),
    'leads_central_atrasados', (select count(*) from leads where status = 'novo' and corretor_id is null
                                  and criado < now() - make_interval(mins => v_central)),
    'leads_sem_retorno', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'nome', l.nome,
                         'parceiro', p.nome, 'parceiro_whats', p.whatsapp,
                         'vencido_em', coalesce(l.proximo_contato_em, l.atendido_em + make_interval(hours => v_primeiro)),
                         'ultimo_contato', l.ultimo_contato_em) order by coalesce(l.proximo_contato_em, l.atendido_em))
                       from leads l left join perfis p on p.user_id = l.corretor_id
                      where l.status = 'em_atendimento' and l.atendido_em is not null
                        and coalesce(l.proximo_contato_em,
                              case when l.ultimo_contato_em is null then l.atendido_em + make_interval(hours => v_primeiro) end) < now()),
                       '[]'::jsonb),
    'leads_aguardando_aceite', (select count(*) from lead_ofertas where status = 'aguardando'),
    'chamados_abertos', (select count(*) from chamados where status not in ('resolvido', 'fechado')),
    'chamados_sem_resposta', (select count(*) from chamados where status = 'aberto'),
    'corretores_pendentes', (select count(*) from perfis where perfil in ('corretor', 'imobiliaria') and status = 'pendente'),
    'avulsos_pendentes', (select count(*) from imoveis_avulsos where status = 'pendente'),
    'publicidade_para_aprovar', (select count(*) from anuncio_pedidos where status = 'pago'),
    'planos_aguardando_pagamento', (select count(*) from avulsos_planos where status = 'aguardando_pagamento'),
    'planos_pagos_sem_aprovacao', (select count(*) from avulsos_planos where status = 'pago')
  ) into r;
  return r;
end $$;
revoke all on function public.painel_alertas() from public, anon;
grant execute on function public.painel_alertas() to authenticated;

insert into public.config_privado (chave, valor) values ('site_url', 'https://vamosarrematar.com.br')
on conflict (chave) do nothing;

-- E-mail dos alertas a cada 10 minutos: o banco chama a rota de avisos do site (pg_net).
-- Precisa de config_privado.site_url (ex.: https://vamosarrematar.com.br) e do billing_token.
do $$ begin
  perform cron.schedule('enviar-avisos-email', '*/10 * * * *', $job$
    select net.http_get(
      url := (select valor from public.config_privado where chave = 'site_url') || '/api/cron/portal-avisos',
      headers := jsonb_build_object('Authorization',
                 'Bearer ' || (select valor from public.config_privado where chave = 'billing_token')))
     where exists (select 1 from public.config_privado where chave = 'site_url')
       and exists (select 1 from public.notificacoes where not email_enviado and criado > now() - interval '1 day')
  $job$);
exception when others then null; end $$;

-- ===== 020_ativacao.sql =====
-- 020: ativação do portal no banco de produção.
--  * Categorias que faltavam no perfil (proprietário e equipe de atendimento).
--  * Todo usuário novo ganha o seu perfil na hora do cadastro.
--  * Perfil para quem já tinha conta; o e-mail do CEO vira administrador geral.
--  * Token interno de cobrança e avisos (o mesmo valor vai para a Vercel).

alter table public.perfis drop constraint if exists perfis_perfil_check;
alter table public.perfis add constraint perfis_perfil_check check (perfil = any (array[
  'investidor', 'comprador', 'corretor', 'imobiliaria', 'proprietario', 'tecnico', 'atendente', 'admin']));

create or replace function public.perfil_do_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tipo text := coalesce(new.raw_user_meta_data ->> 'tipo', new.raw_user_meta_data ->> 'perfil', 'comprador');
begin
  if v_tipo not in ('investidor', 'comprador', 'corretor', 'imobiliaria', 'proprietario') then
    v_tipo := 'comprador';
  end if;
  insert into public.perfis (user_id, nome, email, perfil)
  values (new.id, nullif(trim(coalesce(new.raw_user_meta_data ->> 'nome', '')), ''), new.email, v_tipo)
  on conflict (user_id) do nothing;
  return new;
exception when others then
  return new; -- o cadastro nunca falha por causa do perfil; o painel completa depois
end $$;
drop trigger if exists perfil_do_novo_usuario on auth.users;
create trigger perfil_do_novo_usuario after insert on auth.users
  for each row execute function public.perfil_do_novo_usuario();

-- Contas que já existiam.
alter table public.perfis disable trigger user;
insert into public.perfis (user_id, nome, email, perfil)
select u.id, nullif(trim(coalesce(u.raw_user_meta_data ->> 'nome', '')), ''), u.email, 'comprador'
  from auth.users u
 where not exists (select 1 from public.perfis p where p.user_id = u.id);
update public.perfis
   set perfil = 'admin', nome = coalesce(nome, 'Fabrício Damião'), status = 'aprovado', creci_ok = true
 where email = 'fabriciodamiaoadvogado@gmail.com';
alter table public.perfis enable trigger user;

insert into public.config_privado (chave, valor)
values ('billing_token', encode(gen_random_bytes(32), 'hex'))
on conflict (chave) do nothing;

commit;
