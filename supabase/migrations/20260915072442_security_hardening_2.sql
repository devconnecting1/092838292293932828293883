-- =============================================================================
-- 1200 - Endurecimento 2 (auditoria de segurança do banco C1 + revisão do app C2)
-- =============================================================================
--  1. property_owners: vincular proprietário exige acesso ao cliente
--  2. memberships: sem INSERT direto (só create_organization / accept_invitation)
--  3. invitations: INSERT só das colunas de negócio; gerente só lê convites da
--     equipe operacional
--  4. accept_invitation: exige e-mail confirmado e não reativa dono desativado
--  5. Autor dos registros (created_by / uploaded_by) definido pelo banco e imutável
--  6. key_movements: taken_by_user membro ativo; cliente acessível; UPDATE só
--     de returned_at, due_at e notes
--  7. proposals: fluxo de status por trigger; WITH CHECK com cliente acessível e
--     vínculo com o imóvel/corretor; UPDATE só nas colunas de negócio
--  8. organizations.feed_token fora do SELECT do app; RPC get_feed_settings
--  9. get_portal_feed respeita address_display
-- 10. submit_capture_request: chave do servidor (Vault), nonce de uso único,
--     limite por visitante (p_client_key), trava por imobiliária, e-mail estrito
-- 11. anon/authenticated sem TRUNCATE, TRIGGER e REFERENCES nas tabelas de public

-- -----------------------------------------------------------------------------
-- 1. property_owners
-- -----------------------------------------------------------------------------
-- O captador enxerga clientes que são proprietários (property_owners). Sem esta
-- checagem, ele vinculava QUALQUER cliente da imobiliária ao próprio imóvel e
-- ganhava leitura/escrita da ficha (CPF, RG, documentos) de clientes de outros
-- corretores. Agora só vincula quem já acessa o cliente.
drop policy if exists "property_owners: quem edita o imóvel cria" on public.property_owners;
drop policy if exists "property_owners: quem edita o imóvel atualiza" on public.property_owners;

create policy "property_owners: quem edita o imóvel e vê o cliente cria"
  on public.property_owners for insert to authenticated
  with check (
    private.can_edit_property(property_id)
    and private.can_access_client(client_id)
  );

create policy "property_owners: quem edita o imóvel atualiza"
  on public.property_owners for update to authenticated
  using (private.can_edit_property(property_id))
  with check (private.can_edit_property(property_id));

-- Só a participação é editável: trocar imóvel ou cliente = remover e vincular de novo.
revoke update on public.property_owners from authenticated;
grant update (share_percent) on public.property_owners to authenticated;

-- -----------------------------------------------------------------------------
-- 2. memberships: entrada na equipe só por convite aceito
-- -----------------------------------------------------------------------------
-- Antes, qualquer usuário (bastava criar a própria imobiliária) inseria uma
-- membership para um user_id qualquer e passava a ler o perfil dele (nome,
-- e-mail, telefone, CRECI) via private.shares_organization.
-- create_organization e accept_invitation são security definer (dono da tabela)
-- e não dependem desta política nem do grant.
drop policy if exists "memberships: dono cria; gerente cria equipe operacional" on public.memberships;
revoke insert on public.memberships from authenticated;

-- -----------------------------------------------------------------------------
-- 3. invitations
-- -----------------------------------------------------------------------------
-- Token, aceite e autor não são informados pelo app.
revoke insert on public.invitations from authenticated;
grant insert (organization_id, email, role, expires_at) on public.invitations to authenticated;

-- Gerente só lê convites que pode gerenciar (o token de convite de dono,
-- gerente ou financeiro não fica visível para ele).
drop policy if exists "invitations: dono e gerente leem" on public.invitations;

create policy "invitations: dono lê todos; gerente lê equipe operacional"
  on public.invitations for select to authenticated
  using (
    private.has_role(organization_id, '{owner}')
    or (private.has_role(organization_id, '{manager}') and role in ('broker', 'capturer', 'assistant'))
  );

-- -----------------------------------------------------------------------------
-- 4. accept_invitation
-- -----------------------------------------------------------------------------
-- a) E-mail precisa estar confirmado no Supabase Auth (evita aceitar convite com
--    uma conta criada para o e-mail de outra pessoa).
-- b) Só um dono ATIVO mantém o papel de dono. Antes, um dono desativado que
--    recebesse qualquer convite (ex.: de um gerente, como corretor) voltava
--    ativo como DONO.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_email_confirmed_at timestamptz;
  v_invitation public.invitations%rowtype;
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado para aceitar o convite.'
      using errcode = '42501';
  end if;

  select lower(u.email), u.email_confirmed_at
    into v_email, v_email_confirmed_at
  from auth.users u
  where u.id = v_user;

  select * into v_invitation
  from public.invitations i
  where i.token = p_token
  for update;

  if not found or v_invitation.accepted_at is not null then
    raise exception 'Convite inválido ou já utilizado.' using errcode = 'P0002';
  end if;

  if v_invitation.expires_at < now() then
    raise exception 'Este convite expirou. Peça um novo convite.' using errcode = '22023';
  end if;

  if v_email is null or v_email <> v_invitation.email then
    raise exception 'Este convite foi enviado para outro e-mail.' using errcode = '42501';
  end if;

  if v_email_confirmed_at is null then
    raise exception 'Confirme seu e-mail antes de aceitar o convite.' using errcode = '42501';
  end if;

  insert into public.memberships (organization_id, user_id, role, active, created_by)
  values (v_invitation.organization_id, v_user, v_invitation.role, true, v_invitation.invited_by)
  on conflict (user_id, organization_id)
  do update set
    -- nunca rebaixa um dono ativo por convite; os demais assumem o papel convidado
    role = case
             when public.memberships.role = 'owner' and public.memberships.active
               then public.memberships.role
             else excluded.role
           end,
    active = true;

  update public.invitations
  set accepted_at = now(), accepted_by = v_user
  where id = v_invitation.id;

  return v_invitation.organization_id;
end;
$$;

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Autor do registro definido pelo banco
-- -----------------------------------------------------------------------------
-- O default auth.uid() podia ser sobrescrito no insert (e a coluna alterada no
-- update), forjando "quem registrou" (histórico de chaves, documentos) e
-- ganhando direitos que dependem do autor (ex.: tarefa "gestão ou autor remove").
-- Com sessão de usuário: no INSERT a coluna vira auth.uid(); no UPDATE não muda.
-- Sem sessão (service_role, ações referenciais de FK): segue o valor informado.
create or replace function private.enforce_author_column()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_column constant text := tg_argv[0];
  v_user constant uuid := (select auth.uid());
begin
  if v_user is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new := jsonb_populate_record(new, jsonb_build_object(v_column, v_user));
  elsif (to_jsonb(new) -> v_column) is distinct from (to_jsonb(old) -> v_column) then
    raise exception 'O campo % registra quem criou o registro e não pode ser alterado.', v_column
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_author_column() from public;

create trigger activities_enforce_author
  before insert or update of created_by on public.activities
  for each row execute function private.enforce_author_column('created_by');
create trigger appointments_enforce_author
  before insert or update of created_by on public.appointments
  for each row execute function private.enforce_author_column('created_by');
create trigger tasks_enforce_author
  before insert or update of created_by on public.tasks
  for each row execute function private.enforce_author_column('created_by');
create trigger clients_enforce_author
  before insert or update of created_by on public.clients
  for each row execute function private.enforce_author_column('created_by');
create trigger client_interests_enforce_author
  before insert or update of created_by on public.client_interests
  for each row execute function private.enforce_author_column('created_by');
create trigger client_documents_enforce_author
  before insert or update of uploaded_by on public.client_documents
  for each row execute function private.enforce_author_column('uploaded_by');
create trigger condominiums_enforce_author
  before insert or update of created_by on public.condominiums
  for each row execute function private.enforce_author_column('created_by');
create trigger properties_enforce_author
  before insert or update of created_by on public.properties
  for each row execute function private.enforce_author_column('created_by');
create trigger property_media_enforce_author
  before insert or update of created_by on public.property_media
  for each row execute function private.enforce_author_column('created_by');
create trigger property_owners_enforce_author
  before insert or update of created_by on public.property_owners
  for each row execute function private.enforce_author_column('created_by');
create trigger keys_enforce_author
  before insert or update of created_by on public.keys
  for each row execute function private.enforce_author_column('created_by');
create trigger key_movements_enforce_author
  before insert or update of created_by on public.key_movements
  for each row execute function private.enforce_author_column('created_by');
create trigger proposals_enforce_author
  before insert or update of created_by on public.proposals
  for each row execute function private.enforce_author_column('created_by');
create trigger listing_authorizations_enforce_author
  before insert or update of created_by on public.listing_authorizations
  for each row execute function private.enforce_author_column('created_by');

-- -----------------------------------------------------------------------------
-- 6. key_movements
-- -----------------------------------------------------------------------------
create trigger key_movements_validate_members
  before insert or update of taken_by_user on public.key_movements
  for each row execute function private.validate_member_columns(
    'taken_by_user', 'Quem retira a chave'
  );

drop policy if exists "key_movements: equipe comercial registra retirada" on public.key_movements;

create policy "key_movements: equipe comercial registra retirada"
  on public.key_movements for insert to authenticated
  with check (
    private.has_role(organization_id, '{owner,manager,broker,capturer,assistant}')
    and created_by = (select auth.uid())
    and (taken_by_client_id is null or private.can_access_client(taken_by_client_id))
  );

-- Retirada registrada não troca de chave, pessoa ou autor; só devolução,
-- prazo e observações.
revoke update on public.key_movements from authenticated;
grant update (returned_at, due_at, notes) on public.key_movements to authenticated;

-- -----------------------------------------------------------------------------
-- 7. proposals
-- -----------------------------------------------------------------------------
-- 7a. Fluxo de status (igual a apps/web/lib/propostas/status.ts)
--   rascunho       -> enviada | retirada
--   enviada        -> contraproposta | aceita | recusada | retirada
--   contraproposta -> enviada | aceita | recusada | retirada
--   aceita, recusada, retirada: finais (sem mudança de status nem de valores)
-- Nova proposta começa como rascunho ou enviada. Ao entrar em estado final,
-- decided_at = now() se vier nulo; em estados abertos decided_at fica nulo.
-- Trocar o cliente da proposta exige acesso a ele (mensagem própria; o WITH
-- CHECK da política também cobre).
create or replace function private.proposals_enforce_status_flow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_labels constant jsonb := jsonb_build_object(
    'draft', 'Rascunho',
    'sent', 'Enviada',
    'countered', 'Contraproposta',
    'accepted', 'Aceita',
    'rejected', 'Recusada',
    'withdrawn', 'Retirada'
  );
  v_transitions constant jsonb := jsonb_build_object(
    'draft', jsonb_build_array('sent', 'withdrawn'),
    'sent', jsonb_build_array('countered', 'accepted', 'rejected', 'withdrawn'),
    'countered', jsonb_build_array('sent', 'accepted', 'rejected', 'withdrawn'),
    'accepted', jsonb_build_array(),
    'rejected', jsonb_build_array(),
    'withdrawn', jsonb_build_array()
  );
  v_final constant text[] := array['accepted', 'rejected', 'withdrawn'];
begin
  if tg_op = 'INSERT' then
    if new.status::text not in ('draft', 'sent') then
      raise exception 'Uma proposta nova precisa começar como rascunho ou enviada.'
        using errcode = 'P0001';
    end if;
    new.decided_at := null;
    return new;
  end if;

  if new.client_id is distinct from old.client_id and (select auth.uid()) is not null then
    if not private.can_access_client(new.client_id) then
      raise exception 'Você não tem acesso ao cliente escolhido para esta proposta.'
        using errcode = '42501';
    end if;
  end if;

  if old.status::text = any (v_final) then
    if new.status is distinct from old.status then
      raise exception 'Esta proposta já foi encerrada (%) e não pode mudar de status.',
        lower(v_labels ->> old.status::text)
        using errcode = 'P0001';
    end if;

    if (new.property_id, new.client_id, new.purpose, new.amount, new.payment_terms,
        new.conditions, new.valid_until, new.decided_at)
       is distinct from
       (old.property_id, old.client_id, old.purpose, old.amount, old.payment_terms,
        old.conditions, old.valid_until, old.decided_at) then
      raise exception 'Propostas encerradas (aceitas, recusadas ou retiradas) não podem ser editadas.'
        using errcode = 'P0001';
    end if;

    return new;
  end if;

  if new.status is distinct from old.status
     and not ((v_transitions -> old.status::text) ? new.status::text) then
    raise exception 'Mudança de status não permitida: de "%" para "%".',
      v_labels ->> old.status::text, v_labels ->> new.status::text
      using errcode = 'P0001';
  end if;

  if new.status::text = any (v_final) then
    new.decided_at := coalesce(new.decided_at, now());
  else
    new.decided_at := null;
  end if;

  return new;
end;
$$;

revoke all on function private.proposals_enforce_status_flow() from public;

create trigger proposals_enforce_status_flow
  before insert or update on public.proposals
  for each row execute function private.proposals_enforce_status_flow();

-- 7b. Políticas: cliente acessível e vínculo com o imóvel ou com a proposta.
drop policy if exists "proposals: equipe comercial cria para cliente acessível" on public.proposals;
drop policy if exists "proposals: quem edita o imóvel ou o corretor da proposta atualiza" on public.proposals;

create policy "proposals: equipe comercial cria para cliente acessível"
  on public.proposals for insert to authenticated
  with check (
    private.has_role(organization_id, '{owner,manager,broker,capturer,assistant}')
    and private.can_access_client(client_id)
    and (
      private.has_role(organization_id, '{owner,manager}')
      or broker_id = (select auth.uid())
      or private.can_edit_property(property_id)
    )
  );

create policy "proposals: corretor ou editor do imóvel atualiza"
  on public.proposals for update to authenticated
  using (
    private.can_edit_property(property_id)
    or (
      private.has_role(organization_id, '{broker,capturer}')
      and broker_id = (select auth.uid())
    )
  )
  with check (
    private.has_role(organization_id, '{owner,manager,broker,capturer,assistant}')
    and private.can_access_client(client_id)
    and (
      private.has_role(organization_id, '{owner,manager}')
      or broker_id = (select auth.uid())
      or private.can_edit_property(property_id)
    )
  );

revoke update on public.proposals from authenticated;
grant update (
  amount, payment_terms, conditions, valid_until, purpose, broker_id, client_id,
  property_id, status, decided_at
) on public.proposals to authenticated;

-- -----------------------------------------------------------------------------
-- 8. organizations.feed_token
-- -----------------------------------------------------------------------------
-- O token do feed dá acesso ao feed dos portais (com endereço completo de
-- imóveis "full"); não fica visível a toda a equipe nem a ex-membros que
-- guardaram a URL. Leitura só por get_feed_settings (dono/gerente).
-- ATENÇÃO: colunas novas em organizations precisam entrar neste grant.
revoke select on public.organizations from authenticated;
grant select (
  id, slug, name, legal_name, cnpj, creci, city, state, phone, email, plan, brand,
  created_by, created_at, updated_at
) on public.organizations to authenticated;

create or replace function public.get_feed_settings(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if not private.has_role(p_organization_id, '{owner,manager}') then
    raise exception 'Só o dono ou o gerente da imobiliária podem ver o endereço do feed.'
      using errcode = '42501';
  end if;

  select jsonb_build_object('slug', o.slug, 'feed_token', o.feed_token)
    into v_result
  from public.organizations o
  where o.id = p_organization_id;

  return v_result;
end;
$$;

revoke all on function public.get_feed_settings(uuid) from public, anon;
grant execute on function public.get_feed_settings(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. get_portal_feed: endereço conforme address_display
-- -----------------------------------------------------------------------------
--   full:         todos os campos de endereço
--   street:       sem street_number, complement, latitude e longitude
--   neighborhood: também sem street
-- Os campos omitidos não aparecem no objeto (chave ausente).
create or replace function public.get_portal_feed(p_org_slug text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_org jsonb;
begin
  if p_org_slug is null or p_token is null or char_length(p_token) <> 48 then
    return null;
  end if;

  select
    o.id,
    jsonb_build_object(
      'id', o.id,
      'slug', o.slug,
      'name', o.name,
      'legal_name', o.legal_name,
      'creci', o.creci,
      'email', o.email,
      'phone', o.phone,
      'city', o.city,
      'state', o.state,
      'brand', o.brand
    )
    into v_org_id, v_org
  from public.organizations o
  where o.slug = lower(btrim(p_org_slug))
    and o.feed_token = p_token;

  if v_org_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'organization', v_org,
    'properties', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'code', p.code,
          'title', p.title,
          'description', p.description,
          'purpose', p.purpose,
          'usage', p.usage,
          'type', p.type,
          'status', p.status,
          'sale_price', p.sale_price,
          'rent_price', p.rent_price,
          'condo_fee', p.condo_fee,
          'iptu_yearly', p.iptu_yearly,
          'living_area', p.living_area,
          'lot_area', p.lot_area,
          'bedrooms', p.bedrooms,
          'bathrooms', p.bathrooms,
          'suites', p.suites,
          'parking_spaces', p.parking_spaces,
          'floor', p.floor,
          'total_floors', p.total_floors,
          'year_built', p.year_built,
          'features', p.features,
          'furnished', p.furnished,
          'accepts_pets', p.accepts_pets,
          'accepts_exchange', p.accepts_exchange,
          'postal_code', p.postal_code,
          'street', p.street,
          'street_number', p.street_number,
          'complement', p.complement,
          'neighborhood', p.neighborhood,
          'city', p.city,
          'state', p.state,
          'latitude', p.latitude,
          'longitude', p.longitude,
          'address_display', p.address_display,
          'condominium_name', cd.name,
          'published_at', p.published_at,
          'updated_at', p.updated_at,
          'media', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'kind', m.kind,
                'storage_path', m.storage_path,
                'external_url', m.external_url,
                'is_cover', m.is_cover,
                'caption', m.caption,
                'position', m.position
              )
              order by m.position, m.created_at, m.id
            )
            from public.property_media m
            where m.organization_id = p.organization_id
              and m.property_id = p.id
          ), '[]'::jsonb)
        )
        - (
          case p.address_display
            when 'full' then '{}'::text[]
            when 'street' then array['street_number', 'complement', 'latitude', 'longitude']
            else array['street', 'street_number', 'complement', 'latitude', 'longitude']
          end
        )
        order by p.code
      )
      from public.properties p
      left join public.condominiums cd
        on cd.organization_id = p.organization_id
       and cd.id = p.condominium_id
      where p.organization_id = v_org_id
        and p.status = 'active'
        and p.published_to_portals
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_portal_feed(text, text) from public;
grant execute on function public.get_portal_feed(text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 10. submit_capture_request
-- -----------------------------------------------------------------------------
-- A RPC continua executável por anon (o servidor Next usa a chave publishable),
-- mas só aceita envios com a chave do servidor guardada no Vault e um nonce de
-- uso único. Assim o formulário não é contornado chamando /rest/v1/rpc direto.

-- 10a. Segredo no Vault (gerado aqui; o valor não fica no arquivo da migração).
do $$
begin
  if not exists (select 1 from vault.secrets s where s.name = 'capture_server_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'capture_server_key',
      'Chave do servidor Next para public.submit_capture_request (env CAPTURE_SERVER_KEY).'
    );
  end if;
end;
$$;

-- 10b. Nonces usados (só o SHA-256), guardados por 12 h.
create table private.capture_request_nonces (
  nonce_hash text primary key
    constraint capture_request_nonces_hash_format check (nonce_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

comment on table private.capture_request_nonces is
  'Nonces já usados em submit_capture_request (SHA-256). Registros com mais de 12 h são apagados pela própria função.';

create index capture_request_nonces_created_at_idx
  on private.capture_request_nonces (created_at);

alter table private.capture_request_nonces enable row level security;
revoke all on table private.capture_request_nonces from public, anon, authenticated;

-- 10c. Envios aceitos por imobiliária e por visitante (só o hash do visitante).
create table private.capture_request_attempts (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_key text
    constraint capture_request_attempts_client_key_format
      check (client_key ~ '^[A-Za-z0-9_=+/-]{32,128}$'),
  created_at timestamptz not null default now()
);

comment on table private.capture_request_attempts is
  'Envios aceitos do formulário público de captação, para limite de taxa. Só guarda o hash do visitante (p_client_key); registros com mais de 1 dia são apagados pela própria submit_capture_request.';

create index capture_request_attempts_organization_created_idx
  on private.capture_request_attempts (organization_id, created_at);
create index capture_request_attempts_client_key_idx
  on private.capture_request_attempts (organization_id, client_key, created_at)
  where client_key is not null;
create index capture_request_attempts_created_at_idx
  on private.capture_request_attempts (created_at);

alter table private.capture_request_attempts enable row level security;
revoke all on table private.capture_request_attempts from public, anon, authenticated;

-- 10d. Nova assinatura (a de 2 argumentos sai para não haver sobrecarga ambígua
-- no PostgREST). Parâmetros com default null para que chamadas incompletas
-- recebam o mesmo erro genérico de chave inválida.
drop function if exists public.submit_capture_request(text, jsonb);

-- payload (jsonb):
--   owner_name (obrigatório), owner_email e/ou owner_phone (ao menos um),
--   purpose (sale|rent|sale_rent, obrigatório), type, postal_code, neighborhood,
--   city, state, expected_price, message, consent (true, obrigatório - LGPD)
-- p_server_key: valor do segredo capture_server_key do Vault (obrigatório)
-- p_nonce:      valor aleatório novo por envio, 16 a 512 caracteres visíveis
--               (obrigatório; não pode se repetir em 12 h)
-- p_client_key: hash do visitante calculado pelo app (ex.: HMAC-SHA256 do IP em
--               hex ou base64url; 32 a 128 caracteres [A-Za-z0-9_=+/-]); opcional
-- Erros: 42501 (chave/nonce ausente, inválido ou repetido - mensagem genérica),
--        P0002 (slug não existe), 54000 (limite; detail 'organization' ou
--        'client_key'), 22023 (validação, mensagem pt-BR).
create function public.submit_capture_request(
  org_slug text,
  payload jsonb,
  p_server_key text default null,
  p_nonce text default null,
  p_client_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_org uuid;
  v_client_key text := nullif(btrim(coalesce(p_client_key, '')), '');
  v_name text;
  v_email text;
  v_phone text;
  v_purpose text;
  v_type text;
  v_postal text;
  v_neighborhood text;
  v_city text;
  v_state text;
  v_price_text text;
  v_price numeric(14, 2);
  v_message text;
  v_id uuid;
begin
  -- Chave do servidor e nonce: sempre o mesmo erro, sem indicar o motivo.
  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'capture_server_key'
  limit 1;

  if v_secret is null
     or p_server_key is null
     or extensions.digest(p_server_key, 'sha256') <> extensions.digest(v_secret, 'sha256')
     or p_nonce is null
     or char_length(p_nonce) not between 16 and 512
     or p_nonce !~ '^[[:graph:]]+$' then
    raise exception 'Não foi possível enviar o formulário.' using errcode = '42501';
  end if;

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Dados do formulário inválidos.' using errcode = '22023';
  end if;

  if octet_length(payload::text) > 16384 then
    raise exception 'Formulário grande demais.' using errcode = '22023';
  end if;

  if v_client_key is not null and v_client_key !~ '^[A-Za-z0-9_=+/-]{32,128}$' then
    raise exception 'Identificação do visitante inválida.' using errcode = '22023';
  end if;

  select o.id into v_org
  from public.organizations o
  where o.slug = lower(btrim(coalesce(org_slug, '')));

  if v_org is null then
    raise exception 'Imobiliária não encontrada.' using errcode = 'P0002';
  end if;

  -- Serializa os envios da mesma imobiliária: os limites abaixo valem mesmo
  -- com requisições simultâneas.
  perform pg_advisory_xact_lock(hashtextextended('submit_capture_request:' || v_org::text, 0));

  if (
    select count(*)
    from private.capture_request_attempts a
    where a.organization_id = v_org
      and a.created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'Muitas solicitações em pouco tempo. Tente novamente em instantes.'
      using errcode = '54000', detail = 'organization';
  end if;

  if v_client_key is not null and (
    select count(*)
    from private.capture_request_attempts a
    where a.organization_id = v_org
      and a.client_key = v_client_key
      and a.created_at > now() - interval '10 minutes'
  ) >= 5 then
    raise exception 'Você enviou muitos cadastros em pouco tempo. Aguarde alguns minutos e tente de novo.'
      using errcode = '54000', detail = 'client_key';
  end if;

  v_name := btrim(coalesce(payload ->> 'owner_name', ''));
  v_email := nullif(lower(btrim(coalesce(payload ->> 'owner_email', ''))), '');
  v_phone := nullif(regexp_replace(coalesce(payload ->> 'owner_phone', ''), '[^0-9]', '', 'g'), '');
  v_purpose := nullif(btrim(coalesce(payload ->> 'purpose', '')), '');
  v_type := nullif(btrim(coalesce(payload ->> 'type', '')), '');
  v_postal := nullif(regexp_replace(coalesce(payload ->> 'postal_code', ''), '[^0-9]', '', 'g'), '');
  v_neighborhood := nullif(btrim(coalesce(payload ->> 'neighborhood', '')), '');
  v_city := nullif(btrim(coalesce(payload ->> 'city', '')), '');
  v_state := nullif(upper(btrim(coalesce(payload ->> 'state', ''))), '');
  v_price_text := nullif(btrim(coalesce(payload ->> 'expected_price', '')), '');
  v_message := nullif(btrim(coalesce(payload ->> 'message', '')), '');

  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Informe seu nome (2 a 120 caracteres).' using errcode = '22023';
  end if;

  if v_email is null and v_phone is null then
    raise exception 'Informe um e-mail ou telefone para contato.' using errcode = '22023';
  end if;

  -- E-mail estrito: sem espaços, quebras de linha, "?", "&" ou pontos seguidos.
  if v_email is not null and (
    char_length(v_email) > 254
    or v_email !~ '^[a-z0-9._+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
    or position('..' in v_email) > 0
  ) then
    raise exception 'E-mail inválido.' using errcode = '22023';
  end if;

  if v_phone is not null and v_phone !~ '^[0-9]{10,13}$' then
    raise exception 'Telefone inválido: informe DDD e número.' using errcode = '22023';
  end if;

  if v_purpose is null
     or not (v_purpose = any (enum_range(null::public.listing_purpose)::text[])) then
    raise exception 'Finalidade inválida.' using errcode = '22023';
  end if;

  if v_type is not null
     and not (v_type = any (enum_range(null::public.property_type)::text[])) then
    raise exception 'Tipo de imóvel inválido.' using errcode = '22023';
  end if;

  if v_postal is not null and v_postal !~ '^[0-9]{8}$' then
    raise exception 'CEP inválido.' using errcode = '22023';
  end if;

  if char_length(v_neighborhood) > 120 or char_length(v_city) > 120 then
    raise exception 'Bairro ou cidade longos demais.' using errcode = '22023';
  end if;

  if v_state is not null and v_state !~ '^[A-Z]{2}$' then
    raise exception 'UF inválida.' using errcode = '22023';
  end if;

  if v_price_text is not null then
    if v_price_text !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then
      raise exception 'Valor pretendido inválido.' using errcode = '22023';
    end if;
    v_price := v_price_text::numeric(14, 2);
  end if;

  if char_length(v_message) > 2000 then
    raise exception 'Mensagem longa demais (máximo 2.000 caracteres).' using errcode = '22023';
  end if;

  if lower(coalesce(payload ->> 'consent', '')) <> 'true' then
    raise exception 'É necessário aceitar o uso dos dados para contato (LGPD).'
      using errcode = '22023';
  end if;

  -- Nonce consumido só quando o envio é aceito (erro de validação não o gasta).
  insert into private.capture_request_nonces (nonce_hash)
  values (encode(extensions.digest(p_nonce, 'sha256'), 'hex'))
  on conflict (nonce_hash) do nothing;

  if not found then
    raise exception 'Não foi possível enviar o formulário.' using errcode = '42501';
  end if;

  insert into public.capture_requests (
    organization_id, owner_name, owner_email, owner_phone, purpose, type,
    postal_code, neighborhood, city, state, expected_price, message, consent_at
  )
  values (
    v_org, v_name, v_email, v_phone, v_purpose::public.listing_purpose,
    v_type::public.property_type, v_postal, v_neighborhood, v_city, v_state,
    v_price, v_message, now()
  )
  returning id into v_id;

  insert into private.capture_request_attempts (organization_id, client_key)
  values (v_org, v_client_key);

  -- Limpeza em lotes, sem esperar travas de outras transações.
  delete from private.capture_request_attempts a
  where a.id in (
    select b.id
    from private.capture_request_attempts b
    where b.created_at < now() - interval '1 day'
    order by b.created_at
    limit 1000
    for update skip locked
  );

  delete from private.capture_request_nonces n
  where n.nonce_hash in (
    select c.nonce_hash
    from private.capture_request_nonces c
    where c.created_at < now() - interval '12 hours'
    order by c.created_at
    limit 1000
    for update skip locked
  );

  return v_id;
end;
$$;

revoke all on function public.submit_capture_request(text, jsonb, text, text, text) from public;
grant execute on function public.submit_capture_request(text, jsonb, text, text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 11. Privilégios que o RLS não cobre
-- -----------------------------------------------------------------------------
-- TRUNCATE ignora RLS; TRIGGER e REFERENCES não são usados pelo app. Nenhum é
-- exposto pela API hoje, mas vieram dos privilégios padrão do Supabase.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
