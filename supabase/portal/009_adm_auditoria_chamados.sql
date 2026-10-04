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
  sensiveis text[] := array['pix_chave', 'banco', 'telefone', 'contato_telefone', 'email', 'endereco'];
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
