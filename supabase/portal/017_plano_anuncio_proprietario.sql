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
