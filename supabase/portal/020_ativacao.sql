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
