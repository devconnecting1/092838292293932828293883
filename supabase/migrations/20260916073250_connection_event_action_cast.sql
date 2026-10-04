-- Interruptores: o enum da ação precisa de conversão explícita.
--
-- `private.connection_event` recebe a ação como `public.connection_event_action`.
-- Um literal solto (`'disconnected'`) chega ao resolvedor como `unknown` e é
-- convertido sem problema, mas um `case when ... then 'enabled' else 'disabled'
-- end` já é TEXT — e o Postgres não converte TEXT para enum sozinho. Resultado:
-- `42883 function private.connection_event(...) does not exist`, só na hora de
-- ligar, desligar ou suspender uma conexão. Compilou, aplicou, e quebraria na
-- primeira vez que alguém usasse o interruptor.
--
-- As duas funções abaixo são recriadas com a conversão explícita. Nada mais
-- muda nelas.

create or replace function public.set_connection_enabled(
  p_connected_account_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_row public.connected_accounts;
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  select * into v_row from public.connected_accounts where id = p_connected_account_id;

  if v_row.id is null then
    raise exception 'Conexão não encontrada.' using errcode = 'P0002';
  end if;

  if not private.has_role(v_row.organization_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'Só o dono ou o gerente pode ligar e desligar uma conexão.'
      using errcode = '42501';
  end if;

  if p_enabled and v_row.blocked_at is not null then
    raise exception 'Esta conexão está suspensa pela plataforma e não pode ser religada aqui.'
      using errcode = '42501';
  end if;

  if coalesce(p_enabled, true) is not distinct from v_row.enabled then
    return jsonb_build_object('enabled', v_row.enabled, 'changed', false);
  end if;

  update public.connected_accounts
  set enabled = coalesce(p_enabled, true)
  where id = p_connected_account_id;

  perform private.connection_event(
    v_row.organization_id, v_row.id, v_row.provider,
    (case when p_enabled then 'enabled' else 'disabled' end)::public.connection_event_action,
    v_user, null, '{}'::jsonb
  );

  return jsonb_build_object('enabled', coalesce(p_enabled, true), 'changed', true);
end;
$$;

comment on function public.set_connection_enabled(uuid, boolean) is
  'Interruptor da imobiliária: liga/desliga a conexão sem apagar nada. Recusa religar o que a plataforma suspendeu.';

create or replace function public.set_connection_platform_block(
  p_server_key text default null,
  p_connected_account_id uuid default null,
  p_blocked boolean default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.connected_accounts;
begin
  if not private.connections_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select * into v_row from public.connected_accounts where id = p_connected_account_id;

  if v_row.id is null then
    raise exception 'Conexão não encontrada.' using errcode = 'P0002';
  end if;

  update public.connected_accounts
  set blocked_at = case when p_blocked then now() else null end,
      blocked_reason = case when p_blocked
        then left(nullif(btrim(coalesce(p_reason, '')), ''), 300) else null end,
      enabled = case when p_blocked then false else enabled end
  where id = p_connected_account_id;

  perform private.connection_event(
    v_row.organization_id, v_row.id, v_row.provider,
    (case when p_blocked then 'blocked' else 'unblocked' end)::public.connection_event_action,
    null, left(nullif(btrim(coalesce(p_reason, '')), ''), 300), '{}'::jsonb
  );

  return jsonb_build_object('blocked', coalesce(p_blocked, false));
end;
$$;

comment on function public.set_connection_platform_block(text, uuid, boolean, text) is
  'Interruptor da plataforma. Bloquear desliga a conexão e o cliente não consegue religar; só o servidor desfaz.';
