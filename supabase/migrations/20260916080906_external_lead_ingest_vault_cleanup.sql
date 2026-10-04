-- A credencial do cliente não pode sobreviver à linha que aponta para ela.
-- disconnect_lead_integration já apagava o segredo, mas apagar a imobiliária
-- (ou a linha da integração por qualquer outro caminho) deixava o segredo órfão
-- em vault.secrets. O gatilho fecha isso no cascade também.
create or replace function private.lead_integrations_drop_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.secret_id is not null then
    delete from vault.secrets s where s.id = old.secret_id;
  end if;

  return old;
end;
$$;

comment on function private.lead_integrations_drop_secret() is
  'Trigger BEFORE DELETE em public.lead_integrations: apaga do Vault a credencial do cliente apontada por secret_id. Vale também quando a imobiliária é removida (cascade).';

revoke all on function private.lead_integrations_drop_secret() from public, anon, authenticated;

drop trigger if exists lead_integrations_drop_secret on public.lead_integrations;
create trigger lead_integrations_drop_secret
  before delete on public.lead_integrations
  for each row execute function private.lead_integrations_drop_secret();
