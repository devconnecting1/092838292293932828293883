-- =============================================================================
-- Prévia pública do convite (tela /convite/[token], antes do aceite)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- RPC pública: dados de exibição do convite para visitantes anônimos
-- -----------------------------------------------------------------------------
-- Usada pela página pública do convite para mostrar a imobiliária, o papel, a
-- validade e uma dica do e-mail convidado antes do aceite (que continua
-- exigindo sessão e validando o e-mail via accept_invitation). Retorna null
-- se o token não existir; nunca expõe id, token, organization_id ou o e-mail
-- completo do convidado.
create or replace function public.get_invitation_preview(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_invitation public.invitations%rowtype;
  v_organization_name text;
begin
  select * into v_invitation
  from public.invitations i
  where i.token = p_token;

  if not found then
    return null;
  end if;

  select o.name into v_organization_name
  from public.organizations o
  where o.id = v_invitation.organization_id;

  return jsonb_build_object(
    'organization_name', v_organization_name,
    'role', v_invitation.role,
    'expires_at', v_invitation.expires_at,
    'expired', v_invitation.expires_at < now(),
    'accepted', v_invitation.accepted_at is not null,
    -- Só uma dica: dois primeiros caracteres do usuário + domínio completo.
    'email_hint',
      left(split_part(v_invitation.email, '@', 1), 2) || '***@' || split_part(v_invitation.email, '@', 2)
  );
end;
$$;

revoke all on function public.get_invitation_preview(text) from public;
grant execute on function public.get_invitation_preview(text) to anon, authenticated;
