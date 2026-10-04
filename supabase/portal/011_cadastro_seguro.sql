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
