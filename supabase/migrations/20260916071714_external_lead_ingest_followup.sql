-- Correção: desconectar precisa apagar a credencial do cliente do Vault.
-- O `returning` do UPDATE devolve a linha NOVA, e a própria instrução já tinha
-- zerado secret_id — então v_secret_id vinha nulo e o segredo ficava órfão no
-- Vault. Agora o id é lido ANTES do UPDATE.
-- (Pego pelo teste supabase/tests/external_lead_ingest.sql, chave
-- `desconectar_apaga_segredo`.)
create or replace function public.disconnect_lead_integration(
  p_organization_id uuid,
  p_provider text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.lead_integration_provider;
  v_secret_id uuid;
begin
  if not (select private.has_role(p_organization_id, '{owner,manager}')) then
    raise exception 'Seu papel nesta imobiliária não permite desconectar integrações.'
      using errcode = '42501';
  end if;

  begin
    v_provider := p_provider::public.lead_integration_provider;
  exception when others then
    raise exception 'Integração desconhecida.' using errcode = '22023';
  end;

  -- Lido antes do UPDATE: o RETURNING devolveria já o valor zerado.
  select li.secret_id into v_secret_id
  from public.lead_integrations li
  where li.organization_id = p_organization_id
    and li.provider = v_provider;

  update public.lead_integrations li
  set status = 'disconnected',
      secret_id = null,
      webhook_token = null,
      poll_cursor = '{}'::jsonb,
      external_account_id = null,
      connected_at = null,
      last_error = null,
      last_error_at = null
  where li.organization_id = p_organization_id
    and li.provider = v_provider;

  -- A credencial do cliente é apagada de verdade: desconectar tem que devolver
  -- o controle da conta a quem é dono dela.
  if v_secret_id is not null then
    delete from vault.secrets s where s.id = v_secret_id;
  end if;
end;
$$;

revoke all on function public.disconnect_lead_integration(uuid, text) from public, anon;
grant execute on function public.disconnect_lead_integration(uuid, text) to authenticated;
