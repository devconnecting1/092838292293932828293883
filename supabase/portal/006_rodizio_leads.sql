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
   where p.perfil = 'corretor' and p.status = 'aprovado' and p.creci_ok and p.recebe_leads
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
