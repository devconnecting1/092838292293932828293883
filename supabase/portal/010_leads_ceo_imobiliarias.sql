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
