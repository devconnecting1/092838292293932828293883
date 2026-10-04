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
