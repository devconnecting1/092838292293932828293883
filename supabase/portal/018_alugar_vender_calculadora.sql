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
