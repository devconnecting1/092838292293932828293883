-- =============================================================================
-- Console da Plataforma: equipe (convites por e-mail e papéis)
-- =============================================================================
-- Até aqui só entrava no console quem estava em PLATFORM_ADMIN_EMAILS (variável
-- da Vercel). Agora o Dono (quem continua nessa variável) convida outras
-- pessoas pelo próprio console, com um de dois papéis:
--   admin   Administrador: usa todas as ações do console, mas não mexe na equipe;
--   viewer  Somente leitura: vê todas as telas e não executa nenhuma ação.
-- O Dono não fica no banco: é a raiz, definida no servidor.
--
-- Mesmo contrato das RPCs do console (20260917041803 e 20260917050618):
-- security definer, search_path vazio, p_server_key (segredo
-- platform_server_key do Vault), EXECUTE só para anon (o servidor Next chama
-- sem sessão, com a chave publishable) e toda mudança grava o registro do
-- console na mesma transação.
--
--  1. private.platform_staff (pessoas da equipe) e
--     private.platform_staff_invitations (convites: só o hash SHA-256 do token,
--     validade de 7 dias, uso único, revogável), com RLS fechada.
--  2. Registro do console: private.insert_platform_audit_event (a gravação de
--     sempre) e private.record_platform_audit_event, que agora também recusa
--     quem é "Somente leitura" — barreira no banco para todas as ações do
--     console que já existem (bloquear, prorrogar teste, comunicados, envio da
--     Caixa, incidentes do status), além da checagem do servidor.
--  3. platform_staff_role: papel ativo de uma conta (o servidor consulta a cada
--     requisição; remover ou mudar o papel vale na próxima).
--  4. Convites: platform_staff_invite, platform_staff_resend_invitation,
--     platform_staff_revoke_invitation, platform_staff_invitation_preview (só
--     situação, papel e validade; nunca o e-mail) e
--     platform_staff_accept_invitation (e-mail da conta igual ao convidado e
--     confirmado).
--  5. Gestão: platform_staff_list, platform_staff_set_role e
--     platform_staff_remove.
--
-- Travas: no máximo 20 convites pendentes; no máximo 30 envios de convite
-- (novos + reenvios) em 24 horas (Brevo gratuita: 300 e-mails por dia na conta
-- toda); reenvio do mesmo convite só depois de 1 minuto.

-- -----------------------------------------------------------------------------
-- 1. Tabelas
-- -----------------------------------------------------------------------------
create table private.platform_staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null,
  active boolean not null default true,
  invitation_id uuid,
  invited_by_user_id uuid,
  invited_by_email text,
  joined_at timestamptz not null default now(),
  role_changed_at timestamptz,
  removed_at timestamptz,
  removed_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_staff_email_check
    check (
      email = lower(email)
      and char_length(email) between 3 and 320
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    ),
  constraint platform_staff_role_check check (role in ('admin', 'viewer')),
  constraint platform_staff_invited_by_email_check
    check (invited_by_email is null or (invited_by_email = lower(invited_by_email) and char_length(invited_by_email) <= 320)),
  constraint platform_staff_removed_check
    check (active = (removed_at is null) and (removed_at is not null or removed_by_user_id is null))
);

comment on table private.platform_staff is
  'Equipe do Console da Plataforma além dos Donos (PLATFORM_ADMIN_EMAILS, no servidor). Uma linha por conta: papel admin (Administrador: todas as ações, sem gerenciar a equipe) ou viewer (Somente leitura). Remover desativa a linha (active = false) em vez de apagar. Escrita só pelas RPCs platform_staff_*.';
comment on column private.platform_staff.email is
  'E-mail (minúsculas) da conta quando aceitou o convite. O acesso só vale enquanto o e-mail da conta em auth.users continuar igual e confirmado.';
comment on column private.platform_staff.role is
  'admin (Administrador) ou viewer (Somente leitura).';
comment on column private.platform_staff.active is
  'false = removida da equipe (removed_at e removed_by_user_id dizem quando e por quem). Volta a true se aceitar um novo convite.';
comment on column private.platform_staff.invitation_id is
  'Convite aceito mais recente (private.platform_staff_invitations.id). Sem chave estrangeira: só referência.';
comment on column private.platform_staff.invited_by_email is
  'E-mail do Dono que enviou o convite aceito.';
comment on column private.platform_staff.joined_at is
  'Quando a pessoa entrou (ou voltou) para a equipe.';

alter table private.platform_staff enable row level security;

-- Sem política: ninguém lê nem escreve direto; só as funções abaixo.
revoke all on private.platform_staff from public, anon, authenticated;

create table private.platform_staff_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text not null,
  token_hash text not null,
  expires_at timestamptz not null,
  invited_by_user_id uuid not null,
  invited_by_email text not null,
  send_count integer not null default 1,
  last_sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by_user_id uuid,
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  constraint platform_staff_invitations_email_check
    check (
      email = lower(email)
      and char_length(email) between 3 and 320
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    ),
  constraint platform_staff_invitations_role_check check (role in ('admin', 'viewer')),
  constraint platform_staff_invitations_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint platform_staff_invitations_invited_by_email_check
    check (invited_by_email = lower(invited_by_email) and char_length(invited_by_email) between 3 and 320),
  constraint platform_staff_invitations_send_count_check check (send_count between 1 and 10000),
  constraint platform_staff_invitations_accepted_check
    check ((accepted_at is null) = (accepted_by_user_id is null)),
  constraint platform_staff_invitations_revoked_check
    check ((revoked_at is null) = (revoked_by_user_id is null)),
  constraint platform_staff_invitations_closed_once_check
    check (accepted_at is null or revoked_at is null)
);

comment on table private.platform_staff_invitations is
  'Convites para a equipe do Console da Plataforma. O token vai só no e-mail: aqui fica o hash SHA-256 (hex). Vale 7 dias, uso único (accepted_at) e revogável (revoked_at). Um convite aberto por e-mail: convidar de novo reenvia (novo token e novo prazo) em vez de duplicar. Escrita só pelas RPCs platform_staff_*.';
comment on column private.platform_staff_invitations.token_hash is
  'SHA-256 (hex, 64 caracteres) do token do link. O token em si nunca chega ao banco; reenviar troca o hash e o link antigo para de valer.';
comment on column private.platform_staff_invitations.send_count is
  'Quantas vezes o convite foi enviado (1 + reenvios).';
comment on column private.platform_staff_invitations.last_sent_at is
  'Último envio (criação ou reenvio). Reenvio só depois de 1 minuto.';

create unique index platform_staff_invitations_token_hash_key
  on private.platform_staff_invitations (token_hash);

create unique index platform_staff_invitations_open_email_key
  on private.platform_staff_invitations (email)
  where accepted_at is null and revoked_at is null;

alter table private.platform_staff_invitations enable row level security;

revoke all on private.platform_staff_invitations from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Registro do console e conferência de quem age
-- -----------------------------------------------------------------------------

-- Gravação de sempre (conta real com e-mail confirmado, sem dado pessoal no
-- antes/depois). As RPCs da equipe chamam esta direto: elas conferem o papel
-- por conta própria (aceitar o convite é ação da própria pessoa convidada,
-- mesmo que ela entre como Somente leitura).
create or replace function private.insert_platform_audit_event(
  p_actor_user_id uuid,
  p_actor_email text,
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_organization_id uuid default null,
  p_reason text default null,
  p_before jsonb default null,
  p_after jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id bigint;
begin
  -- Quem agiu precisa ser uma conta real, com esse e-mail e confirmada.
  if p_actor_user_id is null or not exists (
    select 1
    from auth.users u
    where u.id = p_actor_user_id
      and lower(u.email) = v_email
      and u.email_confirmed_at is not null
  ) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if private.platform_audit_has_personal_data(p_before)
     or private.platform_audit_has_personal_data(p_after) then
    raise exception 'O antes/depois do registro não pode ter dado pessoal.' using errcode = '22023';
  end if;

  insert into private.platform_audit_events (
    actor_user_id, actor_email, action, target_type, target_id, organization_id,
    reason, before_data, after_data
  )
  values (
    p_actor_user_id, v_email, btrim(p_action), nullif(btrim(coalesce(p_target_type, '')), ''),
    nullif(btrim(coalesce(p_target_id, '')), ''), p_organization_id, v_reason, p_before, p_after
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function private.insert_platform_audit_event(uuid, text, text, text, text, uuid, text, jsonb, jsonb) is
  'Grava uma linha no registro do console conferindo a conta de quem agiu (id + e-mail confirmado) e recusando dado pessoal no antes/depois. Não confere o papel: use private.record_platform_audit_event nas ações do console; esta só nas RPCs da equipe, que conferem o papel antes.';

revoke all on function private.insert_platform_audit_event(uuid, text, text, text, text, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;

-- Ações do console: além da conta, recusa quem é "Somente leitura" (42501).
-- Toda RPC que altera algo chama esta na mesma transação, então a mudança é
-- desfeita junto.
create or replace function private.record_platform_audit_event(
  p_actor_user_id uuid,
  p_actor_email text,
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_organization_id uuid default null,
  p_reason text default null,
  p_before jsonb default null,
  p_after jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from private.platform_staff s
    where s.user_id = p_actor_user_id
      and s.active
      and s.role = 'viewer'
  ) then
    raise exception 'somente_leitura' using errcode = '42501';
  end if;

  return private.insert_platform_audit_event(
    p_actor_user_id, p_actor_email, p_action, p_target_type, p_target_id,
    p_organization_id, p_reason, p_before, p_after
  );
end;
$$;

comment on function private.record_platform_audit_event(uuid, text, text, text, text, uuid, text, jsonb, jsonb) is
  'Grava uma ação do Console da Plataforma no registro. Recusa (42501 somente_leitura) quem está na equipe como Somente leitura, confere a conta de quem agiu (id + e-mail confirmado) e recusa dado pessoal no antes/depois. Toda RPC do console que altera dados chama esta na mesma transação da mudança.';

revoke all on function private.record_platform_audit_event(uuid, text, text, text, text, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;

-- Conta real (id + e-mail confirmado) de quem age nas RPCs da equipe.
create or replace function private.platform_assert_actor(p_actor_user_id uuid, p_actor_email text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is null or not exists (
    select 1
    from auth.users u
    where u.id = p_actor_user_id
      and lower(u.email) = lower(btrim(coalesce(p_actor_email, '')))
      and u.email_confirmed_at is not null
  ) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
end;
$$;

comment on function private.platform_assert_actor(uuid, text) is
  'Levanta 42501 se quem age não for uma conta real com esse e-mail confirmado.';

revoke all on function private.platform_assert_actor(uuid, text) from public, anon, authenticated;

-- Gerenciar a equipe é só do Dono. O Dono não está no banco (PLATFORM_ADMIN_EMAILS
-- fica no servidor), então aqui a barreira é: quem está ativo na equipe como
-- Administrador ou Somente leitura não gerencia ninguém.
create or replace function private.platform_staff_assert_manager(p_actor_user_id uuid, p_actor_email text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.platform_assert_actor(p_actor_user_id, p_actor_email);

  if exists (
    select 1
    from private.platform_staff s
    where s.user_id = p_actor_user_id
      and s.active
  ) then
    raise exception 'somente_dono' using errcode = '42501';
  end if;
end;
$$;

comment on function private.platform_staff_assert_manager(uuid, text) is
  'Levanta 42501 se quem age não for uma conta real confirmada ou se estiver ativo na equipe (Administrador ou Somente leitura): só o Dono gerencia a equipe.';

revoke all on function private.platform_staff_assert_manager(uuid, text) from public, anon, authenticated;

create or replace function private.platform_staff_normalize_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when char_length(btrim(coalesce(p_email, ''))) between 6 and 254
         and lower(btrim(p_email)) ~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
      then lower(btrim(p_email))
  end;
$$;

comment on function private.platform_staff_normalize_email(text) is
  'E-mail do convite em minúsculas e sem espaços, ou null se o formato for inválido.';

revoke all on function private.platform_staff_normalize_email(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Papel de uma conta
-- -----------------------------------------------------------------------------
-- Retorno: 'admin', 'viewer' ou null (fora da equipe, removida, e-mail da conta
-- trocado ou não confirmado).
create or replace function public.platform_staff_role(p_server_key text, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_platform_server_key(p_server_key);

  return (
    select s.role
    from private.platform_staff s
    join auth.users u on u.id = s.user_id
    where s.user_id = p_user_id
      and s.active
      and u.email_confirmed_at is not null
      and lower(u.email) = s.email
  );
end;
$$;

comment on function public.platform_staff_role(text, uuid) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY): papel ativo da conta na equipe do Console da Plataforma (admin ou viewer), ou null. Só vale com o e-mail da conta igual ao do aceite e confirmado. Consultada a cada requisição do console: remover ou mudar o papel vale na próxima.';

-- -----------------------------------------------------------------------------
-- 4. Convites
-- -----------------------------------------------------------------------------

-- Cria o convite ou, se já houver um aberto para o e-mail, reenvia (novo hash,
-- novo prazo, papel atualizado). Quem chama já conferiu chave e Dono.
create or replace function private.platform_staff_issue_invitation(
  p_actor_user_id uuid,
  p_actor_email text,
  p_email text,
  p_role text,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_validity constant interval := interval '7 days';
  c_max_pending constant integer := 20;
  c_max_sends_per_day constant integer := 30;
  c_resend_cooldown constant interval := interval '1 minute';
  v_now constant timestamptz := now();
  v_expires_at constant timestamptz := now() + c_validity;
  v_actor_email constant text := lower(btrim(coalesce(p_actor_email, '')));
  v_row private.platform_staff_invitations%rowtype;
  v_id uuid;
begin
  if p_role is null or p_role not in ('admin', 'viewer') then
    raise exception 'papel_invalido' using errcode = '22023';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_invalido' using errcode = '22023';
  end if;

  if p_email = v_actor_email then
    raise exception 'convite_para_si' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from private.platform_staff s
    join auth.users u on u.id = s.user_id
    where s.active
      and (s.email = p_email or lower(u.email) = p_email)
  ) then
    raise exception 'ja_e_da_equipe' using errcode = 'P0001';
  end if;

  -- Um envio por vez: as contagens abaixo não podem correr em paralelo.
  perform pg_advisory_xact_lock(hashtext('private.platform_staff_invitations'));

  if (
    select count(*)
    from private.platform_audit_events e
    where e.action in ('equipe.convidar', 'equipe.reenviar_convite')
      and e.occurred_at > v_now - interval '24 hours'
  ) >= c_max_sends_per_day then
    raise exception 'limite_diario_de_envios' using errcode = 'P0001';
  end if;

  select i.* into v_row
  from private.platform_staff_invitations i
  where i.email = p_email
    and i.accepted_at is null
    and i.revoked_at is null
  for update;

  if found then
    if v_row.last_sent_at > v_now - c_resend_cooldown then
      raise exception 'reenvio_muito_rapido' using errcode = 'P0001';
    end if;

    update private.platform_staff_invitations i
    set role = p_role,
        token_hash = p_token_hash,
        expires_at = v_expires_at,
        last_sent_at = v_now,
        send_count = i.send_count + 1,
        invited_by_user_id = p_actor_user_id,
        invited_by_email = v_actor_email
    where i.id = v_row.id;

    perform private.insert_platform_audit_event(
      p_actor_user_id,
      v_actor_email,
      'equipe.reenviar_convite',
      'convite_equipe',
      v_row.id::text,
      null,
      null,
      jsonb_build_object(
        'papel', v_row.role,
        'expira_em', v_row.expires_at,
        'envios', v_row.send_count
      ),
      jsonb_build_object(
        'papel', p_role,
        'expira_em', v_expires_at,
        'envios', v_row.send_count + 1
      )
    );

    return jsonb_build_object(
      'invitation_id', v_row.id,
      'email', p_email,
      'role', p_role,
      'expires_at', v_expires_at,
      'resent', true
    );
  end if;

  if (
    select count(*)
    from private.platform_staff_invitations i
    where i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > v_now
  ) >= c_max_pending then
    raise exception 'limite_de_convites' using errcode = 'P0001';
  end if;

  insert into private.platform_staff_invitations (
    email, role, token_hash, expires_at, invited_by_user_id, invited_by_email, last_sent_at
  )
  values (
    p_email, p_role, p_token_hash, v_expires_at, p_actor_user_id, v_actor_email, v_now
  )
  returning id into v_id;

  perform private.insert_platform_audit_event(
    p_actor_user_id,
    v_actor_email,
    'equipe.convidar',
    'convite_equipe',
    v_id::text,
    null,
    null,
    null,
    jsonb_build_object('papel', p_role, 'expira_em', v_expires_at)
  );

  return jsonb_build_object(
    'invitation_id', v_id,
    'email', p_email,
    'role', p_role,
    'expires_at', v_expires_at,
    'resent', false
  );
end;
$$;

comment on function private.platform_staff_issue_invitation(uuid, text, text, text, text) is
  'Cria o convite para a equipe (7 dias) ou reenvia o aberto do mesmo e-mail (novo hash, novo prazo, papel atualizado) e grava equipe.convidar ou equipe.reenviar_convite no registro. Travas: 20 convites pendentes, 30 envios em 24 horas, 1 minuto entre reenvios. Uso interno de platform_staff_invite e platform_staff_resend_invitation.';

revoke all on function private.platform_staff_issue_invitation(uuid, text, text, text, text)
  from public, anon, authenticated;

-- Retorno: { invitation_id, email, role, expires_at, resent }.
-- Erros: 42501 chave ou quem age não é Dono; 22023 email_invalido |
--        papel_invalido | token_invalido; P0001 convite_para_si |
--        ja_e_da_equipe | limite_diario_de_envios | reenvio_muito_rapido |
--        limite_de_convites.
create or replace function public.platform_staff_invite(
  p_server_key text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_email text,
  p_role text,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email constant text := private.platform_staff_normalize_email(p_email);
begin
  perform private.check_platform_server_key(p_server_key);
  perform private.platform_staff_assert_manager(p_actor_user_id, p_actor_email);

  if v_email is null then
    raise exception 'email_invalido' using errcode = '22023';
  end if;

  return private.platform_staff_issue_invitation(
    p_actor_user_id, p_actor_email, v_email, p_role, p_token_hash
  );
end;
$$;

comment on function public.platform_staff_invite(text, uuid, text, text, text, text) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir que quem age é Dono: convida o e-mail para a equipe do console como admin ou viewer. O servidor gera o token e manda só o hash SHA-256. Convite aberto para o mesmo e-mail é reenviado (não duplica). Grava o registro na mesma transação.';

-- Reenvia um convite aberto pelo id (novo token e novo prazo, mesmo papel).
-- Retorno e erros como platform_staff_invite, mais P0002 convite_nao_encontrado
-- e P0001 convite_encerrado.
create or replace function public.platform_staff_resend_invitation(
  p_server_key text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_invitation_id uuid,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row private.platform_staff_invitations%rowtype;
begin
  perform private.check_platform_server_key(p_server_key);
  perform private.platform_staff_assert_manager(p_actor_user_id, p_actor_email);

  select i.* into v_row
  from private.platform_staff_invitations i
  where i.id = p_invitation_id;

  if not found then
    raise exception 'convite_nao_encontrado' using errcode = 'P0002';
  end if;

  if v_row.accepted_at is not null or v_row.revoked_at is not null then
    raise exception 'convite_encerrado' using errcode = 'P0001';
  end if;

  return private.platform_staff_issue_invitation(
    p_actor_user_id, p_actor_email, v_row.email, v_row.role, p_token_hash
  );
end;
$$;

comment on function public.platform_staff_resend_invitation(text, uuid, text, uuid, text) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir que quem age é Dono: reenvia um convite aberto da equipe (novo hash, mais 7 dias, mesmo papel; o link antigo para de valer). Grava equipe.reenviar_convite no registro.';

-- Retorno: { invitation_id, revoked_at }.
-- Erros: 42501 chave ou quem age não é Dono; P0002 convite_nao_encontrado;
--        P0001 convite_encerrado (já aceito ou revogado).
create or replace function public.platform_staff_revoke_invitation(
  p_server_key text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_invitation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := now();
  v_row private.platform_staff_invitations%rowtype;
begin
  perform private.check_platform_server_key(p_server_key);
  perform private.platform_staff_assert_manager(p_actor_user_id, p_actor_email);

  select i.* into v_row
  from private.platform_staff_invitations i
  where i.id = p_invitation_id
  for update;

  if not found then
    raise exception 'convite_nao_encontrado' using errcode = 'P0002';
  end if;

  if v_row.accepted_at is not null or v_row.revoked_at is not null then
    raise exception 'convite_encerrado' using errcode = 'P0001';
  end if;

  update private.platform_staff_invitations i
  set revoked_at = v_now,
      revoked_by_user_id = p_actor_user_id
  where i.id = v_row.id;

  perform private.insert_platform_audit_event(
    p_actor_user_id,
    p_actor_email,
    'equipe.revogar_convite',
    'convite_equipe',
    v_row.id::text,
    null,
    null,
    jsonb_build_object(
      'papel', v_row.role,
      'situacao', case when v_row.expires_at <= v_now then 'expirado' else 'pendente' end
    ),
    jsonb_build_object('situacao', 'revogado')
  );

  return jsonb_build_object('invitation_id', v_row.id, 'revoked_at', v_now);
end;
$$;

comment on function public.platform_staff_revoke_invitation(text, uuid, text, uuid) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir que quem age é Dono: revoga um convite aberto da equipe (o link para de valer). Grava equipe.revogar_convite no registro.';

-- Prévia do convite pelo hash do token, para a página de aceite. Dados mínimos:
-- situação (valido, expirado, usado, revogado), papel e validade. Nunca o
-- e-mail convidado. Com p_user_id (conta logada), diz só se o e-mail da conta
-- é o convidado, se está confirmado e se a conta já é da equipe.
-- Retorno: null (token inexistente ou fora do formato) ou
--   { status, role, expires_at, email_matches, email_confirmed, already_member }.
create or replace function public.platform_staff_invitation_preview(
  p_server_key text,
  p_token_hash text,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row private.platform_staff_invitations%rowtype;
  v_user_email text;
  v_user_confirmed boolean := false;
begin
  perform private.check_platform_server_key(p_server_key);

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select i.* into v_row
  from private.platform_staff_invitations i
  where i.token_hash = p_token_hash;

  if not found then
    return null;
  end if;

  if p_user_id is not null then
    select lower(u.email), u.email_confirmed_at is not null
    into v_user_email, v_user_confirmed
    from auth.users u
    where u.id = p_user_id;
  end if;

  return jsonb_build_object(
    'status', case
      when v_row.revoked_at is not null then 'revogado'
      when v_row.accepted_at is not null then 'usado'
      when v_row.expires_at <= now() then 'expirado'
      else 'valido'
    end,
    'role', v_row.role,
    'expires_at', v_row.expires_at,
    'email_matches', v_user_email is not null and v_user_email = v_row.email,
    'email_confirmed', coalesce(v_user_confirmed, false),
    'already_member', p_user_id is not null and exists (
      select 1
      from private.platform_staff s
      where s.user_id = p_user_id
        and s.active
    )
  );
end;
$$;

comment on function public.platform_staff_invitation_preview(text, text, uuid) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY): prévia do convite da equipe pelo hash do token (situação, papel e validade; nunca o e-mail). Com a conta logada, diz se o e-mail dela é o convidado, se está confirmado e se já é da equipe. null quando o token não existe.';

-- Aceite: a conta (id vindo da sessão conferida no servidor) precisa ter o
-- e-mail IGUAL ao convidado e CONFIRMADO. Grava a pessoa na equipe, fecha o
-- convite (uso único) e o registro, tudo na mesma transação.
-- Retorno: { user_id, email, role, invitation_id, invited_by_email, rejoined }.
-- Erros: 42501 chave | conta_invalida | email_diferente | email_nao_confirmado;
--        P0002 convite_invalido; P0001 convite_revogado | convite_usado |
--        convite_expirado | ja_e_da_equipe.
create or replace function public.platform_staff_accept_invitation(
  p_server_key text,
  p_user_id uuid,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := now();
  v_invitation private.platform_staff_invitations%rowtype;
  v_user_email text;
  v_user_confirmed_at timestamptz;
  v_staff private.platform_staff%rowtype;
  v_rejoined boolean := false;
begin
  perform private.check_platform_server_key(p_server_key);

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'convite_invalido' using errcode = 'P0002';
  end if;

  select i.* into v_invitation
  from private.platform_staff_invitations i
  where i.token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'convite_invalido' using errcode = 'P0002';
  end if;

  if v_invitation.revoked_at is not null then
    raise exception 'convite_revogado' using errcode = 'P0001';
  end if;

  if v_invitation.accepted_at is not null then
    raise exception 'convite_usado' using errcode = 'P0001';
  end if;

  if v_invitation.expires_at <= v_now then
    raise exception 'convite_expirado' using errcode = 'P0001';
  end if;

  select lower(u.email), u.email_confirmed_at
  into v_user_email, v_user_confirmed_at
  from auth.users u
  where u.id = p_user_id;

  if not found or v_user_email is null then
    raise exception 'conta_invalida' using errcode = '42501';
  end if;

  if v_user_email <> v_invitation.email then
    raise exception 'email_diferente' using errcode = '42501';
  end if;

  if v_user_confirmed_at is null then
    raise exception 'email_nao_confirmado' using errcode = '42501';
  end if;

  select s.* into v_staff
  from private.platform_staff s
  where s.user_id = p_user_id
  for update;

  if found and v_staff.active then
    raise exception 'ja_e_da_equipe' using errcode = 'P0001';
  end if;

  if found then
    v_rejoined := true;

    update private.platform_staff s
    set email = v_invitation.email,
        role = v_invitation.role,
        active = true,
        invitation_id = v_invitation.id,
        invited_by_user_id = v_invitation.invited_by_user_id,
        invited_by_email = v_invitation.invited_by_email,
        joined_at = v_now,
        role_changed_at = null,
        removed_at = null,
        removed_by_user_id = null,
        updated_at = v_now
    where s.user_id = p_user_id;
  else
    insert into private.platform_staff (
      user_id, email, role, invitation_id, invited_by_user_id, invited_by_email, joined_at
    )
    values (
      p_user_id, v_invitation.email, v_invitation.role, v_invitation.id,
      v_invitation.invited_by_user_id, v_invitation.invited_by_email, v_now
    );
  end if;

  update private.platform_staff_invitations i
  set accepted_at = v_now,
      accepted_by_user_id = p_user_id
  where i.id = v_invitation.id;

  perform private.insert_platform_audit_event(
    p_user_id,
    v_invitation.email,
    'equipe.aceitar_convite',
    'membro_equipe',
    p_user_id::text,
    null,
    null,
    null,
    jsonb_build_object(
      'papel', v_invitation.role,
      'convite', v_invitation.id,
      'voltou_para_a_equipe', v_rejoined
    )
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'email', v_invitation.email,
    'role', v_invitation.role,
    'invitation_id', v_invitation.id,
    'invited_by_email', v_invitation.invited_by_email,
    'rejoined', v_rejoined
  );
end;
$$;

comment on function public.platform_staff_accept_invitation(text, uuid, text) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), com o id da conta vindo da sessão conferida: aceita o convite da equipe pelo hash do token. Exige e-mail da conta igual ao convidado e confirmado (auth.users); recusa token expirado, usado ou revogado. Grava a pessoa na equipe, fecha o convite e grava equipe.aceitar_convite no registro na mesma transação.';

-- -----------------------------------------------------------------------------
-- 5. Gestão da equipe
-- -----------------------------------------------------------------------------

-- Equipe para /plataforma/equipe. p_owner_emails são os Donos da variável do
-- servidor (até 20): volta só se já têm conta confirmada. Retorno:
--   { owners: [{ email, has_account }],
--     members: [{ user_id, email, role, joined_at, invited_by_email,
--                 role_changed_at, account_email_matches, is_owner_email }],
--     invitations: [{ id, email, role, expires_at, expired, created_at,
--                     last_sent_at, send_count, invited_by_email }],
--     limits: { pending, max_pending, sends_last_24h, max_sends_per_day } }
create or replace function public.platform_staff_list(
  p_server_key text,
  p_owner_emails text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := now();
  v_owners text[];
begin
  perform private.check_platform_server_key(p_server_key);

  if cardinality(coalesce(p_owner_emails, '{}'::text[])) > 20 then
    raise exception 'donos_demais' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct lower(btrim(o.email))), '{}'::text[])
  into v_owners
  from unnest(coalesce(p_owner_emails, '{}'::text[])) as o(email)
  where o.email is not null
    and lower(btrim(o.email)) ~ '^[^[:space:]@]+@[^[:space:]@]+$';

  return jsonb_build_object(
    'owners', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', o.email,
        'has_account', u.id is not null and u.email_confirmed_at is not null
      ) order by o.email)
      from unnest(v_owners) as o(email)
      left join lateral (
        select u2.id, u2.email_confirmed_at
        from auth.users u2
        where lower(u2.email) = o.email
        order by u2.email_confirmed_at desc nulls last
        limit 1
      ) u on true
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', s.user_id,
        'email', s.email,
        'role', s.role,
        'joined_at', s.joined_at,
        'invited_by_email', s.invited_by_email,
        'role_changed_at', s.role_changed_at,
        'account_email_matches', u.email_confirmed_at is not null and lower(u.email) = s.email,
        'is_owner_email', s.email = any (v_owners)
      ) order by s.joined_at, s.email)
      from private.platform_staff s
      join auth.users u on u.id = s.user_id
      where s.active
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'email', i.email,
        'role', i.role,
        'expires_at', i.expires_at,
        'expired', i.expires_at <= v_now,
        'created_at', i.created_at,
        'last_sent_at', i.last_sent_at,
        'send_count', i.send_count,
        'invited_by_email', i.invited_by_email
      ) order by i.created_at desc)
      from private.platform_staff_invitations i
      where i.accepted_at is null
        and i.revoked_at is null
    ), '[]'::jsonb),
    'limits', jsonb_build_object(
      'pending', (
        select count(*)
        from private.platform_staff_invitations i
        where i.accepted_at is null
          and i.revoked_at is null
          and i.expires_at > v_now
      ),
      'max_pending', 20,
      'sends_last_24h', (
        select count(*)
        from private.platform_audit_events e
        where e.action in ('equipe.convidar', 'equipe.reenviar_convite')
          and e.occurred_at > v_now - interval '24 hours'
      ),
      'max_sends_per_day', 30
    )
  );
end;
$$;

comment on function public.platform_staff_list(text, text[]) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY): equipe do Console da Plataforma para /plataforma/equipe — Donos informados pelo servidor (se já têm conta confirmada), pessoas ativas (papel, desde quando, quem convidou), convites abertos e as travas de envio.';

-- Retorno: { user_id, role_before, role }.
-- Erros: 42501 chave ou quem age não é Dono; 22023 papel_invalido;
--        P0002 membro_nao_encontrado; P0001 papel_igual.
create or replace function public.platform_staff_set_role(
  p_server_key text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := now();
  v_staff private.platform_staff%rowtype;
begin
  perform private.check_platform_server_key(p_server_key);
  perform private.platform_staff_assert_manager(p_actor_user_id, p_actor_email);

  if p_role is null or p_role not in ('admin', 'viewer') then
    raise exception 'papel_invalido' using errcode = '22023';
  end if;

  select s.* into v_staff
  from private.platform_staff s
  where s.user_id = p_user_id
    and s.active
  for update;

  if not found then
    raise exception 'membro_nao_encontrado' using errcode = 'P0002';
  end if;

  if v_staff.role = p_role then
    raise exception 'papel_igual' using errcode = 'P0001';
  end if;

  update private.platform_staff s
  set role = p_role,
      role_changed_at = v_now,
      updated_at = v_now
  where s.user_id = p_user_id;

  perform private.insert_platform_audit_event(
    p_actor_user_id,
    p_actor_email,
    'equipe.mudar_papel',
    'membro_equipe',
    p_user_id::text,
    null,
    null,
    jsonb_build_object('papel', v_staff.role),
    jsonb_build_object('papel', p_role)
  );

  return jsonb_build_object('user_id', p_user_id, 'role_before', v_staff.role, 'role', p_role);
end;
$$;

comment on function public.platform_staff_set_role(text, uuid, text, uuid, text) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir que quem age é Dono: muda o papel de uma pessoa ativa da equipe (admin ou viewer). Vale na próxima requisição. Grava equipe.mudar_papel no registro.';

-- Remove da equipe (desativa; a linha fica para o histórico). Quem está na
-- equipe pode remover a si mesmo (ex.: pessoa que virou Dona pela variável).
-- Retorno: { user_id, role, removed_at }.
-- Erros: 42501 chave ou quem age não é Dono; P0002 membro_nao_encontrado.
create or replace function public.platform_staff_remove(
  p_server_key text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := now();
  v_staff private.platform_staff%rowtype;
begin
  perform private.check_platform_server_key(p_server_key);

  if p_user_id is not null and p_user_id = p_actor_user_id then
    perform private.platform_assert_actor(p_actor_user_id, p_actor_email);
  else
    perform private.platform_staff_assert_manager(p_actor_user_id, p_actor_email);
  end if;

  select s.* into v_staff
  from private.platform_staff s
  where s.user_id = p_user_id
    and s.active
  for update;

  if not found then
    raise exception 'membro_nao_encontrado' using errcode = 'P0002';
  end if;

  update private.platform_staff s
  set active = false,
      removed_at = v_now,
      removed_by_user_id = p_actor_user_id,
      updated_at = v_now
  where s.user_id = p_user_id;

  perform private.insert_platform_audit_event(
    p_actor_user_id,
    p_actor_email,
    'equipe.remover',
    'membro_equipe',
    p_user_id::text,
    null,
    null,
    jsonb_build_object('papel', v_staff.role, 'ativo', true),
    jsonb_build_object('ativo', false)
  );

  return jsonb_build_object('user_id', p_user_id, 'role', v_staff.role, 'removed_at', v_now);
end;
$$;

comment on function public.platform_staff_remove(text, uuid, text, uuid) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir que quem age é Dono: remove a pessoa da equipe (active = false; o acesso acaba na próxima requisição). A própria pessoa pode sair. Grava equipe.remover no registro.';

-- -----------------------------------------------------------------------------
-- Privilégios: RPCs com chave do servidor só para anon (o servidor chama sem sessão)
-- -----------------------------------------------------------------------------
revoke all on function public.platform_staff_role(text, uuid) from public, anon, authenticated;
revoke all on function public.platform_staff_invite(text, uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.platform_staff_resend_invitation(text, uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.platform_staff_revoke_invitation(text, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.platform_staff_invitation_preview(text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.platform_staff_accept_invitation(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.platform_staff_list(text, text[]) from public, anon, authenticated;
revoke all on function public.platform_staff_set_role(text, uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.platform_staff_remove(text, uuid, text, uuid)
  from public, anon, authenticated;

grant execute on function public.platform_staff_role(text, uuid) to anon;
grant execute on function public.platform_staff_invite(text, uuid, text, text, text, text) to anon;
grant execute on function public.platform_staff_resend_invitation(text, uuid, text, uuid, text) to anon;
grant execute on function public.platform_staff_revoke_invitation(text, uuid, text, uuid) to anon;
grant execute on function public.platform_staff_invitation_preview(text, text, uuid) to anon;
grant execute on function public.platform_staff_accept_invitation(text, uuid, text) to anon;
grant execute on function public.platform_staff_list(text, text[]) to anon;
grant execute on function public.platform_staff_set_role(text, uuid, text, uuid, text) to anon;
grant execute on function public.platform_staff_remove(text, uuid, text, uuid) to anon;
