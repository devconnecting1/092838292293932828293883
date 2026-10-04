-- =============================================================================
-- Destinatários das notificações por e-mail (sem sessão de usuário)
-- =============================================================================
-- O lead de landing page e a solicitação de captação chegam por formulário
-- público, sem usuário logado. Depois do envio aceito, o servidor Next pergunta
-- ao banco quem deve ser avisado, usando a chave do servidor guardada no Vault
-- (notification_server_key, env NOTIFICATION_SERVER_KEY) e a chave publishable.
--
-- Guarda o mínimo: nenhuma tabela nova. Bounce/spam/bloqueio NÃO são espelhados
-- aqui (a Brevo já mantém a lista de bloqueio dos contatos transacionais).

-- -----------------------------------------------------------------------------
-- 1. Segredo próprio no Vault (gerado aqui; o valor não fica no arquivo).
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets s where s.name = 'notification_server_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'notification_server_key',
      'Chave do servidor Next para public.get_notification_recipients (env NOTIFICATION_SERVER_KEY).'
    );
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Índice para achar o lead pelo event_id sem saber a imobiliária
--    (submit_landing_lead não devolve o id do lead nem o da imobiliária).
-- -----------------------------------------------------------------------------
create index if not exists leads_event_id_idx
  on public.leads (event_id)
  where event_id is not null;

-- -----------------------------------------------------------------------------
-- 3. Regra dos destinatários (schema private, sem EXECUTE para a API)
-- -----------------------------------------------------------------------------
-- p_kind:
--   new_lead        -> responsável do lead, se ainda for membro ativo; senão
--                      donos e gerentes ativos.
--   capture_request -> donos, gerentes e captadores ativos.
-- p_subject_id:
--   new_lead        -> leads.id; se não existir, leads.event_id de lead criado
--                      há no máximo 15 minutos, com correspondência única.
--   capture_request -> capture_requests.id.
-- p_organization_id: opcional. Nulo = imobiliária do próprio registro; informado
--                    = o registro precisa ser dela.
-- Só membros com e-mail confirmado (evita bounce para endereço não verificado).
-- Retorna no máximo 20 linhas; registro inexistente = nenhuma linha.
create or replace function private.notification_recipients(
  p_organization_id uuid,
  p_kind text,
  p_subject_id uuid
)
returns table (email text, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_assignee uuid;
  v_roles public.app_role[];
begin
  if p_subject_id is null then
    return;
  end if;

  if p_kind = 'new_lead' then
    select l.organization_id, l.assigned_to
      into v_org, v_assignee
    from public.leads l
    where l.id = p_subject_id
      and (p_organization_id is null or l.organization_id = p_organization_id);

    if v_org is null then
      begin
        select l.organization_id, l.assigned_to
          into strict v_org, v_assignee
        from public.leads l
        where l.event_id = p_subject_id
          and l.created_at > now() - interval '15 minutes'
          and (p_organization_id is null or l.organization_id = p_organization_id);
      exception
        when no_data_found or too_many_rows then
          return;
      end;
    end if;

    v_roles := array['owner', 'manager']::public.app_role[];
  elsif p_kind = 'capture_request' then
    select cr.organization_id
      into v_org
    from public.capture_requests cr
    where cr.id = p_subject_id
      and (p_organization_id is null or cr.organization_id = p_organization_id);

    v_roles := array['owner', 'manager', 'capturer']::public.app_role[];
  else
    raise exception 'Tipo de notificação inválido.' using errcode = '22023';
  end if;

  if v_org is null then
    return;
  end if;

  if v_assignee is not null then
    return query
      select u.email::text, nullif(btrim(p.full_name), '')
      from public.memberships m
      join auth.users u
        on u.id = m.user_id
      left join public.profiles p
        on p.id = m.user_id
      where m.organization_id = v_org
        and m.user_id = v_assignee
        and m.active
        and u.email is not null
        and u.email_confirmed_at is not null;

    if found then
      return;
    end if;
  end if;

  return query
    select u.email::text, nullif(btrim(p.full_name), '')
    from public.memberships m
    join auth.users u
      on u.id = m.user_id
    left join public.profiles p
      on p.id = m.user_id
    where m.organization_id = v_org
      and m.active
      and m.role = any (v_roles)
      and u.email is not null
      and u.email_confirmed_at is not null
    order by array_position(v_roles, m.role), p.full_name nulls last, u.email
    limit 20;
end;
$$;

comment on function private.notification_recipients(uuid, text, uuid) is
  'Destinatários de notificação por e-mail (new_lead: responsável ativo ou donos/gerentes; capture_request: donos/gerentes/captadores). Só e-mail (auth.users, confirmado) e nome; até 20. Chamada só por public.get_notification_recipients.';

revoke all on function private.notification_recipients(uuid, text, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. RPC chamada pelo servidor Next (chave do servidor obrigatória)
-- -----------------------------------------------------------------------------
-- Erros: 42501 (chave ausente/errada, mensagem genérica, verificado antes de
-- tudo), 22023 (p_kind inválido ou p_subject_id nulo).
create or replace function public.get_notification_recipients(
  p_server_key text,
  p_organization_id uuid,
  p_kind text,
  p_subject_id uuid
)
returns table (email text, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_secret text;
begin
  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'notification_server_key'
  limit 1;

  if v_secret is null
     or p_server_key is null
     or extensions.digest(p_server_key, 'sha256') <> extensions.digest(v_secret, 'sha256') then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_kind is null or p_kind not in ('new_lead', 'capture_request') then
    raise exception 'Tipo de notificação inválido.' using errcode = '22023';
  end if;

  if p_subject_id is null then
    raise exception 'Informe o registro da notificação.' using errcode = '22023';
  end if;

  return query
    select r.email, r.full_name
    from private.notification_recipients(p_organization_id, p_kind, p_subject_id) r;
end;
$$;

comment on function public.get_notification_recipients(text, uuid, text, uuid) is
  'Servidor Next (chave publishable + NOTIFICATION_SERVER_KEY): e-mail e nome de quem avisar sobre novo lead (new_lead) ou nova captação (capture_request). Nunca expõe a chave nem dados do registro.';

revoke all on function public.get_notification_recipients(text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.get_notification_recipients(text, uuid, text, uuid) to anon, authenticated;
