-- O bloqueio da plataforma não mexe no interruptor da imobiliária.
--
-- `connected_accounts` tem três eixos de propósito: `status` (o que o
-- fornecedor diz), `enabled` (a imobiliária desligou) e `blocked_at` (nós
-- suspendemos). Juntá-los faz a tela mentir — e era o que acontecia:
-- `set_connection_platform_block` gravava `enabled = false` ao bloquear e não
-- desfazia ao desbloquear. Depois de uma suspensão nossa, a conexão ficava
-- marcada como "Desligado pela imobiliária", que é falso: quem desligou fomos
-- nós. E, para o cliente, o canal continuava parado sem motivo visível.
--
-- Como o bloqueio já vence sozinho em todo lugar que decide envio
-- (`private.connection_can_send` exige `blocked_at is null`, e
-- `connectionHealth` no core devolve "blocked" antes de qualquer outra coisa),
-- a coluna `enabled` volta a significar só uma coisa: o interruptor do cliente.
--
-- O que continua igual: com a conexão bloqueada, `set_connection_enabled` se
-- recusa a religar (42501). Desligar durante o bloqueio segue permitido — é a
-- vontade do cliente sobre o eixo dele.

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
        then left(nullif(btrim(coalesce(p_reason, '')), ''), 300) else null end
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
  'Interruptor da plataforma, independente do interruptor da imobiliária. Enquanto blocked_at existe, nada é enviado e o cliente não consegue religar; desbloquear devolve a decisão ao cliente sem mexer no enabled dele.';
