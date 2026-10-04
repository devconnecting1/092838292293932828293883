-- =============================================================================
-- 0600 - Funções de autorização e políticas RLS de todas as tabelas
-- =============================================================================
-- Convenções:
--   * Todas as políticas são "to authenticated"; anon não tem política nenhuma.
--   * auth.uid() aparece como (select auth.uid()) para ser avaliado uma vez.
--   * A política de SELECT da própria tabela usa apenas colunas da linha (e não
--     uma função que relê a linha), para "insert ... returning" funcionar.

-- -----------------------------------------------------------------------------
-- Funções auxiliares
-- -----------------------------------------------------------------------------

-- Regra de acesso a cliente a partir das colunas da linha.
--   owner/manager/assistant: todos (leitura e escrita)
--   finance: todos, só leitura
--   broker: assigned_to = usuário ou compartilhado via client_shares
--   capturer: clientes que ele criou ou que são proprietários (property_owners)
create or replace function private.can_access_client_row(
  org uuid,
  client uuid,
  client_assigned_to uuid,
  client_created_by uuid,
  for_write boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.active
      and (
        m.role in ('owner', 'manager', 'assistant')
        or (m.role = 'finance' and not for_write)
        or (
          m.role = 'broker'
          and (
            client_assigned_to = m.user_id
            or exists (
              select 1 from public.client_shares s
              where s.client_id = client and s.user_id = m.user_id
            )
          )
        )
        or (
          m.role = 'capturer'
          and (
            client_created_by = m.user_id
            or exists (
              select 1 from public.property_owners po
              where po.client_id = client
            )
          )
        )
      )
  );
$$;

create or replace function private.can_access_client(client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.can_access_client_row(c.organization_id, c.id, c.assigned_to, c.created_by, false)
    from public.clients c
    where c.id = client
  ), false);
$$;

create or replace function private.can_edit_client(client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.can_access_client_row(c.organization_id, c.id, c.assigned_to, c.created_by, true)
    from public.clients c
    where c.id = client
  ), false);
$$;

-- Edição de imóvel a partir das colunas da linha.
--   owner/manager/assistant: todos; broker/capturer: captured_by ou broker_id = usuário
create or replace function private.can_edit_property_row(
  org uuid,
  property_captured_by uuid,
  property_broker_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.active
      and (
        m.role in ('owner', 'manager', 'assistant')
        or (
          m.role in ('broker', 'capturer')
          and m.user_id in (property_captured_by, property_broker_id)
        )
      )
  );
$$;

create or replace function private.can_edit_property(property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.can_edit_property_row(p.organization_id, p.captured_by, p.broker_id)
    from public.properties p
    where p.id = property
  ), false);
$$;

revoke all on function private.can_access_client_row(uuid, uuid, uuid, uuid, boolean) from public;
revoke all on function private.can_access_client(uuid) from public;
revoke all on function private.can_edit_client(uuid) from public;
revoke all on function private.can_edit_property_row(uuid, uuid, uuid) from public;
revoke all on function private.can_edit_property(uuid) from public;
grant execute on function private.can_access_client_row(uuid, uuid, uuid, uuid, boolean) to authenticated;
grant execute on function private.can_access_client(uuid) to authenticated;
grant execute on function private.can_edit_client(uuid) to authenticated;
grant execute on function private.can_edit_property_row(uuid, uuid, uuid) to authenticated;
grant execute on function private.can_edit_property(uuid) to authenticated;

-- =============================================================================
-- BASE
-- =============================================================================

-- organizations ---------------------------------------------------------------
-- Criação somente via public.create_organization (sem política de INSERT).
create policy "organizations: membros leem"
  on public.organizations for select to authenticated
  using (private.is_member(id));

create policy "organizations: dono atualiza"
  on public.organizations for update to authenticated
  using (private.has_role(id, '{owner}'))
  with check (private.has_role(id, '{owner}'));

-- slug (URL do feed e da captação), plan (cobrança) e created_by não são
-- editáveis pelo app; mudam só com service_role.
revoke insert, update, delete on public.organizations from authenticated;
grant update (name, legal_name, cnpj, creci, city, state, phone, email, brand)
  on public.organizations to authenticated;

-- profiles --------------------------------------------------------------------
create policy "profiles: próprio perfil ou colegas de imobiliária"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_organization(id));

create policy "profiles: usuário atualiza o próprio"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, phone, avatar_url, creci_number, creci_state, creci_valid_until)
  on public.profiles to authenticated;

-- memberships -----------------------------------------------------------------
create policy "memberships: membros leem"
  on public.memberships for select to authenticated
  using (private.is_member(organization_id));

create policy "memberships: dono cria; gerente cria equipe operacional"
  on public.memberships for insert to authenticated
  with check (
    private.has_role(organization_id, '{owner}')
    or (private.has_role(organization_id, '{manager}') and role in ('broker', 'capturer', 'assistant'))
  );

create policy "memberships: dono altera; gerente altera equipe operacional"
  on public.memberships for update to authenticated
  using (
    private.has_role(organization_id, '{owner}')
    or (private.has_role(organization_id, '{manager}') and role in ('broker', 'capturer', 'assistant'))
  )
  with check (
    private.has_role(organization_id, '{owner}')
    or (private.has_role(organization_id, '{manager}') and role in ('broker', 'capturer', 'assistant'))
  );

create policy "memberships: dono remove; gerente remove equipe operacional"
  on public.memberships for delete to authenticated
  using (
    private.has_role(organization_id, '{owner}')
    or (private.has_role(organization_id, '{manager}') and role in ('broker', 'capturer', 'assistant'))
  );

revoke update on public.memberships from authenticated;
grant update (role, active) on public.memberships to authenticated;

-- invitations -----------------------------------------------------------------
create policy "invitations: membros leem"
  on public.invitations for select to authenticated
  using (private.is_member(organization_id));

create policy "invitations: dono convida; gerente convida equipe operacional"
  on public.invitations for insert to authenticated
  with check (
    private.has_role(organization_id, '{owner}')
    or (private.has_role(organization_id, '{manager}') and role in ('broker', 'capturer', 'assistant'))
  );

create policy "invitations: dono altera; gerente altera equipe operacional"
  on public.invitations for update to authenticated
  using (
    private.has_role(organization_id, '{owner}')
    or (private.has_role(organization_id, '{manager}') and role in ('broker', 'capturer', 'assistant'))
  )
  with check (
    private.has_role(organization_id, '{owner}')
    or (private.has_role(organization_id, '{manager}') and role in ('broker', 'capturer', 'assistant'))
  );

create policy "invitations: dono cancela; gerente cancela equipe operacional"
  on public.invitations for delete to authenticated
  using (
    private.has_role(organization_id, '{owner}')
    or (private.has_role(organization_id, '{manager}') and role in ('broker', 'capturer', 'assistant'))
  );

-- Aceite só pela RPC accept_invitation; token/accepted_* não são editáveis.
revoke update on public.invitations from authenticated;
grant update (role, expires_at) on public.invitations to authenticated;

-- audit_events ----------------------------------------------------------------
create policy "audit_events: dono e gerente leem"
  on public.audit_events for select to authenticated
  using (private.has_role(organization_id, '{owner,manager}'));

revoke insert, update, delete, truncate on public.audit_events from authenticated;

-- =============================================================================
-- IMÓVEIS
-- =============================================================================

-- condominiums ----------------------------------------------------------------
create policy "condominiums: membros leem"
  on public.condominiums for select to authenticated
  using (private.is_member(organization_id));

create policy "condominiums: equipe comercial cria"
  on public.condominiums for insert to authenticated
  with check (private.has_role(organization_id, '{owner,manager,broker,capturer,assistant}'));

create policy "condominiums: gestão ou quem criou atualiza"
  on public.condominiums for update to authenticated
  using (
    private.has_role(organization_id, '{owner,manager,assistant}')
    or (private.has_role(organization_id, '{broker,capturer}') and created_by = (select auth.uid()))
  )
  with check (private.has_role(organization_id, '{owner,manager,broker,capturer,assistant}'));

create policy "condominiums: dono e gerente removem"
  on public.condominiums for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'));

-- properties ------------------------------------------------------------------
create policy "properties: membros leem"
  on public.properties for select to authenticated
  using (private.is_member(organization_id));

create policy "properties: equipe comercial cria"
  on public.properties for insert to authenticated
  with check (private.has_role(organization_id, '{owner,manager,broker,capturer,assistant}'));

create policy "properties: gestão ou captador/corretor do imóvel atualiza"
  on public.properties for update to authenticated
  using (private.can_edit_property_row(organization_id, captured_by, broker_id))
  with check (private.can_edit_property_row(organization_id, captured_by, broker_id));

create policy "properties: dono e gerente removem"
  on public.properties for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'));

-- property_media, property_owners, keys, listing_authorizations ----------------
-- Herdam do imóvel pai: ler = membro; criar/alterar = quem edita o imóvel.
create policy "property_media: membros leem"
  on public.property_media for select to authenticated
  using (private.is_member(organization_id));
create policy "property_media: quem edita o imóvel cria"
  on public.property_media for insert to authenticated
  with check (private.can_edit_property(property_id));
create policy "property_media: quem edita o imóvel atualiza"
  on public.property_media for update to authenticated
  using (private.can_edit_property(property_id))
  with check (private.can_edit_property(property_id));
create policy "property_media: dono e gerente removem"
  on public.property_media for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'));

create policy "property_owners: membros leem"
  on public.property_owners for select to authenticated
  using (private.is_member(organization_id));
create policy "property_owners: quem edita o imóvel cria"
  on public.property_owners for insert to authenticated
  with check (private.can_edit_property(property_id));
create policy "property_owners: quem edita o imóvel atualiza"
  on public.property_owners for update to authenticated
  using (private.can_edit_property(property_id))
  with check (private.can_edit_property(property_id));
create policy "property_owners: dono e gerente removem"
  on public.property_owners for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'));

create policy "keys: membros leem"
  on public.keys for select to authenticated
  using (private.is_member(organization_id));
create policy "keys: quem edita o imóvel cria"
  on public.keys for insert to authenticated
  with check (private.can_edit_property(property_id));
create policy "keys: quem edita o imóvel atualiza"
  on public.keys for update to authenticated
  using (private.can_edit_property(property_id))
  with check (private.can_edit_property(property_id));
create policy "keys: dono e gerente removem"
  on public.keys for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'));

create policy "listing_authorizations: membros leem"
  on public.listing_authorizations for select to authenticated
  using (private.is_member(organization_id));
create policy "listing_authorizations: quem edita o imóvel cria"
  on public.listing_authorizations for insert to authenticated
  with check (private.can_edit_property(property_id));
create policy "listing_authorizations: quem edita o imóvel atualiza"
  on public.listing_authorizations for update to authenticated
  using (private.can_edit_property(property_id))
  with check (private.can_edit_property(property_id));
create policy "listing_authorizations: dono e gerente removem"
  on public.listing_authorizations for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'));

-- key_movements ---------------------------------------------------------------
-- Qualquer pessoa da equipe comercial registra retirada de chave; a devolução
-- pode ser registrada por quem edita o imóvel ou por quem retirou/registrou.
create policy "key_movements: membros leem"
  on public.key_movements for select to authenticated
  using (private.is_member(organization_id));
create policy "key_movements: equipe comercial registra retirada"
  on public.key_movements for insert to authenticated
  with check (private.has_role(organization_id, '{owner,manager,broker,capturer,assistant}'));
create policy "key_movements: quem edita o imóvel ou quem retirou atualiza"
  on public.key_movements for update to authenticated
  using (
    private.has_role(organization_id, '{owner,manager,broker,capturer,assistant}')
    and (
      taken_by_user = (select auth.uid())
      or created_by = (select auth.uid())
      or private.can_edit_property((select k.property_id from public.keys k where k.id = key_id))
    )
  )
  with check (private.has_role(organization_id, '{owner,manager,broker,capturer,assistant}'));
create policy "key_movements: dono e gerente removem"
  on public.key_movements for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'));

-- proposals -------------------------------------------------------------------
-- Corretor faz proposta em qualquer imóvel, para cliente a que tem acesso.
create policy "proposals: membros leem"
  on public.proposals for select to authenticated
  using (private.is_member(organization_id));
create policy "proposals: equipe comercial cria para cliente acessível"
  on public.proposals for insert to authenticated
  with check (
    private.has_role(organization_id, '{owner,manager,broker,capturer,assistant}')
    and private.can_access_client(client_id)
  );
create policy "proposals: quem edita o imóvel ou o corretor da proposta atualiza"
  on public.proposals for update to authenticated
  using (
    private.can_edit_property(property_id)
    or (
      private.has_role(organization_id, '{broker,capturer}')
      and broker_id = (select auth.uid())
    )
  )
  with check (private.has_role(organization_id, '{owner,manager,broker,capturer,assistant}'));
create policy "proposals: dono e gerente removem"
  on public.proposals for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'));

-- capture_requests ------------------------------------------------------------
-- Inserção somente pela RPC public.submit_capture_request.
create policy "capture_requests: gestão, captador e assistente leem"
  on public.capture_requests for select to authenticated
  using (private.has_role(organization_id, '{owner,manager,capturer,assistant}'));
create policy "capture_requests: gestão, captador e assistente atualizam"
  on public.capture_requests for update to authenticated
  using (private.has_role(organization_id, '{owner,manager,capturer,assistant}'))
  with check (private.has_role(organization_id, '{owner,manager,capturer,assistant}'));
-- Exclusão para atender pedido de eliminação de dados (LGPD).
create policy "capture_requests: dono e gerente removem"
  on public.capture_requests for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'));

revoke insert on public.capture_requests from authenticated;
revoke update on public.capture_requests from authenticated;
grant update (
  owner_name, owner_email, owner_phone, purpose, type, postal_code, neighborhood,
  city, state, expected_price, message, status, converted_property_id
) on public.capture_requests to authenticated;

-- =============================================================================
-- CLIENTES
-- =============================================================================

-- clients ---------------------------------------------------------------------
create policy "clients: acesso conforme papel"
  on public.clients for select to authenticated
  using (private.can_access_client_row(organization_id, id, assigned_to, created_by, false));

create policy "clients: equipe (exceto financeiro) cria"
  on public.clients for insert to authenticated
  with check (
    private.has_role(organization_id, '{owner,manager,broker,capturer,assistant}')
    and private.can_access_client_row(organization_id, id, assigned_to, created_by, true)
  );

create policy "clients: edição conforme papel"
  on public.clients for update to authenticated
  using (private.can_access_client_row(organization_id, id, assigned_to, created_by, true))
  with check (private.can_access_client_row(organization_id, id, assigned_to, created_by, true));

create policy "clients: dono e gerente removem"
  on public.clients for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'));

-- client_shares ---------------------------------------------------------------
create policy "client_shares: quem acessa o cliente ou o destinatário lê"
  on public.client_shares for select to authenticated
  using (user_id = (select auth.uid()) or private.can_access_client(client_id));

create policy "client_shares: quem edita o cliente compartilha com colega"
  on public.client_shares for insert to authenticated
  with check (
    private.can_edit_client(client_id)
    and shared_by = (select auth.uid())
    and exists (
      select 1 from public.memberships m
      where m.organization_id = client_shares.organization_id
        and m.user_id = client_shares.user_id
        and m.active
    )
  );

create policy "client_shares: dono, gerente ou quem compartilhou remove"
  on public.client_shares for delete to authenticated
  using (
    private.has_role(organization_id, '{owner,manager}')
    or (shared_by = (select auth.uid()) and private.is_member(organization_id))
  );

revoke update on public.client_shares from authenticated;

-- client_interests ------------------------------------------------------------
create policy "client_interests: quem acessa o cliente lê"
  on public.client_interests for select to authenticated
  using (private.can_access_client(client_id));
create policy "client_interests: quem edita o cliente cria"
  on public.client_interests for insert to authenticated
  with check (private.can_edit_client(client_id));
create policy "client_interests: quem edita o cliente atualiza"
  on public.client_interests for update to authenticated
  using (private.can_edit_client(client_id))
  with check (private.can_edit_client(client_id));
create policy "client_interests: dono e gerente removem"
  on public.client_interests for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'));

-- client_documents ------------------------------------------------------------
create policy "client_documents: quem acessa o cliente lê"
  on public.client_documents for select to authenticated
  using (private.can_access_client(client_id));
create policy "client_documents: quem edita o cliente envia"
  on public.client_documents for insert to authenticated
  with check (private.can_edit_client(client_id));
create policy "client_documents: quem edita o cliente atualiza"
  on public.client_documents for update to authenticated
  using (private.can_edit_client(client_id))
  with check (private.can_edit_client(client_id));
create policy "client_documents: dono e gerente removem"
  on public.client_documents for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'));

-- =============================================================================
-- ATENDIMENTO E AGENDA
-- =============================================================================

-- activities ------------------------------------------------------------------
create policy "activities: cliente acessível ou atividade só de imóvel"
  on public.activities for select to authenticated
  using (
    case
      when client_id is not null then private.can_access_client(client_id)
      else private.is_member(organization_id)
    end
  );

create policy "activities: equipe (exceto financeiro) registra"
  on public.activities for insert to authenticated
  with check (
    private.has_role(organization_id, '{owner,manager,broker,capturer,assistant}')
    and created_by = (select auth.uid())
    and (client_id is null or private.can_edit_client(client_id))
  );

create policy "activities: autor ou gestão atualiza"
  on public.activities for update to authenticated
  using (
    (created_by = (select auth.uid()) or private.has_role(organization_id, '{owner,manager}'))
    and (client_id is null or private.can_edit_client(client_id))
  )
  with check (
    private.has_role(organization_id, '{owner,manager,broker,capturer,assistant}')
    and (client_id is null or private.can_edit_client(client_id))
  );

create policy "activities: dono e gerente removem"
  on public.activities for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'));

-- appointments ----------------------------------------------------------------
create policy "appointments: gestão vê tudo; corretor vê os seus e de clientes acessíveis"
  on public.appointments for select to authenticated
  using (
    private.has_role(organization_id, '{owner,manager,assistant,finance}')
    or (
      private.is_member(organization_id)
      and (
        broker_id = (select auth.uid())
        or created_by = (select auth.uid())
        or (client_id is not null and private.can_access_client(client_id))
      )
    )
  );

create policy "appointments: gestão agenda para qualquer um; corretor para si"
  on public.appointments for insert to authenticated
  with check (
    (
      private.has_role(organization_id, '{owner,manager,assistant}')
      or (private.has_role(organization_id, '{broker,capturer}') and broker_id = (select auth.uid()))
    )
    and (client_id is null or private.can_access_client(client_id))
  );

create policy "appointments: gestão ou corretor da visita atualiza"
  on public.appointments for update to authenticated
  using (
    private.has_role(organization_id, '{owner,manager,assistant}')
    or (
      private.has_role(organization_id, '{broker,capturer}')
      and (broker_id = (select auth.uid()) or created_by = (select auth.uid()))
    )
  )
  with check (
    private.has_role(organization_id, '{owner,manager,assistant}')
    or (
      private.has_role(organization_id, '{broker,capturer}')
      and (broker_id = (select auth.uid()) or created_by = (select auth.uid()))
    )
  );

create policy "appointments: dono e gerente removem"
  on public.appointments for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'));

-- tasks -----------------------------------------------------------------------
create policy "tasks: gestão vê tudo; demais veem as suas e de clientes acessíveis"
  on public.tasks for select to authenticated
  using (
    private.has_role(organization_id, '{owner,manager,assistant,finance}')
    or (
      private.is_member(organization_id)
      and (
        assignee_id = (select auth.uid())
        or created_by = (select auth.uid())
        or (client_id is not null and private.can_access_client(client_id))
      )
    )
  );

create policy "tasks: membros criam"
  on public.tasks for insert to authenticated
  with check (
    private.is_member(organization_id)
    and created_by = (select auth.uid())
    and (client_id is null or private.can_access_client(client_id))
  );

create policy "tasks: gestão, responsável ou autor atualiza"
  on public.tasks for update to authenticated
  using (
    private.has_role(organization_id, '{owner,manager}')
    or (
      private.is_member(organization_id)
      and (assignee_id = (select auth.uid()) or created_by = (select auth.uid()))
    )
  )
  with check (private.is_member(organization_id));

create policy "tasks: gestão ou autor remove"
  on public.tasks for delete to authenticated
  using (
    private.has_role(organization_id, '{owner,manager}')
    or (private.is_member(organization_id) and created_by = (select auth.uid()))
  );

-- =============================================================================
-- Endurecimento: anon não acessa nenhuma tabela diretamente.
-- (O formulário público usa a RPC submit_capture_request.)
-- =============================================================================
revoke all on all tables in schema public from anon;
