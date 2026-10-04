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
