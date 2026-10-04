-- =============================================================================
-- 3200 - WhatsApp oficial sobre "Contas conectadas"
-- =============================================================================
-- O canal roda na conta da imobiliária (Tech Provider da Meta): a WABA é dela,
-- o cartão é dela, a Facebook Brasil fatura ela. Nós não entramos no custo de
-- mensagem em hipótese alguma — não há tabela de medição financeira aqui de
-- propósito.
--
-- Quatro coisas que o schema garante e a tela não pode contrariar:
--
--   1. "ENVIADO" NÃO É "ENTREGUE". `whatsapp_message_status` separa `accepted`
--      (a Meta aceitou o pedido e devolveu um wamid), `sent` (saiu dos
--      servidores dela) e `delivered` (chegou ao aparelho). A própria Meta
--      avisa: "This response only indicates that the API successfully accepted
--      your request — it does not indicate successful delivery of your
--      message."
--   2. MENSAGEM RETIDA E DESCARTADA TEM ESTADO PRÓPRIO. Template pausado por
--      baixa qualidade (erro 132015) faz a Meta DESCARTAR as mensagens retidas
--      — elas não voltam para a fila. Isso vira `discarded`, não `failed`
--      genérico, porque a ação humana é outra.
--   3. A SUPRESSÃO NÃO TEM COMO SER CONTORNADA. `whatsapp_suppressions` não tem
--      política de INSERT, UPDATE nem DELETE: nem o dono apaga uma linha. Sair
--      da lista exige consentimento novo, posterior à supressão, e passa por
--      uma RPC que confere isso no banco.
--   4. O ENVIO PARA NUMA QUEDA DE QUALIDADE. `RED` no número suspende o envio
--      sozinho. É sobrevivência nossa: pelos Tech Provider Terms §2.1 a conduta
--      de cada cliente também é nossa.
--
--  1. Enums
--  2. public.whatsapp_channels
--  3. public.whatsapp_conversations
--  4. public.whatsapp_messages
--  5. public.whatsapp_suppressions
--  6. Helpers private
--  7. RPCs com sessão
--  8. RPCs do servidor (webhook e envio)
--  9. Grants
--
-- Espelho de packages/core/src/whatsapp/protocol.ts.

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------

create type public.whatsapp_message_direction as enum ('inbound', 'outbound');

create type public.whatsapp_message_status as enum (
  'queued',
  'accepted',
  'held',
  'sent',
  'delivered',
  'read',
  'played',
  'failed',
  'discarded'
);

create type public.whatsapp_quality_rating as enum ('GREEN', 'YELLOW', 'RED', 'UNKNOWN');

create type public.whatsapp_suppression_scope as enum ('marketing', 'all');

create type public.whatsapp_suppression_source as enum (
  'user_preferences',
  'delivery_error',
  'keyword',
  'consent_revoked',
  'manual'
);

-- -----------------------------------------------------------------------------
-- 2. public.whatsapp_channels — um número
-- -----------------------------------------------------------------------------

create table public.whatsapp_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  connected_account_id uuid not null,
  waba_id text not null
    constraint whatsapp_channels_waba_id_check check (waba_id ~ '^[0-9]{5,30}$'),
  phone_number_id text not null
    constraint whatsapp_channels_phone_number_id_check check (phone_number_id ~ '^[0-9]{5,30}$'),
  display_phone_number text
    constraint whatsapp_channels_display_phone_check check (char_length(display_phone_number) <= 30),
  verified_name text
    constraint whatsapp_channels_verified_name_check check (char_length(verified_name) <= 200),
  quality_rating public.whatsapp_quality_rating not null default 'UNKNOWN',
  -- `messaging_limit_tier` foi depreciado pela Meta: o campo vigente é
  -- `whatsapp_business_manager_messaging_limit` e o limite é do PORTFÓLIO.
  messaging_tier text not null default 'TIER_NOT_SET'
    constraint whatsapp_channels_messaging_tier_check
      check (messaging_tier in ('TIER_NOT_SET', 'TIER_50', 'TIER_250', 'TIER_2K', 'TIER_10K', 'TIER_100K', 'TIER_UNLIMITED')),
  throughput integer
    constraint whatsapp_channels_throughput_check check (throughput is null or throughput between 0 and 1000000),
  enabled boolean not null default true,
  -- Suspensão automática por queda de qualidade. Só a rotina do servidor liga;
  -- religar exige a qualidade voltar.
  auto_suspended_at timestamptz,
  auto_suspended_reason text
    constraint whatsapp_channels_auto_suspended_reason_check
      check (char_length(auto_suspended_reason) <= 300),
  last_quality_change_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_channels_organization_id_id_key unique (organization_id, id),
  constraint whatsapp_channels_account_fkey foreign key (organization_id, connected_account_id)
    references public.connected_accounts (organization_id, id) on delete cascade
);

-- O mesmo número nunca em duas imobiliárias.
create unique index whatsapp_channels_phone_number_id_key
  on public.whatsapp_channels (phone_number_id);

create index whatsapp_channels_organization_idx on public.whatsapp_channels (organization_id);
create index whatsapp_channels_account_idx
  on public.whatsapp_channels (organization_id, connected_account_id);
create index whatsapp_channels_waba_idx on public.whatsapp_channels (waba_id);

create trigger whatsapp_channels_set_updated_at
  before update on public.whatsapp_channels
  for each row execute function private.set_updated_at();
create trigger whatsapp_channels_lock_organization_id
  before update on public.whatsapp_channels
  for each row execute function private.lock_organization_id();
create trigger whatsapp_channels_audit
  after insert or update or delete on public.whatsapp_channels
  for each row execute function private.audit_row_change();

alter table public.whatsapp_channels enable row level security;

create policy "whatsapp_channels: membros leem"
  on public.whatsapp_channels for select to authenticated
  using (private.is_member(organization_id));

comment on table public.whatsapp_channels is
  'Números de WhatsApp da imobiliária (a WABA é dela). Escrita só pelas RPCs. auto_suspended_at é a suspensão automática por queda de qualidade do número.';

-- -----------------------------------------------------------------------------
-- 3. public.whatsapp_conversations
-- -----------------------------------------------------------------------------

create table public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel_id uuid not null,
  -- Identificador do contato no WhatsApp: só dígitos, com DDI.
  contact_wa_id text not null
    constraint whatsapp_conversations_contact_wa_id_check check (contact_wa_id ~ '^[0-9]{8,20}$'),
  contact_name text
    constraint whatsapp_conversations_contact_name_check check (char_length(contact_name) <= 200),
  lead_id uuid,
  client_id uuid,
  assigned_to uuid references auth.users (id) on delete set null,
  closed_at timestamptz,
  -- Última mensagem RECEBIDA. É ela que abre a janela de atendimento.
  -- A Meta: "When a WhatsApp user messages you or calls you, a 24-hour timer
  -- called a customer service window starts. If the user messages or calls you
  -- again before the timer expires, the timer resets."
  --
  -- O fim da janela NÃO é coluna gerada: `timestamptz + interval` é STABLE (o
  -- resultado depende do fuso da sessão) e o Postgres recusa expressão não
  -- imutável em coluna gerada (42P17). Quem decide se a janela está aberta é
  -- private.whatsapp_window_open; a tela soma as 24 h a partir daqui com a
  -- mesma constante do core (WHATSAPP_SERVICE_WINDOW_HOURS).
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  last_message_preview text
    constraint whatsapp_conversations_preview_check check (char_length(last_message_preview) <= 160),
  unread_count integer not null default 0
    constraint whatsapp_conversations_unread_check check (unread_count between 0 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_conversations_organization_id_id_key unique (organization_id, id),
  constraint whatsapp_conversations_channel_contact_key unique (organization_id, channel_id, contact_wa_id),
  constraint whatsapp_conversations_channel_fkey foreign key (organization_id, channel_id)
    references public.whatsapp_channels (organization_id, id) on delete cascade,
  constraint whatsapp_conversations_lead_fkey foreign key (organization_id, lead_id)
    references public.leads (organization_id, id) on delete set null (lead_id),
  constraint whatsapp_conversations_client_fkey foreign key (organization_id, client_id)
    references public.clients (organization_id, id) on delete set null (client_id)
);

create index whatsapp_conversations_inbox_idx
  on public.whatsapp_conversations (organization_id, last_message_at desc nulls last);
create index whatsapp_conversations_assigned_idx
  on public.whatsapp_conversations (organization_id, assigned_to, last_message_at desc nulls last);
create index whatsapp_conversations_channel_idx
  on public.whatsapp_conversations (organization_id, channel_id);
create index whatsapp_conversations_lead_idx
  on public.whatsapp_conversations (organization_id, lead_id)
  where lead_id is not null;
create index whatsapp_conversations_client_idx
  on public.whatsapp_conversations (organization_id, client_id)
  where client_id is not null;
create index whatsapp_conversations_assigned_to_idx
  on public.whatsapp_conversations (assigned_to)
  where assigned_to is not null;

create trigger whatsapp_conversations_set_updated_at
  before update on public.whatsapp_conversations
  for each row execute function private.set_updated_at();
create trigger whatsapp_conversations_lock_organization_id
  before update on public.whatsapp_conversations
  for each row execute function private.lock_organization_id();

alter table public.whatsapp_conversations enable row level security;

-- Mesma lógica dos leads: gestão vê tudo; corretor e captador veem as suas e as
-- sem responsável.
create policy "whatsapp_conversations: equipe lê o que lhe cabe"
  on public.whatsapp_conversations for select to authenticated
  using (
    private.has_role(organization_id, '{owner,manager,assistant,finance}')
    or (
      private.has_role(organization_id, '{broker,capturer}')
      and (assigned_to is null or assigned_to = (select auth.uid()))
    )
  );

comment on table public.whatsapp_conversations is
  'Conversa de WhatsApp por contato e número. last_inbound_at é o início da janela de 24 h da Meta (private.whatsapp_window_open decide se está aberta). Escrita só pelas RPCs; com sessão a equipe só altera assigned_to, unread_count e closed_at.';

-- Quem enxerga a conversa enxerga as mensagens dela. Definida aqui porque a
-- politica de whatsapp_messages depende dela.
create or replace function private.can_access_whatsapp_conversation(
  p_organization_id uuid,
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.whatsapp_conversations c
    where c.id = p_conversation_id
      and c.organization_id = p_organization_id
      and (
        private.has_role(c.organization_id, '{owner,manager,assistant,finance}')
        or (
          private.has_role(c.organization_id, '{broker,capturer}')
          and (c.assigned_to is null or c.assigned_to = (select auth.uid()))
        )
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- 4. public.whatsapp_messages
-- -----------------------------------------------------------------------------

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  direction public.whatsapp_message_direction not null,
  status public.whatsapp_message_status not null,
  -- Identificador da Meta. Existir não significa entrega: é só rastreio.
  wamid text
    constraint whatsapp_messages_wamid_check check (char_length(wamid) between 1 and 200),
  body text constraint whatsapp_messages_body_check check (char_length(body) <= 4096),
  media jsonb not null default '[]'::jsonb
    constraint whatsapp_messages_media_check
      check (jsonb_typeof(media) = 'array' and octet_length(media::text) <= 8192),
  template_name text
    constraint whatsapp_messages_template_name_check check (template_name ~ '^[a-z0-9_]{1,512}$'),
  -- Categoria e tipo crus da Meta (pricing.category / pricing.type). O campo
  -- `pricing.billable` será depreciado: não dependemos dele.
  pricing_category text
    constraint whatsapp_messages_pricing_category_check
      check (pricing_category in ('authentication', 'authentication-international', 'marketing', 'marketing_lite', 'referral_conversion', 'service', 'utility')),
  pricing_type text
    constraint whatsapp_messages_pricing_type_check
      check (pricing_type in ('regular', 'free_customer_service', 'free_entry_point')),
  error_code integer,
  error_title text
    constraint whatsapp_messages_error_title_check check (char_length(error_title) <= 300),
  sent_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  constraint whatsapp_messages_organization_id_id_key unique (organization_id, id),
  constraint whatsapp_messages_conversation_fkey foreign key (organization_id, conversation_id)
    references public.whatsapp_conversations (organization_id, id) on delete cascade,
  -- Inbound sem corpo nem mídia não existe; outbound na fila pode ter só corpo.
  constraint whatsapp_messages_content_check
    check (body is not null or jsonb_array_length(media) > 0 or template_name is not null)
);

create unique index whatsapp_messages_wamid_key
  on public.whatsapp_messages (organization_id, wamid)
  where wamid is not null;

create index whatsapp_messages_conversation_idx
  on public.whatsapp_messages (organization_id, conversation_id, created_at desc);
create index whatsapp_messages_status_idx
  on public.whatsapp_messages (organization_id, status, created_at desc);
create index whatsapp_messages_sent_by_idx
  on public.whatsapp_messages (sent_by)
  where sent_by is not null;

alter table public.whatsapp_messages enable row level security;

create policy "whatsapp_messages: quem vê a conversa lê"
  on public.whatsapp_messages for select to authenticated
  using (private.can_access_whatsapp_conversation(organization_id, conversation_id));

comment on table public.whatsapp_messages is
  'Mensagens do WhatsApp. `status` separa aceita pela Meta, enviada e ENTREGUE; `discarded` é mensagem retida que a Meta descartou (erro 132015) e que não volta para a fila. Escrita só pelas RPCs.';

-- -----------------------------------------------------------------------------
-- 5. public.whatsapp_suppressions — o corretor não contorna
-- -----------------------------------------------------------------------------
-- Sem política de INSERT, UPDATE ou DELETE para authenticated. Entrar na lista é
-- pela RPC; sair da lista exige consentimento novo, posterior à supressão.

create table public.whatsapp_suppressions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_wa_id text not null
    constraint whatsapp_suppressions_contact_wa_id_check check (contact_wa_id ~ '^[0-9]{8,20}$'),
  scope public.whatsapp_suppression_scope not null default 'marketing',
  source public.whatsapp_suppression_source not null,
  reason text constraint whatsapp_suppressions_reason_check check (char_length(reason) <= 300),
  evidence jsonb not null default '{}'::jsonb
    constraint whatsapp_suppressions_evidence_check
      check (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 2048),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Saída da lista. A linha continua: a prova de que a pessoa pediu para sair
  -- não some porque ela voltou depois.
  released_at timestamptz,
  released_by uuid references auth.users (id) on delete set null,
  released_reason text
    constraint whatsapp_suppressions_released_reason_check check (char_length(released_reason) <= 300),
  released_consent_id uuid,
  constraint whatsapp_suppressions_organization_id_id_key unique (organization_id, id),
  constraint whatsapp_suppressions_consent_fkey foreign key (organization_id, released_consent_id)
    references public.consent_records (organization_id, id) on delete set null (released_consent_id),
  constraint whatsapp_suppressions_release_check
    check ((released_at is null) = (released_consent_id is null))
);

-- Uma supressão ativa por contato e alcance. A segunda tentativa não cria linha
-- nova: a lista não vira histórico ruidoso.
create unique index whatsapp_suppressions_active_key
  on public.whatsapp_suppressions (organization_id, contact_wa_id, scope)
  where released_at is null;

create index whatsapp_suppressions_contact_idx
  on public.whatsapp_suppressions (organization_id, contact_wa_id, created_at desc);
create index whatsapp_suppressions_created_by_idx
  on public.whatsapp_suppressions (created_by)
  where created_by is not null;
create index whatsapp_suppressions_released_by_idx
  on public.whatsapp_suppressions (released_by)
  where released_by is not null;
create index whatsapp_suppressions_consent_idx
  on public.whatsapp_suppressions (organization_id, released_consent_id)
  where released_consent_id is not null;

alter table public.whatsapp_suppressions enable row level security;

create policy "whatsapp_suppressions: membros leem"
  on public.whatsapp_suppressions for select to authenticated
  using (private.is_member(organization_id));

comment on table public.whatsapp_suppressions is
  'Lista de supressão por imobiliária. Sem INSERT/UPDATE/DELETE por sessão: entrar é pela RPC, sair exige consentimento novo posterior à supressão. A linha nunca é apagada.';

-- -----------------------------------------------------------------------------
-- 6. Helpers private
-- -----------------------------------------------------------------------------

-- Janela de atendimento de 24 h, contada da última mensagem recebida. Uma
-- função só, para a regra viver num lugar e não em cada consulta.
create or replace function private.whatsapp_window_open(p_last_inbound_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_last_inbound_at is not null
    and p_last_inbound_at > now() - interval '24 hours';
$$;

comment on function private.whatsapp_window_open(timestamptz) is
  'Janela de atendimento de 24 h da Meta. Espelho de WHATSAPP_SERVICE_WINDOW_HOURS em packages/core/src/whatsapp/protocol.ts.';

-- Ordem de progresso do estado. Webhook chega fora de ordem o tempo todo: sem
-- isto, um `sent` atrasado desfaria um `delivered` e a tela mentiria para trás.
create or replace function private.whatsapp_status_rank(p_status public.whatsapp_message_status)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'queued' then 0
    when 'held' then 1
    when 'accepted' then 2
    when 'sent' then 3
    when 'delivered' then 4
    when 'read' then 5
    when 'played' then 6
    when 'failed' then 7
    when 'discarded' then 8
    else 0
  end;
$$;

create or replace function private.whatsapp_merge_status(
  p_current public.whatsapp_message_status,
  p_incoming public.whatsapp_message_status
)
returns public.whatsapp_message_status
language sql
immutable
set search_path = ''
as $$
  select case
    when p_current in ('failed', 'discarded') then p_current
    when p_incoming in ('failed', 'discarded') then p_incoming
    when private.whatsapp_status_rank(p_incoming) > private.whatsapp_status_rank(p_current)
      then p_incoming
    else p_current
  end;
$$;

comment on function private.whatsapp_merge_status(public.whatsapp_message_status, public.whatsapp_message_status) is
  'Estado final quando chega um webhook: failed e discarded são definitivos; no resto vence o mais adiantado. Espelho de mergeWhatsappStatus em packages/core/src/whatsapp/protocol.ts.';

-- Tradução do webhook de status para o nosso enum. O erro 132015 (template
-- pausado) é o caso que importa: a Meta DESCARTA as mensagens retidas, então
-- o estado é `discarded`, e não um `failed` que alguém confundiria com "tenta
-- de novo".
create or replace function private.whatsapp_status_from_webhook(
  p_status text,
  p_error_code integer
)
returns public.whatsapp_message_status
language sql
immutable
set search_path = ''
as $$
  select case
    when p_error_code = 132015 then 'discarded'::public.whatsapp_message_status
    when p_status = 'sent' then 'sent'::public.whatsapp_message_status
    when p_status = 'delivered' then 'delivered'::public.whatsapp_message_status
    when p_status = 'read' then 'read'::public.whatsapp_message_status
    when p_status = 'played' then 'played'::public.whatsapp_message_status
    when p_status = 'failed' then 'failed'::public.whatsapp_message_status
    else null::public.whatsapp_message_status
  end;
$$;

create or replace function private.whatsapp_suppressed(
  p_organization_id uuid,
  p_contact_wa_id text,
  p_marketing boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.whatsapp_suppressions s
    where s.organization_id = p_organization_id
      and s.contact_wa_id = p_contact_wa_id
      and s.released_at is null
      and (s.scope = 'all' or (s.scope = 'marketing' and p_marketing))
  );
$$;

comment on function private.whatsapp_suppressed(uuid, text, boolean) is
  'Verdadeiro quando o contato está na lista de supressão do tenant. Escopo `all` barra tudo; `marketing` barra só divulgação.';

create or replace function private.whatsapp_suppress(
  p_organization_id uuid,
  p_contact_wa_id text,
  p_scope public.whatsapp_suppression_scope,
  p_source public.whatsapp_suppression_source,
  p_reason text,
  p_evidence jsonb,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.whatsapp_suppressions
    (organization_id, contact_wa_id, scope, source, reason, evidence, created_by)
  values (
    p_organization_id, p_contact_wa_id, p_scope, p_source,
    left(nullif(btrim(coalesce(p_reason, '')), ''), 300),
    coalesce(p_evidence, '{}'::jsonb), p_created_by
  )
  on conflict (organization_id, contact_wa_id, scope) where released_at is null
  do nothing
  returning id into v_id;

  if v_id is null then
    select s.id into v_id
    from public.whatsapp_suppressions s
    where s.organization_id = p_organization_id
      and s.contact_wa_id = p_contact_wa_id
      and s.scope = p_scope
      and s.released_at is null;
  end if;

  return v_id;
end;
$$;

-- Pode enviar? Uma resposta só, com o motivo. É esta função que garante que
-- nenhum caminho de tela contorne supressão, consentimento ou janela.
create or replace function private.whatsapp_send_block_reason(
  p_conversation_id uuid,
  p_marketing boolean,
  p_template boolean
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.whatsapp_conversations;
  ch public.whatsapp_channels;
begin
  select * into c from public.whatsapp_conversations where id = p_conversation_id;

  if c.id is null then
    return 'conversa_nao_encontrada';
  end if;

  select * into ch from public.whatsapp_channels where id = c.channel_id;

  if ch.id is null then
    return 'numero_nao_encontrado';
  end if;

  if not private.connection_can_send(ch.connected_account_id) then
    return 'conexao_desligada';
  end if;

  if not ch.enabled then
    return 'numero_desligado';
  end if;

  if ch.auto_suspended_at is not null then
    return 'numero_suspenso_por_qualidade';
  end if;

  if private.whatsapp_suppressed(c.organization_id, c.contact_wa_id, p_marketing) then
    return 'contato_na_lista_de_supressao';
  end if;

  if p_marketing and not private.consent_active(
      c.organization_id, 'divulgacao', 'whatsapp', c.contact_wa_id) then
    return 'sem_consentimento_de_divulgacao';
  end if;

  -- Fora da janela de 24 h só sai template aprovado.
  if not p_template and not private.whatsapp_window_open(c.last_inbound_at) then
    return 'janela_de_24h_fechada';
  end if;

  return null;
end;
$$;

comment on function private.whatsapp_send_block_reason(uuid, boolean, boolean) is
  'Motivo pelo qual o envio não pode sair (null = pode). Cobre conexão desligada, número suspenso por qualidade, supressão, consentimento de divulgação e janela de 24 h.';

-- -----------------------------------------------------------------------------
-- 7. RPCs com sessão
-- -----------------------------------------------------------------------------
-- Erros: 42501 sem sessão, sem acesso ou sem papel; 22023 campo inválido;
--        P0002 não encontrado; P0001 regra de negócio (mensagem estável).

create or replace function public.set_whatsapp_channel_enabled(
  p_channel_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  ch public.whatsapp_channels;
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  select * into ch from public.whatsapp_channels where id = p_channel_id;

  if ch.id is null then
    raise exception 'Número não encontrado.' using errcode = 'P0002';
  end if;

  if not private.has_role(ch.organization_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'Só o dono ou o gerente pode ligar e desligar o número.' using errcode = '42501';
  end if;

  if p_enabled and ch.auto_suspended_at is not null then
    raise exception 'numero_suspenso_por_qualidade' using errcode = 'P0001';
  end if;

  update public.whatsapp_channels set enabled = coalesce(p_enabled, true) where id = p_channel_id;

  return jsonb_build_object('enabled', coalesce(p_enabled, true));
end;
$$;

create or replace function public.add_whatsapp_suppression(
  p_organization_id uuid,
  p_contact text,
  p_scope public.whatsapp_suppression_scope default 'marketing',
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_contact text := private.consent_address('whatsapp', p_contact);
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null or not private.is_member(p_organization_id) then
    raise exception 'Você não tem acesso a esta imobiliária.' using errcode = '42501';
  end if;

  if v_contact is null then
    perform private.billing_invalid_field('p_contact');
  end if;

  return private.whatsapp_suppress(
    p_organization_id, v_contact, coalesce(p_scope, 'marketing'), 'manual',
    p_reason, '{}'::jsonb, v_user
  );
end;
$$;

comment on function public.add_whatsapp_suppression(uuid, text, public.whatsapp_suppression_scope, text) is
  'Qualquer membro pode pôr um contato na lista de supressão — pedido de descadastramento se honra na hora, sem passar pela chefia.';

create or replace function public.release_whatsapp_suppression(
  p_suppression_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  s public.whatsapp_suppressions;
  v_consent uuid;
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  select * into s from public.whatsapp_suppressions where id = p_suppression_id;

  if s.id is null then
    raise exception 'Registro não encontrado.' using errcode = 'P0002';
  end if;

  if not private.has_role(s.organization_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'Só o dono ou o gerente pode tirar um contato da lista.' using errcode = '42501';
  end if;

  if s.released_at is not null then
    return jsonb_build_object('released', true, 'changed', false);
  end if;

  -- A única saída da lista é consentimento NOVO, registrado depois da
  -- supressão. Sem isso, "tirar da lista" seria só um botão para ignorar o
  -- pedido da pessoa.
  select cr.id into v_consent
  from public.consent_records cr
  where cr.organization_id = s.organization_id
    and cr.channel = 'whatsapp'
    and cr.subject_address = s.contact_wa_id
    and cr.purpose = 'divulgacao'
    and cr.action = 'granted'
    and cr.collected_at > s.created_at
  order by cr.collected_at desc, cr.id desc
  limit 1;

  if v_consent is null then
    raise exception 'sem_consentimento_posterior_a_supressao' using errcode = 'P0001';
  end if;

  update public.whatsapp_suppressions
  set released_at = now(),
      released_by = v_user,
      released_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 300),
      released_consent_id = v_consent
  where id = p_suppression_id;

  return jsonb_build_object('released', true, 'changed', true, 'consent_id', v_consent);
end;
$$;

comment on function public.release_whatsapp_suppression(uuid, text) is
  'Tira o contato da lista SÓ quando existe consentimento de divulgação registrado depois da supressão. A linha original permanece.';

-- Enfileira uma mensagem de saída. Toda a checagem de permissão acontece aqui:
-- não existe política de INSERT em whatsapp_messages, então este é o único
-- caminho com sessão.
create or replace function public.queue_whatsapp_message(
  p_conversation_id uuid,
  p_body text default null,
  p_template_name text default null,
  p_marketing boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  c public.whatsapp_conversations;
  v_reason text;
  v_id uuid;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  select * into c from public.whatsapp_conversations where id = p_conversation_id;

  if c.id is null then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;

  if not private.can_access_whatsapp_conversation(c.organization_id, c.id) then
    raise exception 'Você não tem acesso a esta conversa.' using errcode = '42501';
  end if;

  if v_body is null and p_template_name is null then
    perform private.billing_invalid_field('p_body');
  end if;

  if v_body is not null and char_length(v_body) > 4096 then
    perform private.billing_invalid_field('p_body');
  end if;

  if p_template_name is not null and p_template_name !~ '^[a-z0-9_]{1,512}$' then
    perform private.billing_invalid_field('p_template_name');
  end if;

  v_reason := private.whatsapp_send_block_reason(
    c.id, coalesce(p_marketing, false), p_template_name is not null
  );

  if v_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  insert into public.whatsapp_messages
    (organization_id, conversation_id, direction, status, body, template_name, sent_by)
  values (c.organization_id, c.id, 'outbound', 'queued', v_body, p_template_name, v_user)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'message_id', v_id, 'status', 'queued');
end;
$$;

comment on function public.queue_whatsapp_message(uuid, text, text, boolean) is
  'Único caminho com sessão para enviar. Devolve {ok:false, reason} quando supressão, consentimento, janela de 24 h, número desligado ou conexão bloqueada impedem o envio — nunca enfileira mesmo assim.';

-- -----------------------------------------------------------------------------
-- 8. RPCs do servidor
-- -----------------------------------------------------------------------------

create or replace function public.register_whatsapp_channel(
  p_server_key text default null,
  p_nonce text default null,
  p_organization_id uuid default null,
  p_connected_account_id uuid default null,
  p_waba_id text default null,
  p_phone_number_id text default null,
  p_display_phone_number text default null,
  p_verified_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_owner uuid;
begin
  if not private.connections_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_waba_id is null or p_waba_id !~ '^[0-9]{5,30}$' then
    perform private.billing_invalid_field('p_waba_id');
  end if;

  if p_phone_number_id is null or p_phone_number_id !~ '^[0-9]{5,30}$' then
    perform private.billing_invalid_field('p_phone_number_id');
  end if;

  if not private.consume_server_nonce(p_nonce) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  -- O mesmo número em outra imobiliária é recusado com mensagem estável.
  select ch.organization_id into v_owner
  from public.whatsapp_channels ch
  where ch.phone_number_id = p_phone_number_id;

  if v_owner is not null and v_owner <> p_organization_id then
    raise exception 'numero_ja_conectado_em_outra_imobiliaria' using errcode = 'P0001';
  end if;

  insert into public.whatsapp_channels as ch_row (
    organization_id, connected_account_id, waba_id, phone_number_id,
    display_phone_number, verified_name, last_synced_at
  )
  values (
    p_organization_id, p_connected_account_id, p_waba_id, p_phone_number_id,
    left(nullif(btrim(coalesce(p_display_phone_number, '')), ''), 30),
    left(nullif(btrim(coalesce(p_verified_name, '')), ''), 200),
    now()
  )
  on conflict (phone_number_id) do update
  set connected_account_id = excluded.connected_account_id,
      waba_id = excluded.waba_id,
      display_phone_number = coalesce(excluded.display_phone_number, ch_row.display_phone_number),
      verified_name = coalesce(excluded.verified_name, ch_row.verified_name),
      last_synced_at = now()
  returning id into v_id;

  return jsonb_build_object('channel_id', v_id);
end;
$$;

create or replace function public.sync_whatsapp_channel_health(
  p_server_key text default null,
  p_phone_number_id text default null,
  p_quality_rating text default null,
  p_messaging_tier text default null,
  p_throughput integer default null,
  -- O webhook phone_number_quality_update identifica o número pelo NÚMERO
  -- EXIBIDO, não pelo id: dá para chegar ao canal por qualquer um dos dois.
  p_display_phone_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ch public.whatsapp_channels;
  v_quality public.whatsapp_quality_rating;
  v_suspend boolean := false;
begin
  if not private.connections_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select * into ch
  from public.whatsapp_channels c
  where (p_phone_number_id is not null and c.phone_number_id = p_phone_number_id)
     or (
       p_phone_number_id is null
       and p_display_phone_number is not null
       and regexp_replace(coalesce(c.display_phone_number, ''), '[^0-9]', '', 'g')
         = regexp_replace(p_display_phone_number, '[^0-9]', '', 'g')
     )
  limit 1;

  if ch.id is null then
    return jsonb_build_object('ok', false, 'reason', 'numero_nao_encontrado');
  end if;

  v_quality := case upper(coalesce(p_quality_rating, ''))
    when 'GREEN' then 'GREEN'::public.whatsapp_quality_rating
    when 'YELLOW' then 'YELLOW'::public.whatsapp_quality_rating
    when 'RED' then 'RED'::public.whatsapp_quality_rating
    when 'UNKNOWN' then 'UNKNOWN'::public.whatsapp_quality_rating
    else ch.quality_rating
  end;

  -- Qualidade RED suspende o envio sozinha. Não é recurso: é o que evita que a
  -- conduta de um cliente derrube o canal e nos exponha ao desligamento.
  v_suspend := v_quality = 'RED';

  update public.whatsapp_channels
  set quality_rating = v_quality,
      last_quality_change_at = case when v_quality is distinct from ch.quality_rating
        then now() else last_quality_change_at end,
      messaging_tier = case
        when upper(coalesce(p_messaging_tier, '')) in
          ('TIER_NOT_SET', 'TIER_50', 'TIER_250', 'TIER_2K', 'TIER_10K', 'TIER_100K', 'TIER_UNLIMITED')
        then upper(p_messaging_tier) else messaging_tier end,
      throughput = coalesce(p_throughput, throughput),
      auto_suspended_at = case
        when v_suspend and auto_suspended_at is null then now()
        when v_suspend then auto_suspended_at
        else null end,
      auto_suspended_reason = case
        when v_suspend then 'Qualidade do número caiu para RED (bloqueios e denúncias dos últimos 7 dias).'
        else null end,
      last_synced_at = now()
  where id = ch.id;

  return jsonb_build_object(
    'ok', true,
    'quality_rating', v_quality,
    'auto_suspended', v_suspend
  );
end;
$$;

comment on function public.sync_whatsapp_channel_health(text, text, text, text, integer, text) is
  'Atualiza qualidade, tier e throughput do número. Qualidade RED liga a suspensão automática de envio; qualquer outra a desliga.';

create or replace function public.ingest_whatsapp_message(
  p_server_key text default null,
  p_phone_number_id text default null,
  p_wamid text default null,
  p_contact_wa_id text default null,
  p_contact_name text default null,
  p_body text default null,
  p_media jsonb default '[]'::jsonb,
  p_sent_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ch public.whatsapp_channels;
  c public.whatsapp_conversations;
  v_contact text;
  v_body text := left(nullif(btrim(coalesce(p_body, '')), ''), 4096);
  v_at timestamptz := coalesce(p_sent_at, now());
  v_message_id uuid;
begin
  if not private.connections_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  v_contact := private.consent_address('whatsapp', p_contact_wa_id);

  if v_contact is null or p_wamid is null or char_length(p_wamid) not between 1 and 200 then
    perform private.billing_invalid_field('p_wamid');
  end if;

  select * into ch from public.whatsapp_channels where phone_number_id = p_phone_number_id;

  if ch.id is null then
    return jsonb_build_object('ok', false, 'reason', 'numero_nao_encontrado');
  end if;

  -- Serializa a conversa: duas entregas do mesmo webhook não criam duas linhas.
  perform pg_advisory_xact_lock(
    hashtextextended('whatsapp_conversation:' || ch.id::text || ':' || v_contact, 0)
  );

  insert into public.whatsapp_conversations as conv (
    organization_id, channel_id, contact_wa_id, contact_name,
    last_inbound_at, last_message_at, last_message_preview, unread_count
  )
  values (
    ch.organization_id, ch.id, v_contact,
    left(nullif(btrim(coalesce(p_contact_name, '')), ''), 200),
    v_at, v_at, left(coalesce(v_body, '[mídia]'), 160), 1
  )
  on conflict (organization_id, channel_id, contact_wa_id) do update
  set contact_name = coalesce(
        left(nullif(btrim(coalesce(p_contact_name, '')), ''), 200),
        conv.contact_name
      ),
      last_inbound_at = greatest(coalesce(conv.last_inbound_at, v_at), v_at),
      last_message_at = greatest(coalesce(conv.last_message_at, v_at), v_at),
      last_message_preview = left(coalesce(v_body, '[mídia]'), 160),
      unread_count = least(conv.unread_count + 1, 100000),
      closed_at = null
  returning * into c;

  insert into public.whatsapp_messages (
    organization_id, conversation_id, direction, status, wamid, body, media, created_at
  )
  values (
    c.organization_id, c.id, 'inbound', 'delivered', p_wamid, v_body,
    case when jsonb_typeof(p_media) = 'array' and octet_length(p_media::text) <= 8192
      then p_media else '[]'::jsonb end,
    v_at
  )
  on conflict (organization_id, wamid) where wamid is not null do nothing
  returning id into v_message_id;

  return jsonb_build_object(
    'ok', true,
    'conversation_id', c.id,
    'message_id', v_message_id,
    'duplicate', v_message_id is null
  );
end;
$$;

comment on function public.ingest_whatsapp_message(text, text, text, text, text, text, jsonb, timestamptz) is
  'Grava uma mensagem recebida e reabre a janela de 24 h. Idempotente pelo wamid: reentrega do webhook não duplica nada.';

create or replace function public.update_whatsapp_message_status(
  p_server_key text default null,
  p_phone_number_id text default null,
  p_wamid text default null,
  p_status text default null,
  p_error_code integer default null,
  p_error_title text default null,
  p_pricing_category text default null,
  p_pricing_type text default null,
  p_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ch public.whatsapp_channels;
  m public.whatsapp_messages;
  c public.whatsapp_conversations;
  v_new public.whatsapp_message_status;
  v_merged public.whatsapp_message_status;
  v_at timestamptz := coalesce(p_at, now());
  v_suppressed boolean := false;
begin
  if not private.connections_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  v_new := private.whatsapp_status_from_webhook(p_status, p_error_code);

  if v_new is null then
    return jsonb_build_object('ok', false, 'reason', 'status_desconhecido');
  end if;

  -- O webhook identifica o NÚMERO, nunca a imobiliária: a organização é
  -- derivada aqui, e não recebida de quem chamou.
  select * into ch from public.whatsapp_channels where phone_number_id = p_phone_number_id;

  if ch.id is null then
    return jsonb_build_object('ok', false, 'reason', 'numero_nao_encontrado');
  end if;

  select * into m
  from public.whatsapp_messages
  where organization_id = ch.organization_id and wamid = p_wamid
  for update;

  if m.id is null then
    return jsonb_build_object('ok', false, 'reason', 'mensagem_nao_encontrada');
  end if;

  v_merged := private.whatsapp_merge_status(m.status, v_new);

  update public.whatsapp_messages
  set status = v_merged,
      error_code = coalesce(p_error_code, error_code),
      error_title = coalesce(left(nullif(btrim(coalesce(p_error_title, '')), ''), 300), error_title),
      pricing_category = coalesce(p_pricing_category, pricing_category),
      pricing_type = coalesce(p_pricing_type, pricing_type),
      sent_at = case when v_new = 'sent' then coalesce(sent_at, v_at) else sent_at end,
      delivered_at = case when v_new = 'delivered' then coalesce(delivered_at, v_at) else delivered_at end,
      read_at = case when v_new in ('read', 'played') then coalesce(read_at, v_at) else read_at end,
      failed_at = case when v_new in ('failed', 'discarded') then coalesce(failed_at, v_at) else failed_at end
  where id = m.id;

  -- 131050: "This recipient has chosen to stop receiving marketing messages on
  -- WhatsApp from your business." A Meta manda não tentar de novo — então o
  -- contato entra na supressão e a revogação fica registrada com prova.
  if p_error_code = 131050 then
    select * into c from public.whatsapp_conversations where id = m.conversation_id;

    if c.id is not null then
      perform private.whatsapp_suppress(
        c.organization_id, c.contact_wa_id, 'marketing', 'delivery_error',
        'Meta 131050: o contato desligou as mensagens de divulgação desta empresa.',
        jsonb_build_object('wamid', p_wamid, 'error_code', p_error_code), null
      );

      perform private.record_consent_row(
        c.organization_id, 'revoked', 'divulgacao', 'whatsapp', 'whatsapp_opt_in',
        c.contact_wa_id,
        'A Meta recusou a entrega com o erro 131050: o contato desligou o recebimento de mensagens de divulgação desta empresa no WhatsApp.',
        'meta-131050',
        c.contact_name, c.lead_id, c.client_id,
        jsonb_build_object('wamid', p_wamid, 'error_code', p_error_code, 'origem', 'webhook_statuses'),
        null
      );

      v_suppressed := true;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'status', v_merged, 'suppressed', v_suppressed);
end;
$$;

comment on function public.update_whatsapp_message_status(text, text, text, text, integer, text, text, text, timestamptz) is
  'Aplica um webhook de status. Webhook atrasado nunca faz o estado andar para trás; 132015 vira `discarded` (a Meta descarta as retidas) e 131050 põe o contato na supressão e registra a revogação.';

create or replace function public.set_whatsapp_marketing_preference(
  p_server_key text default null,
  p_phone_number_id text default null,
  p_contact_wa_id text default null,
  p_value text default null,
  p_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ch public.whatsapp_channels;
  c public.whatsapp_conversations;
  v_contact text;
  v_stop boolean;
begin
  if not private.connections_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if coalesce(p_value, '') not in ('stop', 'resume') then
    perform private.billing_invalid_field('p_value');
  end if;

  v_contact := private.consent_address('whatsapp', p_contact_wa_id);

  if v_contact is null then
    perform private.billing_invalid_field('p_contact_wa_id');
  end if;

  select * into ch from public.whatsapp_channels where phone_number_id = p_phone_number_id;

  if ch.id is null then
    return jsonb_build_object('ok', false, 'reason', 'numero_nao_encontrado');
  end if;

  select * into c
  from public.whatsapp_conversations
  where organization_id = ch.organization_id and channel_id = ch.id and contact_wa_id = v_contact;

  v_stop := p_value = 'stop';

  if v_stop then
    perform private.whatsapp_suppress(
      ch.organization_id, v_contact, 'marketing', 'user_preferences',
      'O contato desligou "Ofertas e avisos" no WhatsApp.',
      jsonb_build_object('field', 'user_preferences', 'value', 'stop'), null
    );

    perform private.record_consent_row(
      ch.organization_id, 'revoked', 'divulgacao', 'whatsapp', 'whatsapp_opt_in', v_contact,
      'O contato desligou o recebimento de mensagens de divulgação desta empresa diretamente no WhatsApp (webhook user_preferences, categoria marketing_messages, valor stop).',
      'meta-user-preferences',
      c.contact_name, c.lead_id, c.client_id,
      jsonb_build_object('field', 'user_preferences', 'value', 'stop', 'at', coalesce(p_at, now())),
      null
    );
  else
    -- "resume" só pode partir do próprio titular, e é ele quem a Meta reporta:
    -- vale como consentimento novo e, por isso, libera a supressão.
    perform private.record_consent_row(
      ch.organization_id, 'granted', 'divulgacao', 'whatsapp', 'whatsapp_opt_in', v_contact,
      'O contato religou o recebimento de mensagens de divulgação desta empresa diretamente no WhatsApp (webhook user_preferences, categoria marketing_messages, valor resume).',
      'meta-user-preferences',
      c.contact_name, c.lead_id, c.client_id,
      jsonb_build_object('field', 'user_preferences', 'value', 'resume', 'at', coalesce(p_at, now())),
      null
    );

    update public.whatsapp_suppressions s
    set released_at = now(),
        released_reason = 'O contato religou "Ofertas e avisos" no WhatsApp.',
        released_consent_id = (
          select cr.id from public.consent_records cr
          where cr.organization_id = ch.organization_id
            and cr.channel = 'whatsapp'
            and cr.subject_address = v_contact
            and cr.purpose = 'divulgacao'
            and cr.action = 'granted'
          order by cr.collected_at desc, cr.id desc
          limit 1
        )
    where s.organization_id = ch.organization_id
      and s.contact_wa_id = v_contact
      and s.scope = 'marketing'
      and s.source = 'user_preferences'
      and s.released_at is null;
  end if;

  return jsonb_build_object('ok', true, 'value', p_value);
end;
$$;

comment on function public.set_whatsapp_marketing_preference(text, text, text, text, timestamptz) is
  'Webhook `user_preferences` da Meta (stop/resume de mensagens de divulgação). `stop` suprime e registra a revogação; `resume` registra consentimento novo e libera a supressão que veio do mesmo canal.';

create or replace function public.mark_whatsapp_message_sent(
  p_server_key text default null,
  p_message_id uuid default null,
  p_wamid text default null,
  p_message_status text default null,
  p_error_code integer default null,
  p_error_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.whatsapp_messages;
  v_status public.whatsapp_message_status;
begin
  if not private.connections_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select * into m from public.whatsapp_messages where id = p_message_id for update;

  if m.id is null then
    return jsonb_build_object('ok', false, 'reason', 'mensagem_nao_encontrada');
  end if;

  -- `held_for_quality_assessment` é template retido: pode ser liberado ou
  -- DESCARTADO. Enquanto não se sabe, a tela não diz "enviada".
  v_status := case
    when p_error_code is not null then 'failed'::public.whatsapp_message_status
    when p_message_status = 'held_for_quality_assessment' then 'held'::public.whatsapp_message_status
    when p_wamid is not null then 'accepted'::public.whatsapp_message_status
    else 'failed'::public.whatsapp_message_status
  end;

  update public.whatsapp_messages
  set status = private.whatsapp_merge_status(m.status, v_status),
      wamid = coalesce(p_wamid, wamid),
      error_code = coalesce(p_error_code, error_code),
      error_title = coalesce(left(nullif(btrim(coalesce(p_error_title, '')), ''), 300), error_title),
      accepted_at = case when v_status in ('accepted', 'held') then coalesce(accepted_at, now()) else accepted_at end,
      failed_at = case when v_status = 'failed' then coalesce(failed_at, now()) else failed_at end
  where id = m.id;

  update public.whatsapp_conversations
  set last_message_at = greatest(coalesce(last_message_at, now()), now()),
      last_message_preview = left(coalesce(m.body, '[modelo]'), 160)
  where id = m.conversation_id;

  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

comment on function public.mark_whatsapp_message_sent(text, uuid, text, text, integer, text) is
  'Fecha o ciclo do envio com o que a API devolveu. `accepted` é o máximo que a resposta da API prova — entrega só existe quando chega o webhook `delivered`.';

-- -----------------------------------------------------------------------------
-- 9. Grants
-- -----------------------------------------------------------------------------

revoke all on public.whatsapp_channels from public, anon, authenticated;
grant select on public.whatsapp_channels to authenticated;

revoke all on public.whatsapp_conversations from public, anon, authenticated;
grant select on public.whatsapp_conversations to authenticated;
-- Única escrita com sessão em toda a caixa: marcar como lida e atribuir.
grant update (assigned_to, unread_count, closed_at) on public.whatsapp_conversations to authenticated;

create policy "whatsapp_conversations: equipe atualiza o que lhe cabe"
  on public.whatsapp_conversations for update to authenticated
  using (private.can_access_whatsapp_conversation(organization_id, id))
  with check (private.can_access_whatsapp_conversation(organization_id, id));

revoke all on public.whatsapp_messages from public, anon, authenticated;
grant select on public.whatsapp_messages to authenticated;

revoke all on public.whatsapp_suppressions from public, anon, authenticated;
grant select on public.whatsapp_suppressions to authenticated;

revoke all on function private.can_access_whatsapp_conversation(uuid, uuid) from public, anon, authenticated;
grant execute on function private.can_access_whatsapp_conversation(uuid, uuid) to authenticated;

revoke all on function private.whatsapp_window_open(timestamptz) from public, anon, authenticated;
grant execute on function private.whatsapp_window_open(timestamptz) to authenticated;
revoke all on function private.whatsapp_status_rank(public.whatsapp_message_status) from public, anon, authenticated;
revoke all on function private.whatsapp_merge_status(public.whatsapp_message_status, public.whatsapp_message_status) from public, anon, authenticated;
revoke all on function private.whatsapp_status_from_webhook(text, integer) from public, anon, authenticated;
revoke all on function private.whatsapp_suppressed(uuid, text, boolean) from public, anon, authenticated;
revoke all on function private.whatsapp_suppress(uuid, text, public.whatsapp_suppression_scope, public.whatsapp_suppression_source, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function private.whatsapp_send_block_reason(uuid, boolean, boolean) from public, anon, authenticated;

revoke all on function public.set_whatsapp_channel_enabled(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_whatsapp_channel_enabled(uuid, boolean) to authenticated;

revoke all on function public.add_whatsapp_suppression(uuid, text, public.whatsapp_suppression_scope, text) from public, anon, authenticated;
grant execute on function public.add_whatsapp_suppression(uuid, text, public.whatsapp_suppression_scope, text) to authenticated;

revoke all on function public.release_whatsapp_suppression(uuid, text) from public, anon, authenticated;
grant execute on function public.release_whatsapp_suppression(uuid, text) to authenticated;

revoke all on function public.queue_whatsapp_message(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.queue_whatsapp_message(uuid, text, text, boolean) to authenticated;

revoke all on function public.register_whatsapp_channel(text, text, uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_whatsapp_channel(text, text, uuid, uuid, text, text, text, text) to anon;

revoke all on function public.sync_whatsapp_channel_health(text, text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.sync_whatsapp_channel_health(text, text, text, text, integer, text) to anon;

revoke all on function public.ingest_whatsapp_message(text, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_message(text, text, text, text, text, text, jsonb, timestamptz) to anon;

revoke all on function public.update_whatsapp_message_status(text, text, text, text, integer, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.update_whatsapp_message_status(text, text, text, text, integer, text, text, text, timestamptz) to anon;

revoke all on function public.set_whatsapp_marketing_preference(text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.set_whatsapp_marketing_preference(text, text, text, text, timestamptz) to anon;

revoke all on function public.mark_whatsapp_message_sent(text, uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.mark_whatsapp_message_sent(text, uuid, text, text, integer, text) to anon;
