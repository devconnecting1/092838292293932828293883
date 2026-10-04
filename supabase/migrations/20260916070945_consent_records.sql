-- =============================================================================
-- 3100 - Consentimento com prova (LGPD)
-- =============================================================================
-- Guardar `consentimento = true` com data NÃO é suficiente, e a lei diz por quê:
--
--   * Art. 8º, § 2º — "Cabe ao controlador o ônus da prova de que o
--     consentimento foi obtido em conformidade com o disposto nesta Lei."
--   * Art. 8º, § 4º — "O consentimento deverá referir-se a finalidades
--     determinadas, e as autorizações genéricas para o tratamento de dados
--     pessoais serão nulas."
--   * Art. 9º, § 1º — consentimento cujo conteúdo informativo não possa ser
--     demonstrado como claro e inequívoco, apresentado previamente, é nulo.
--
-- Tradução para o schema:
--   1. A finalidade é um ENUM granular, nunca um booleano, e cada linha vale
--      para UMA finalidade em UM canal.
--   2. A linha guarda o TEXTO EXATO exibido ao titular, mais o sha-256 dele e a
--      versão da política. A URL não basta: a página muda sem avisar.
--   3. A tabela é APPEND-ONLY. Revogar grava uma linha nova com
--      `action = 'revoked'`; nada é apagado nem sobrescrito. Sem UPDATE e sem
--      DELETE para ninguém, nem para o dono.
--   4. Origem que comprovadamente NÃO produz consentimento (planilha importada,
--      raspagem de portal, indicação de terceiro) é recusada pelo banco quando
--      a finalidade é de divulgação. É CHECK, não regra de tela.
--
--  1. Enums
--  2. public.consent_records
--  3. Helpers private (normalização de contato, estado vigente, gravação)
--  4. RPCs
--  5. Grants
--
-- Espelho de packages/core/src/consent/purposes.ts.

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------

create type public.consent_purpose as enum (
  'atendimento',
  'envio_de_imoveis',
  'divulgacao',
  'pesquisa_satisfacao',
  'compartilhamento_parceiros'
);

create type public.consent_channel as enum ('whatsapp', 'email', 'sms', 'telefone', 'presencial');

create type public.consent_source as enum (
  'formulario_site',
  'landing_page',
  'captacao_publica',
  'whatsapp_opt_in',
  'portal',
  'indicacao',
  'atendimento_presencial',
  'telefone',
  'contrato',
  'importacao'
);

create type public.consent_action as enum ('granted', 'revoked');

-- -----------------------------------------------------------------------------
-- 2. public.consent_records
-- -----------------------------------------------------------------------------

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  action public.consent_action not null,
  purpose public.consent_purpose not null,
  channel public.consent_channel not null,
  source public.consent_source not null,
  -- Endereço normalizado do titular no canal: só dígitos com DDI para
  -- telefone/WhatsApp/SMS, minúsculas para e-mail.
  subject_address text not null
    constraint consent_records_subject_address_check
      check (char_length(subject_address) between 3 and 320),
  subject_name text
    constraint consent_records_subject_name_check check (char_length(subject_name) <= 200),
  lead_id uuid,
  client_id uuid,
  -- O que a pessoa leu, literal, no momento em que autorizou ou revogou.
  disclosure_text text not null
    constraint consent_records_disclosure_text_check
      check (char_length(disclosure_text) between 20 and 4000),
  disclosure_sha256 text not null
    constraint consent_records_disclosure_sha_format
      check (disclosure_sha256 ~ '^[0-9a-f]{64}$'),
  policy_version text not null
    constraint consent_records_policy_version_check
      check (char_length(policy_version) between 1 and 40),
  collected_at timestamptz not null default now(),
  -- Contexto sem dado pessoal cru: URL da página, id do formulário, hash do IP,
  -- user agent truncado, wamid da mensagem em que o titular pediu para sair.
  evidence jsonb not null default '{}'::jsonb
    constraint consent_records_evidence_check
      check (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 4096),
  -- Quem registrou (null quando foi o próprio titular, por formulário ou webhook).
  recorded_by uuid references auth.users (id) on delete set null,
  -- Linha que esta revogação encerra, quando conhecida. Nunca apaga a original.
  revokes_id uuid,
  created_at timestamptz not null default now(),
  constraint consent_records_organization_id_id_key unique (organization_id, id),
  constraint consent_records_lead_fkey foreign key (organization_id, lead_id)
    references public.leads (organization_id, id) on delete set null (lead_id),
  constraint consent_records_client_fkey foreign key (organization_id, client_id)
    references public.clients (organization_id, id) on delete set null (client_id),
  constraint consent_records_revokes_fkey foreign key (organization_id, revokes_id)
    references public.consent_records (organization_id, id) on delete set null (revokes_id),
  -- Planilha importada, portal e indicação de terceiro não são consentimento
  -- para divulgação. O banco recusa; não existe caminho de tela que contorne.
  constraint consent_records_marketing_source_check check (
    action <> 'granted'
    or purpose not in ('divulgacao', 'compartilhamento_parceiros', 'pesquisa_satisfacao')
    or source not in ('importacao', 'portal', 'indicacao')
  ),
  -- Revogação sempre encerra algo: não faz sentido revogar o que nunca existiu
  -- como finalidade de canal diferente do registrado.
  constraint consent_records_revokes_self_check check (revokes_id is null or revokes_id <> id)
);

-- A consulta quente é "qual é o estado vigente deste contato para esta
-- finalidade neste canal": índice exatamente nessa ordem, com o tempo desc.
create index consent_records_state_idx
  on public.consent_records (organization_id, channel, subject_address, purpose, collected_at desc);

create index consent_records_lead_idx
  on public.consent_records (organization_id, lead_id, collected_at desc)
  where lead_id is not null;

create index consent_records_client_idx
  on public.consent_records (organization_id, client_id, collected_at desc)
  where client_id is not null;

create index consent_records_recorded_by_idx
  on public.consent_records (recorded_by)
  where recorded_by is not null;

create index consent_records_revokes_idx
  on public.consent_records (organization_id, revokes_id)
  where revokes_id is not null;

alter table public.consent_records enable row level security;

-- Leitura: gestão vê tudo; corretor e captador só o que estiver amarrado a um
-- lead ou cliente que já podem acessar. Registro solto (contato avulso) fica
-- com a gestão, para não virar uma lista de telefones aberta à equipe inteira.
create policy "consent_records: quem já acessa o titular lê"
  on public.consent_records for select to authenticated
  using (
    private.has_role(organization_id, '{owner,manager,assistant,finance}')
    or (lead_id is not null and private.can_access_lead(lead_id))
    or (client_id is not null and private.can_access_client(client_id))
  );

comment on table public.consent_records is
  'Registro append-only de consentimento e revogação, por finalidade e canal, com o texto exato exibido ao titular. Sem UPDATE e sem DELETE: revogar grava linha nova (LGPD art. 8º, §2º e art. 9º, §1º). Escrita só pelas RPCs.';
comment on column public.consent_records.disclosure_text is
  'Texto literal apresentado ao titular. É a prova exigida pelo art. 9º, §1º — guardar só a URL da política não serve.';
comment on column public.consent_records.revokes_id is
  'Linha de consentimento que esta revogação encerra. A original permanece intacta.';

-- -----------------------------------------------------------------------------
-- 3. Helpers private
-- -----------------------------------------------------------------------------

-- Normalização do endereço do titular no canal. Sem isto, "(11) 98888-7777",
-- "5511988887777" e "11988887777" viram três titulares diferentes e a
-- revogação de um não vale para os outros.
create or replace function private.consent_address(
  p_channel public.consent_channel,
  p_value text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_raw text := btrim(coalesce(p_value, ''));
  v_digits text;
begin
  if v_raw = '' then
    return null;
  end if;

  if p_channel = 'email' then
    v_raw := lower(v_raw);
    if v_raw !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' or char_length(v_raw) > 320 then
      return null;
    end if;
    return v_raw;
  end if;

  if p_channel = 'presencial' then
    return left(v_raw, 320);
  end if;

  -- Telefone, SMS e WhatsApp: só dígitos, sempre com DDI. Número brasileiro
  -- digitado sem o 55 recebe o 55 aqui, uma vez só.
  v_digits := regexp_replace(v_raw, '[^0-9]', '', 'g');

  if char_length(v_digits) between 10 and 11 then
    v_digits := '55' || v_digits;
  end if;

  if char_length(v_digits) not between 8 and 20 then
    return null;
  end if;

  return v_digits;
end;
$$;

comment on function private.consent_address(public.consent_channel, text) is
  'Normaliza o endereço do titular no canal (dígitos com DDI para telefone/WhatsApp/SMS, minúsculas para e-mail). Devolve null quando o valor não serve.';

-- Estado vigente: vale a ÚLTIMA linha daquele titular naquela finalidade e
-- canal. Empate no mesmo instante resolve pelo id, para o resultado ser estável.
create or replace function private.consent_active(
  p_organization_id uuid,
  p_purpose public.consent_purpose,
  p_channel public.consent_channel,
  p_address text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select cr.action = 'granted'
      from public.consent_records cr
      where cr.organization_id = p_organization_id
        and cr.purpose = p_purpose
        and cr.channel = p_channel
        and cr.subject_address = private.consent_address(p_channel, p_address)
      order by cr.collected_at desc, cr.id desc
      limit 1
    ),
    false
  );
$$;

comment on function private.consent_active(uuid, public.consent_purpose, public.consent_channel, text) is
  'Verdadeiro quando o último registro daquele titular, finalidade e canal é `granted`. Sem registro nenhum = falso (o silêncio nunca é consentimento).';

-- Gravação. Fica em `private` porque três caminhos precisam dela: a RPC com
-- sessão, o webhook do WhatsApp (sem sessão) e as rotinas internas.
create or replace function private.record_consent_row(
  p_organization_id uuid,
  p_action public.consent_action,
  p_purpose public.consent_purpose,
  p_channel public.consent_channel,
  p_source public.consent_source,
  p_address text,
  p_disclosure_text text,
  p_policy_version text,
  p_subject_name text default null,
  p_lead_id uuid default null,
  p_client_id uuid default null,
  p_evidence jsonb default '{}'::jsonb,
  p_recorded_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_address text := private.consent_address(p_channel, p_address);
  v_text text := btrim(coalesce(p_disclosure_text, ''));
  v_revokes uuid;
  v_id uuid;
begin
  if v_address is null then
    perform private.billing_invalid_field('p_address');
  end if;

  if char_length(v_text) not between 20 and 4000 then
    perform private.billing_invalid_field('p_disclosure_text');
  end if;

  if p_policy_version is null or char_length(btrim(p_policy_version)) not between 1 and 40 then
    perform private.billing_invalid_field('p_policy_version');
  end if;

  if p_evidence is not null
     and (jsonb_typeof(p_evidence) <> 'object' or octet_length(p_evidence::text) > 4096) then
    perform private.billing_invalid_field('p_evidence');
  end if;

  -- Revogação aponta para o consentimento que encerra, quando existe. A linha
  -- original continua lá: é ela que prova o que foi mostrado na época.
  if p_action = 'revoked' then
    select cr.id into v_revokes
    from public.consent_records cr
    where cr.organization_id = p_organization_id
      and cr.purpose = p_purpose
      and cr.channel = p_channel
      and cr.subject_address = v_address
      and cr.action = 'granted'
    order by cr.collected_at desc, cr.id desc
    limit 1;
  end if;

  insert into public.consent_records (
    organization_id, action, purpose, channel, source, subject_address, subject_name,
    lead_id, client_id, disclosure_text, disclosure_sha256, policy_version,
    evidence, recorded_by, revokes_id
  )
  values (
    p_organization_id, p_action, p_purpose, p_channel, p_source, v_address,
    left(nullif(btrim(coalesce(p_subject_name, '')), ''), 200),
    p_lead_id, p_client_id, v_text,
    encode(extensions.digest(v_text, 'sha256'), 'hex'),
    btrim(p_policy_version),
    coalesce(p_evidence, '{}'::jsonb), p_recorded_by, v_revokes
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function private.record_consent_row(uuid, public.consent_action, public.consent_purpose, public.consent_channel, public.consent_source, text, text, text, text, uuid, uuid, jsonb, uuid) is
  'Grava uma linha no registro append-only de consentimento. Revogação aponta para o consentimento que encerra; nada é apagado.';

-- -----------------------------------------------------------------------------
-- 4. RPCs
-- -----------------------------------------------------------------------------
-- Erros: 42501 sem sessão ou sem acesso; 22023 campo inválido;
--        23514 origem que não prova consentimento para finalidade de divulgação.

create or replace function public.record_consent(
  p_organization_id uuid,
  p_action public.consent_action,
  p_purpose public.consent_purpose,
  p_channel public.consent_channel,
  p_source public.consent_source,
  p_address text,
  p_disclosure_text text,
  p_policy_version text,
  p_subject_name text default null,
  p_lead_id uuid default null,
  p_client_id uuid default null,
  p_evidence jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null or not private.is_member(p_organization_id) then
    raise exception 'Você não tem acesso a esta imobiliária.' using errcode = '42501';
  end if;

  -- O vínculo tem de ser com um lead/cliente que a pessoa já enxerga: sem isso,
  -- o registro de consentimento viraria um caminho lateral para tocar carteira
  -- alheia.
  if p_lead_id is not null and not private.can_access_lead(p_lead_id) then
    raise exception 'Você não tem acesso a este lead.' using errcode = '42501';
  end if;

  if p_client_id is not null and not private.can_access_client(p_client_id) then
    raise exception 'Você não tem acesso a este cliente.' using errcode = '42501';
  end if;

  return private.record_consent_row(
    p_organization_id, p_action, p_purpose, p_channel, p_source, p_address,
    p_disclosure_text, p_policy_version, p_subject_name, p_lead_id, p_client_id,
    coalesce(p_evidence, '{}'::jsonb), v_user
  );
end;
$$;

comment on function public.record_consent(uuid, public.consent_action, public.consent_purpose, public.consent_channel, public.consent_source, text, text, text, text, uuid, uuid, jsonb) is
  'Registra consentimento ou revogação com a prova exigida pela LGPD. Append-only: revogar não apaga o consentimento anterior.';

-- Estado vigente de um titular, finalidade por finalidade. É o que a tela usa
-- para dizer, antes do envio, o que pode e o que não pode.
create or replace function public.get_consent_state(
  p_organization_id uuid,
  p_channel public.consent_channel,
  p_address text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_address text := private.consent_address(p_channel, p_address);
  v_result jsonb := '{}'::jsonb;
  v_purpose public.consent_purpose;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null or not private.is_member(p_organization_id) then
    raise exception 'Você não tem acesso a esta imobiliária.' using errcode = '42501';
  end if;

  if v_address is null then
    perform private.billing_invalid_field('p_address');
  end if;

  foreach v_purpose in array enum_range(null::public.consent_purpose) loop
    -- Sem nenhuma linha, a subconsulta devolve NULL: o coalesce transforma isso
    -- em "never". Ausência de registro nunca pode virar permissão.
    v_result := v_result || jsonb_build_object(
      v_purpose::text,
      coalesce(
        (
          select jsonb_build_object(
            'state', case when cr.action = 'granted' then 'granted' else 'revoked' end,
            'source', cr.source,
            'policy_version', cr.policy_version,
            'collected_at', cr.collected_at,
            'record_id', cr.id
          )
          from public.consent_records cr
          where cr.organization_id = p_organization_id
            and cr.purpose = v_purpose
            and cr.channel = p_channel
            and cr.subject_address = v_address
          order by cr.collected_at desc, cr.id desc
          limit 1
        ),
        jsonb_build_object('state', 'never')
      )
    );
  end loop;

  return jsonb_build_object('address', v_address, 'channel', p_channel, 'purposes', v_result);
end;
$$;

comment on function public.get_consent_state(uuid, public.consent_channel, text) is
  'Estado vigente de cada finalidade para um titular num canal: granted, revoked ou never. Ausência de registro nunca vira permissão.';

-- -----------------------------------------------------------------------------
-- 5. Grants
-- -----------------------------------------------------------------------------

revoke all on public.consent_records from public, anon, authenticated;
grant select on public.consent_records to authenticated;

revoke all on function private.consent_address(public.consent_channel, text) from public, anon, authenticated;
revoke all on function private.consent_active(uuid, public.consent_purpose, public.consent_channel, text) from public, anon, authenticated;
revoke all on function private.record_consent_row(uuid, public.consent_action, public.consent_purpose, public.consent_channel, public.consent_source, text, text, text, text, uuid, uuid, jsonb, uuid) from public, anon, authenticated;

revoke all on function public.record_consent(uuid, public.consent_action, public.consent_purpose, public.consent_channel, public.consent_source, text, text, text, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_consent(uuid, public.consent_action, public.consent_purpose, public.consent_channel, public.consent_source, text, text, text, text, uuid, uuid, jsonb) to authenticated;

revoke all on function public.get_consent_state(uuid, public.consent_channel, text) from public, anon, authenticated;
grant execute on function public.get_consent_state(uuid, public.consent_channel, text) to authenticated;
