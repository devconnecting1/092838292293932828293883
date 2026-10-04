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
