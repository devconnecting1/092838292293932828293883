-- =============================================================================
-- 1300 - Landing pages e funil de leads
-- =============================================================================
--  1. Enums landing_template, landing_status, lead_stage, lead_source
--  2. private.landing_asset_path_ok e private.can_access_lead_row
--  3. landing_pages (modelos, tema, conteúdo, imóveis, rastreamento, SEO)
--  4. leads (funil por etapa, atribuição, UTM/click ids, idempotência por event_id)
--  5. Políticas RLS e grants por coluna
--  6. Storage: bucket público landing-assets
--  7. RPC pública get_public_landing_page
--  8. RPC pública submit_landing_lead (chave do servidor no Vault, nonce de uso
--     único, limite por visitante e por imobiliária, trava por imobiliária)

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------
create type public.landing_template as enum (
  'campaign_spotlight', 'campaign_offer', 'campaign_valuation',
  'launch_showcase', 'launch_waitlist', 'launch_units',
  'portfolio_grid', 'portfolio_agency', 'portfolio_broker'
);
create type public.landing_status as enum ('draft', 'published', 'archived');
create type public.lead_stage as enum (
  'new', 'contacted', 'qualified', 'visit_scheduled', 'proposal', 'won', 'lost'
);
create type public.lead_source as enum (
  'landing_page', 'portal', 'website', 'social', 'referral', 'manual', 'other'
);

-- -----------------------------------------------------------------------------
-- 2. Funções auxiliares
-- -----------------------------------------------------------------------------

-- Caminho de imagem guardado no jsonb da página: vazio/nulo ou arquivo da
-- própria imobiliária ({organization_id}/...), sem "..", até 300 caracteres.
create or replace function private.landing_asset_path_ok(p_organization_id uuid, p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is null
    or jsonb_typeof(p_value) = 'null'
    or p_value = '""'::jsonb
    or (
      jsonb_typeof(p_value) = 'string'
      and char_length(p_value #>> '{}') <= 300
      and (p_value #>> '{}') like p_organization_id::text || '/_%'
      and (p_value #>> '{}') ~ '^[A-Za-z0-9/_.-]+$'
      and position('..' in (p_value #>> '{}')) = 0
    );
$$;

-- Regra de acesso a lead a partir das colunas da linha.
--   owner/manager/assistant: todos (leitura e escrita)
--   broker: atribuídos a ele e sem responsável (leitura e escrita)
--   capturer/finance: atribuídos a ele, só leitura
create or replace function private.can_access_lead_row(
  org uuid,
  lead_assigned_to uuid,
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
        or (m.role = 'broker' and (lead_assigned_to is null or lead_assigned_to = m.user_id))
        or (m.role in ('capturer', 'finance') and not for_write and lead_assigned_to = m.user_id)
      )
  );
$$;

revoke all on function private.landing_asset_path_ok(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.can_access_lead_row(uuid, uuid, boolean) from public, anon;
grant execute on function private.can_access_lead_row(uuid, uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. landing_pages
-- -----------------------------------------------------------------------------
create table public.landing_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  template public.landing_template not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null
    constraint landing_pages_slug_format
      check (char_length(slug) between 3 and 60 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status public.landing_status not null default 'draft',
  published_at timestamptz,
  -- {primary_color, secondary_color, accent_color, background_image_path,
  --  banner_image_paths[], logo_path}
  theme jsonb not null default '{}'::jsonb
    constraint landing_pages_theme_format
      check (jsonb_typeof(theme) = 'object' and octet_length(theme::text) <= 8192),
  -- {headline, subheadline, cta_label, description, highlights[], whatsapp_number,
  --  whatsapp_message, countdown_until, units_left, financing_note,
  --  social_proof[{stat_label, stat_value}], testimonials[{name, text}],
  --  launch{name, developer, delivery_date, neighborhood, city, state,
  --         typologies[{name, area_min, area_max, bedrooms, price_from}]}}
  content jsonb not null default '{}'::jsonb
    constraint landing_pages_content_format
      check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 32768),
  property_ids uuid[] not null default '{}'
    constraint landing_pages_property_ids_format
      check (cardinality(property_ids) <= 12 and array_position(property_ids, null) is null),
  -- {meta_pixel_id, google_tag_id, gtm_container_id}
  tracking jsonb not null default '{}'::jsonb
    constraint landing_pages_tracking_format check (
      jsonb_typeof(tracking) = 'object'
      and octet_length(tracking::text) <= 1024
      and (tracking - array['meta_pixel_id', 'google_tag_id', 'gtm_container_id']) = '{}'::jsonb
      and (nullif(tracking ->> 'meta_pixel_id', '') is null
           or (tracking ->> 'meta_pixel_id') ~ '^[0-9]{5,20}$')
      and (nullif(tracking ->> 'google_tag_id', '') is null
           or (tracking ->> 'google_tag_id') ~ '^(G|GT|AW)-[A-Z0-9]+$')
      and (nullif(tracking ->> 'gtm_container_id', '') is null
           or (tracking ->> 'gtm_container_id') ~ '^GTM-[A-Z0-9]+$')
    ),
  -- {title (até 70), description (até 160), og_image_path}
  seo jsonb not null default '{}'::jsonb
    constraint landing_pages_seo_format check (
      jsonb_typeof(seo) = 'object'
      and octet_length(seo::text) <= 4096
      and coalesce(char_length(seo ->> 'title'), 0) <= 70
      and coalesce(char_length(seo ->> 'description'), 0) <= 160
    ),
  lead_assignee_id uuid references auth.users (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint landing_pages_organization_slug_key unique (organization_id, slug),
  constraint landing_pages_organization_id_id_key unique (organization_id, id),
  constraint landing_pages_published_at_required check (status <> 'published' or published_at is not null)
);
create index landing_pages_organization_status_idx on public.landing_pages (organization_id, status);
create index landing_pages_lead_assignee_id_idx on public.landing_pages (lead_assignee_id);
create index landing_pages_created_by_idx on public.landing_pages (created_by);

-- Normalização, formatos do jsonb, imóveis da própria imobiliária e regras de
-- publicação. Mensagens pt-BR com errcode 23514.
create or replace function private.landing_pages_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_item jsonb;
  v_text text;
  v_added uuid[];
begin
  new.name := btrim(new.name);
  new.slug := lower(btrim(new.slug));

  if jsonb_typeof(new.theme) is distinct from 'object'
     or jsonb_typeof(new.content) is distinct from 'object'
     or jsonb_typeof(new.tracking) is distinct from 'object'
     or jsonb_typeof(new.seo) is distinct from 'object' then
    raise exception 'Tema, conteúdo, rastreamento e SEO precisam ser objetos JSON.'
      using errcode = '23514';
  end if;

  -- Tema: cores hexadecimais (o valor vai para CSS) e imagens da própria imobiliária.
  foreach v_key in array array['primary_color', 'secondary_color', 'accent_color'] loop
    v_item := new.theme -> v_key;
    if v_item is not null and jsonb_typeof(v_item) <> 'null' and v_item <> '""'::jsonb then
      if jsonb_typeof(v_item) <> 'string'
         or (v_item #>> '{}') !~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$' then
        raise exception 'Cor inválida (%): use o formato hexadecimal, ex.: #1A2B3C.', v_key
          using errcode = '23514';
      end if;
    end if;
  end loop;

  if not private.landing_asset_path_ok(new.organization_id, new.theme -> 'background_image_path')
     or not private.landing_asset_path_ok(new.organization_id, new.theme -> 'logo_path')
     or not private.landing_asset_path_ok(new.organization_id, new.seo -> 'og_image_path') then
    raise exception 'Imagem inválida: use arquivos enviados para a sua imobiliária.'
      using errcode = '23514';
  end if;

  v_item := new.theme -> 'banner_image_paths';
  if v_item is not null and jsonb_typeof(v_item) <> 'null' then
    if jsonb_typeof(v_item) <> 'array' then
      raise exception 'Banners inválidos: envie uma lista de imagens.' using errcode = '23514';
    end if;
    if jsonb_array_length(v_item) > 10 then
      raise exception 'Banners: no máximo 10 imagens.' using errcode = '23514';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_item) as e (value)
      where jsonb_typeof(e.value) <> 'string'
         or e.value = '""'::jsonb
         or not private.landing_asset_path_ok(new.organization_id, e.value)
    ) then
      raise exception 'Imagem inválida: use arquivos enviados para a sua imobiliária.'
        using errcode = '23514';
    end if;
  end if;

  -- Conteúdo: formatos usados em links/contagens e tipos das listas.
  v_text := nullif(btrim(coalesce(new.content ->> 'whatsapp_number', '')), '');
  if v_text is not null and v_text !~ '^[0-9]{10,15}$' then
    raise exception 'WhatsApp inválido: informe só números, com DDI/DDD (10 a 15 dígitos).'
      using errcode = '23514';
  end if;

  v_text := nullif(btrim(coalesce(new.content ->> 'countdown_until', '')), '');
  if v_text is not null
     and v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$' then
    raise exception 'Data da contagem regressiva inválida (use AAAA-MM-DD ou data e hora ISO).'
      using errcode = '23514';
  end if;

  v_text := nullif(btrim(coalesce(new.content ->> 'units_left', '')), '');
  if v_text is not null and v_text !~ '^[0-9]{1,6}$' then
    raise exception 'Unidades restantes inválidas: informe um número inteiro.'
      using errcode = '23514';
  end if;

  foreach v_key in array array['highlights', 'social_proof', 'testimonials'] loop
    v_item := new.content -> v_key;
    if v_item is not null and jsonb_typeof(v_item) <> 'null' then
      if jsonb_typeof(v_item) <> 'array' then
        raise exception 'Conteúdo inválido: % precisa ser uma lista.', v_key using errcode = '23514';
      end if;
      if jsonb_array_length(v_item) > 30 then
        raise exception 'Conteúdo inválido: % aceita no máximo 30 itens.', v_key using errcode = '23514';
      end if;
    end if;
  end loop;

  v_item := new.content -> 'launch';
  if v_item is not null and jsonb_typeof(v_item) <> 'null' then
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Conteúdo inválido: launch precisa ser um objeto.' using errcode = '23514';
    end if;
    v_item := v_item -> 'typologies';
    if v_item is not null and jsonb_typeof(v_item) <> 'null' then
      if jsonb_typeof(v_item) <> 'array' then
        raise exception 'Conteúdo inválido: launch.typologies precisa ser uma lista.' using errcode = '23514';
      end if;
      if jsonb_array_length(v_item) > 30 then
        raise exception 'Conteúdo inválido: launch.typologies aceita no máximo 30 itens.' using errcode = '23514';
      end if;
    end if;
  end if;

  -- Rastreamento: só as três chaves conhecidas (os IDs vão para scripts da
  -- página pública). Remove vazios, apara espaços e põe os IDs do Google em
  -- maiúsculas antes de validar.
  if (new.tracking - array['meta_pixel_id', 'google_tag_id', 'gtm_container_id']) <> '{}'::jsonb then
    raise exception 'Rastreamento aceita só meta_pixel_id, google_tag_id e gtm_container_id.'
      using errcode = '23514';
  end if;

  new.tracking := (
    select coalesce(jsonb_object_agg(t.key, to_jsonb(t.val)), '{}'::jsonb)
    from (
      select
        e.key,
        case
          when e.key in ('google_tag_id', 'gtm_container_id') then upper(btrim(e.value #>> '{}'))
          else btrim(e.value #>> '{}')
        end as val
      from jsonb_each(new.tracking) as e
      where jsonb_typeof(e.value) <> 'null'
    ) as t
    where t.val <> ''
  );

  if (new.tracking ->> 'meta_pixel_id') !~ '^[0-9]{5,20}$' then
    raise exception 'ID do Pixel da Meta inválido: só números (5 a 20 dígitos).' using errcode = '23514';
  end if;
  if (new.tracking ->> 'google_tag_id') !~ '^(G|GT|AW)-[A-Z0-9]+$' then
    raise exception 'ID da tag do Google inválido (ex.: G-XXXXXXX, GT-XXXXXXX ou AW-XXXXXXX).' using errcode = '23514';
  end if;
  if (new.tracking ->> 'gtm_container_id') !~ '^GTM-[A-Z0-9]+$' then
    raise exception 'ID do contêiner do Google Tag Manager inválido (ex.: GTM-XXXXXXX).' using errcode = '23514';
  end if;

  if char_length(new.seo ->> 'title') > 70 then
    raise exception 'Título para buscadores: no máximo 70 caracteres.' using errcode = '23514';
  end if;
  if char_length(new.seo ->> 'description') > 160 then
    raise exception 'Descrição para buscadores: no máximo 160 caracteres.' using errcode = '23514';
  end if;

  -- Imóveis: até 12, sem repetição, só da própria imobiliária. Valida os ids
  -- adicionados (um imóvel excluído depois não trava a edição da página).
  if cardinality(new.property_ids) > 12 then
    raise exception 'Selecione no máximo 12 imóveis.' using errcode = '23514';
  end if;
  if array_position(new.property_ids, null) is not null
     or (select count(distinct u.id) from unnest(new.property_ids) as u (id)) <> cardinality(new.property_ids) then
    raise exception 'Lista de imóveis inválida (item vazio ou repetido).' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    v_added := new.property_ids;
  elsif new.property_ids is distinct from old.property_ids then
    select coalesce(array_agg(u.id), '{}') into v_added
    from unnest(new.property_ids) as u (id)
    where not (u.id = any (old.property_ids));
  else
    v_added := '{}';
  end if;

  if exists (
    select 1
    from unnest(v_added) as u (id)
    where not exists (
      select 1 from public.properties p
      where p.organization_id = new.organization_id
        and p.id = u.id
    )
  ) then
    raise exception 'Todos os imóveis da página precisam ser da sua imobiliária.'
      using errcode = '23514';
  end if;

  -- Publicação
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
    new.published_at := now();
  end if;

  if new.status = 'published'
     and (
       tg_op = 'INSERT'
       or old.status <> 'published'
       or new.template is distinct from old.template
       or new.property_ids is distinct from old.property_ids
       or (new.content ->> 'headline') is distinct from (old.content ->> 'headline')
     ) then
    if nullif(btrim(coalesce(new.content ->> 'headline', '')), '') is null then
      raise exception 'Informe o título principal da página antes de publicar.'
        using errcode = '23514';
    end if;

    if new.template in ('campaign_spotlight', 'portfolio_grid')
       and not exists (
         select 1
         from unnest(new.property_ids) as u (id)
         join public.properties p
           on p.organization_id = new.organization_id
          and p.id = u.id
         where p.status = 'active'
       ) then
      raise exception 'Selecione ao menos um imóvel ativo antes de publicar esta página.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.landing_pages_before_write() from public, anon, authenticated;

-- Triggers BEFORE rodam em ordem alfabética: before_write normaliza antes da
-- validação de membros.
create trigger landing_pages_before_write
  before insert or update on public.landing_pages
  for each row execute function private.landing_pages_before_write();
create trigger landing_pages_enforce_author
  before insert or update of created_by on public.landing_pages
  for each row execute function private.enforce_author_column('created_by');
create trigger landing_pages_lock_organization_id
  before update on public.landing_pages
  for each row execute function private.lock_organization_id();
create trigger landing_pages_set_updated_at
  before update on public.landing_pages
  for each row execute function private.set_updated_at();
create trigger landing_pages_validate_members
  before insert or update of lead_assignee_id on public.landing_pages
  for each row execute function private.validate_member_columns(
    'lead_assignee_id', 'O responsável pelos leads da página'
  );

alter table public.landing_pages enable row level security;

-- -----------------------------------------------------------------------------
-- 4. leads
-- -----------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  email text
    constraint leads_email_format check (
      char_length(email) <= 254
      and email ~ '^[a-z0-9._+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
      and position('..' in email) = 0
    ),
  phone text constraint leads_phone_format check (phone ~ '^[0-9]{10,13}$'),
  message text check (char_length(message) <= 2000),
  interest text constraint leads_interest_check check (interest in ('buy', 'rent', 'invest', 'sell', 'info')),
  source public.lead_source not null default 'manual',
  landing_page_id uuid,
  property_id uuid,
  client_id uuid,
  stage public.lead_stage not null default 'new',
  position numeric not null default 0,
  assigned_to uuid references auth.users (id) on delete set null,
  -- {source, medium, campaign, content, term}, cada um até 150
  utm jsonb not null default '{}'::jsonb
    constraint leads_utm_format check (
      jsonb_typeof(utm) = 'object'
      and (utm - array['source', 'medium', 'campaign', 'content', 'term']) = '{}'::jsonb
      and coalesce(char_length(utm ->> 'source'), 0) <= 150
      and coalesce(char_length(utm ->> 'medium'), 0) <= 150
      and coalesce(char_length(utm ->> 'campaign'), 0) <= 150
      and coalesce(char_length(utm ->> 'content'), 0) <= 150
      and coalesce(char_length(utm ->> 'term'), 0) <= 150
    ),
  -- {gclid, gbraid, wbraid, fbclid, fbc, fbp}, cada um até 255
  click_ids jsonb not null default '{}'::jsonb
    constraint leads_click_ids_format check (
      jsonb_typeof(click_ids) = 'object'
      and (click_ids - array['gclid', 'gbraid', 'wbraid', 'fbclid', 'fbc', 'fbp']) = '{}'::jsonb
      and coalesce(char_length(click_ids ->> 'gclid'), 0) <= 255
      and coalesce(char_length(click_ids ->> 'gbraid'), 0) <= 255
      and coalesce(char_length(click_ids ->> 'wbraid'), 0) <= 255
      and coalesce(char_length(click_ids ->> 'fbclid'), 0) <= 255
      and coalesce(char_length(click_ids ->> 'fbc'), 0) <= 255
      and coalesce(char_length(click_ids ->> 'fbp'), 0) <= 255
    ),
  landing_url text
    constraint leads_landing_url_format
      check (char_length(landing_url) <= 500 and landing_url ~* '^https?://' and landing_url !~ '[[:space:][:cntrl:]]'),
  referrer text
    constraint leads_referrer_format
      check (char_length(referrer) <= 500 and referrer ~* '^https?://' and referrer !~ '[[:space:][:cntrl:]]'),
  event_id uuid,
  typology text check (char_length(typology) <= 80),
  consent_at timestamptz,
  lost_reason text check (char_length(lost_reason) <= 500),
  last_contact_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_organization_id_id_key unique (organization_id, id),
  constraint leads_landing_page_fkey foreign key (organization_id, landing_page_id)
    references public.landing_pages (organization_id, id) on delete set null (landing_page_id),
  constraint leads_property_fkey foreign key (organization_id, property_id)
    references public.properties (organization_id, id) on delete set null (property_id),
  constraint leads_client_fkey foreign key (organization_id, client_id)
    references public.clients (organization_id, id) on delete set null (client_id),
  constraint leads_lost_reason_required check (stage <> 'lost' or lost_reason is not null)
);
create index leads_organization_stage_position_idx on public.leads (organization_id, stage, position);
create index leads_organization_assigned_to_idx on public.leads (organization_id, assigned_to);
create index leads_organization_landing_page_idx on public.leads (organization_id, landing_page_id);
create index leads_organization_phone_idx on public.leads (organization_id, right(phone, 11));
create index leads_organization_email_idx on public.leads (organization_id, lower(email));
create index leads_organization_property_idx on public.leads (organization_id, property_id);
create index leads_organization_client_idx on public.leads (organization_id, client_id);
create index leads_assigned_to_idx on public.leads (assigned_to);
create index leads_created_by_idx on public.leads (created_by);
-- Idempotência dos envios públicos: um event_id por imobiliária.
create unique index leads_organization_event_id_key
  on public.leads (organization_id, event_id)
  where event_id is not null;

-- Normalização, mensagens pt-BR e regras de etapa.
--   * e-mail em minúsculas, telefone só com dígitos
--   * ao sair de "new", last_contact_at = now() se estiver nulo
--   * "lost" exige lost_reason
create or replace function private.leads_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.phone := nullif(regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g'), '');
  new.message := nullif(btrim(coalesce(new.message, '')), '');
  new.typology := nullif(btrim(coalesce(new.typology, '')), '');
  new.lost_reason := nullif(btrim(coalesce(new.lost_reason, '')), '');

  if char_length(coalesce(new.name, '')) not between 2 and 120 then
    raise exception 'Informe o nome do lead (2 a 120 caracteres).' using errcode = '23514';
  end if;

  if new.email is not null and (
    char_length(new.email) > 254
    or new.email !~ '^[a-z0-9._+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
    or position('..' in new.email) > 0
  ) then
    raise exception 'E-mail inválido.' using errcode = '23514';
  end if;

  if new.phone is not null and new.phone !~ '^[0-9]{10,13}$' then
    raise exception 'Telefone inválido: informe DDD e número.' using errcode = '23514';
  end if;

  if new.stage = 'lost' and new.lost_reason is null then
    raise exception 'Informe o motivo da perda do lead.' using errcode = '23514';
  end if;

  if new.stage <> 'new'
     and new.last_contact_at is null
     and (tg_op = 'INSERT' or old.stage = 'new') then
    new.last_contact_at := now();
  end if;

  return new;
end;
$$;

revoke all on function private.leads_before_write() from public, anon, authenticated;

create trigger leads_before_write
  before insert or update on public.leads
  for each row execute function private.leads_before_write();
create trigger leads_enforce_author
  before insert or update of created_by on public.leads
  for each row execute function private.enforce_author_column('created_by');
-- Vincular o lead a um cliente exige acesso a ele (mesma regra de tarefas/visitas).
create trigger leads_enforce_client_access
  before insert or update of client_id on public.leads
  for each row execute function private.enforce_client_access_on_change();
create trigger leads_lock_organization_id
  before update on public.leads
  for each row execute function private.lock_organization_id();
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function private.set_updated_at();
create trigger leads_validate_members
  before insert or update of assigned_to on public.leads
  for each row execute function private.validate_member_columns(
    'assigned_to', 'O responsável pelo lead'
  );

alter table public.leads enable row level security;

-- -----------------------------------------------------------------------------
-- 5. Políticas e grants
-- -----------------------------------------------------------------------------

-- landing_pages ---------------------------------------------------------------
create policy "landing_pages: membros leem"
  on public.landing_pages for select to authenticated
  using (private.is_member(organization_id));

create policy "landing_pages: dono, gerente e assistente criam"
  on public.landing_pages for insert to authenticated
  with check (private.has_role(organization_id, '{owner,manager,assistant}'));

create policy "landing_pages: dono, gerente e assistente atualizam"
  on public.landing_pages for update to authenticated
  using (private.has_role(organization_id, '{owner,manager,assistant}'))
  with check (private.has_role(organization_id, '{owner,manager,assistant}'));

create policy "landing_pages: dono, gerente e assistente removem"
  on public.landing_pages for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager,assistant}'));

-- published_at, created_by e datas são do banco. O id pode ser informado no
-- INSERT (o editor gera o id antes para montar o caminho das imagens).
revoke all on public.landing_pages from anon;
revoke insert, update, truncate, trigger, references on public.landing_pages from authenticated;
grant select, delete on public.landing_pages to authenticated;
grant insert (
  id, organization_id, template, name, slug, status, theme, content, property_ids,
  tracking, seo, lead_assignee_id
) on public.landing_pages to authenticated;
grant update (
  template, name, slug, status, theme, content, property_ids, tracking, seo, lead_assignee_id
) on public.landing_pages to authenticated;

-- leads -----------------------------------------------------------------------
create policy "leads: acesso conforme papel"
  on public.leads for select to authenticated
  using (private.can_access_lead_row(organization_id, assigned_to, false));

create policy "leads: equipe comercial cria"
  on public.leads for insert to authenticated
  with check (
    private.has_role(organization_id, '{owner,manager,assistant,broker}')
    and private.can_access_lead_row(organization_id, assigned_to, true)
  );

-- Corretor edita os seus e os sem responsável; pode assumir (assigned_to = ele).
create policy "leads: edição conforme papel"
  on public.leads for update to authenticated
  using (private.can_access_lead_row(organization_id, assigned_to, true))
  with check (private.can_access_lead_row(organization_id, assigned_to, true));

create policy "leads: dono e gerente removem"
  on public.leads for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'));

-- Origem, atribuição de campanha (UTM, click ids, URL, event_id) e consentimento
-- vêm só de submit_landing_lead; o app edita apenas as colunas operacionais.
revoke all on public.leads from anon;
revoke insert, update, truncate, trigger, references on public.leads from authenticated;
grant select, delete on public.leads to authenticated;
grant insert (
  organization_id, name, email, phone, message, interest, source, property_id, client_id,
  stage, position, assigned_to, typology, lost_reason, last_contact_at
) on public.leads to authenticated;
grant update (
  stage, position, assigned_to, lost_reason, last_contact_at, client_id, name, email, phone,
  message, interest, property_id
) on public.leads to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Storage: landing-assets
-- -----------------------------------------------------------------------------
-- Caminho: {organization_id}/landing/{page_id}/{uuid}.{jpg|jpeg|png|webp}
-- Público para leitura (a página pública usa a URL pública); sem SVG.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'landing-assets', 'landing-assets', true, 5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Caminho no formato exato (bloqueia outras extensões, subpastas e "..") e
-- papel de dono, gerente ou assistente na imobiliária da pasta.
create or replace function private.storage_can_manage_landing_asset(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/landing/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
    and private.has_role(private.try_uuid(split_part(p_name, '/', 1)), '{owner,manager,assistant}'),
    false
  );
$$;

revoke all on function private.storage_can_manage_landing_asset(text) from public, anon;
grant execute on function private.storage_can_manage_landing_asset(text) to authenticated;

create policy "landing-assets: membros listam"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'landing-assets'
    and private.is_member(private.try_uuid((storage.foldername(name))[1]))
  );

create policy "landing-assets: dono, gerente e assistente enviam"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'landing-assets'
    and private.storage_can_manage_landing_asset(name)
  );

create policy "landing-assets: dono, gerente e assistente substituem"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'landing-assets'
    and private.storage_can_manage_landing_asset(name)
  )
  with check (
    bucket_id = 'landing-assets'
    and private.storage_can_manage_landing_asset(name)
  );

create policy "landing-assets: dono, gerente e assistente removem"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'landing-assets'
    and (storage.foldername(name))[2] = 'landing'
    and private.has_role(private.try_uuid((storage.foldername(name))[1]), '{owner,manager,assistant}')
  );

-- -----------------------------------------------------------------------------
-- 7. RPC pública: get_public_landing_page
-- -----------------------------------------------------------------------------
-- Só página publicada. Imóveis ativos na ordem de property_ids, sem dados de
-- proprietário e com endereço só até o bairro. Corretor só no modelo
-- portfolio_broker (lead_assignee_id ativo). null se a página não existir.
create or replace function public.get_public_landing_page(p_org_slug text, p_page_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_org jsonb;
  v_page public.landing_pages%rowtype;
  v_broker jsonb;
begin
  if p_org_slug is null or p_page_slug is null then
    return null;
  end if;

  select
    o.id,
    jsonb_build_object(
      'name', o.name,
      'city', o.city,
      'state', o.state,
      'phone', o.phone,
      'email', o.email,
      'creci', o.creci,
      'brand', o.brand
    )
    into v_org_id, v_org
  from public.organizations o
  where o.slug = lower(btrim(p_org_slug));

  if v_org_id is null then
    return null;
  end if;

  select lp.* into v_page
  from public.landing_pages lp
  where lp.organization_id = v_org_id
    and lp.slug = lower(btrim(p_page_slug))
    and lp.status = 'published';

  if not found then
    return null;
  end if;

  if v_page.template = 'portfolio_broker' and v_page.lead_assignee_id is not null then
    select jsonb_build_object(
      'full_name', pr.full_name,
      'creci_number', pr.creci_number,
      'creci_state', pr.creci_state,
      'avatar_url', pr.avatar_url,
      'phone', pr.phone
    )
      into v_broker
    from public.profiles pr
    join public.memberships m
      on m.user_id = pr.id
     and m.organization_id = v_org_id
     and m.active
    where pr.id = v_page.lead_assignee_id;
  end if;

  return jsonb_build_object(
    'page', jsonb_build_object(
      'id', v_page.id,
      'template', v_page.template,
      'slug', v_page.slug,
      'name', v_page.name,
      'theme', v_page.theme,
      'content', v_page.content,
      'tracking', v_page.tracking,
      'seo', v_page.seo,
      'published_at', v_page.published_at
    ),
    'organization', v_org,
    'properties', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'code', p.code,
          'title', p.title,
          'purpose', p.purpose,
          'type', p.type,
          'sale_price', p.sale_price,
          'rent_price', p.rent_price,
          'condo_fee', p.condo_fee,
          'living_area', p.living_area,
          'lot_area', p.lot_area,
          'bedrooms', p.bedrooms,
          'suites', p.suites,
          'bathrooms', p.bathrooms,
          'parking_spaces', p.parking_spaces,
          'neighborhood', p.neighborhood,
          'city', p.city,
          'state', p.state,
          'features', p.features,
          'cover_path', (
            select m.storage_path
            from public.property_media m
            where m.organization_id = p.organization_id
              and m.property_id = p.id
              and m.kind = 'image'
            order by m.is_cover desc, m.position, m.created_at, m.id
            limit 1
          ),
          'media_paths', coalesce((
            select jsonb_agg(x.storage_path order by x.position, x.created_at, x.id)
            from (
              select m.storage_path, m.position, m.created_at, m.id
              from public.property_media m
              where m.organization_id = p.organization_id
                and m.property_id = p.id
                and m.kind = 'image'
              order by m.position, m.created_at, m.id
              limit 6
            ) as x
          ), '[]'::jsonb)
        )
        order by u.ord
      )
      from unnest(v_page.property_ids) with ordinality as u (property_id, ord)
      join public.properties p
        on p.organization_id = v_page.organization_id
       and p.id = u.property_id
      where p.status = 'active'
    ), '[]'::jsonb),
    'broker', v_broker
  );
end;
$$;

revoke all on function public.get_public_landing_page(text, text) from public;
grant execute on function public.get_public_landing_page(text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. RPC pública: submit_landing_lead
-- -----------------------------------------------------------------------------

-- 8a. Segredo próprio no Vault (gerado aqui; o valor não fica no arquivo).
do $$
begin
  if not exists (select 1 from vault.secrets s where s.name = 'lead_server_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'lead_server_key',
      'Chave do servidor Next para public.submit_landing_lead (env LEAD_SERVER_KEY).'
    );
  end if;
end;
$$;

-- 8b. Nonces: reaproveita private.capture_request_nonces (só SHA-256 + data,
-- sem vínculo com o formulário). Um nonce usado em qualquer uma das duas RPCs
-- não pode ser reutilizado em nenhuma delas por 12 h.
comment on table private.capture_request_nonces is
  'Nonces já usados nas RPCs públicas submit_capture_request e submit_landing_lead (SHA-256). Registros com mais de 12 h são apagados pelas próprias funções.';

-- 8c. Envios aceitos de leads por imobiliária e por visitante (limite próprio,
-- separado da captação).
create table private.landing_lead_attempts (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_key text
    constraint landing_lead_attempts_client_key_format
      check (client_key ~ '^[A-Za-z0-9_=+/-]{32,128}$'),
  created_at timestamptz not null default now()
);

comment on table private.landing_lead_attempts is
  'Envios aceitos pelas landing pages (submit_landing_lead), para limite de taxa. Só guarda o hash do visitante (p_client_key); registros com mais de 1 dia são apagados pela própria função.';

create index landing_lead_attempts_organization_created_idx
  on private.landing_lead_attempts (organization_id, created_at);
create index landing_lead_attempts_client_key_idx
  on private.landing_lead_attempts (organization_id, client_key, created_at)
  where client_key is not null;
create index landing_lead_attempts_created_at_idx
  on private.landing_lead_attempts (created_at);

alter table private.landing_lead_attempts enable row level security;
revoke all on table private.landing_lead_attempts from public, anon, authenticated;

-- 8d. RPC
-- p_payload (jsonb):
--   name (2 a 120), email e/ou phone (ao menos um), message (até 2.000),
--   property_id (uuid presente em property_ids da página), interest
--   (buy|rent|invest|sell|info), typology (até 80), utm {source, medium,
--   campaign, content, term}, click_ids {gclid, gbraid, wbraid, fbclid, fbc, fbp},
--   landing_url, referrer (http/https), event_id (uuid), consent: true
-- p_server_key: valor do segredo lead_server_key do Vault (obrigatório)
-- p_nonce:      novo por envio, 16 a 512 caracteres visíveis (obrigatório)
-- p_client_key: hash do visitante (32 a 128 [A-Za-z0-9_=+/-]); opcional
-- Erros: 42501 (chave/nonce - mensagem genérica), 22023 (validação),
--        P0002 (página inexistente ou não publicada), 54000 (limite; detail
--        'organization' ou 'client_key').
create function public.submit_landing_lead(
  p_org_slug text,
  p_page_slug text,
  p_payload jsonb,
  p_server_key text default null,
  p_nonce text default null,
  p_client_key text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_client_key text := nullif(btrim(coalesce(p_client_key, '')), '');
  v_org uuid;
  v_page_id uuid;
  v_property_ids uuid[];
  v_assignee uuid;
  v_name text;
  v_email text;
  v_phone text;
  v_message text;
  v_interest text;
  v_typology text;
  v_text text;
  v_property_id uuid;
  v_event_id uuid;
  v_landing_url text;
  v_referrer text;
  v_utm jsonb := '{}'::jsonb;
  v_click_ids jsonb := '{}'::jsonb;
begin
  -- Chave do servidor e nonce: sempre o mesmo erro, sem indicar o motivo.
  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'lead_server_key'
  limit 1;

  if v_secret is null
     or p_server_key is null
     or extensions.digest(p_server_key, 'sha256') <> extensions.digest(v_secret, 'sha256')
     or p_nonce is null
     or char_length(p_nonce) not between 16 and 512
     or p_nonce !~ '^[[:graph:]]+$' then
    raise exception 'Não foi possível enviar o formulário.' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Dados do formulário inválidos.' using errcode = '22023';
  end if;

  if octet_length(p_payload::text) > 16384 then
    raise exception 'Formulário grande demais.' using errcode = '22023';
  end if;

  if v_client_key is not null and v_client_key !~ '^[A-Za-z0-9_=+/-]{32,128}$' then
    raise exception 'Identificação do visitante inválida.' using errcode = '22023';
  end if;

  select lp.organization_id, lp.id, lp.property_ids, lp.lead_assignee_id
    into v_org, v_page_id, v_property_ids, v_assignee
  from public.landing_pages lp
  join public.organizations o
    on o.id = lp.organization_id
  where o.slug = lower(btrim(coalesce(p_org_slug, '')))
    and lp.slug = lower(btrim(coalesce(p_page_slug, '')))
    and lp.status = 'published';

  if v_page_id is null then
    raise exception 'Página não encontrada.' using errcode = 'P0002';
  end if;

  -- Validação (erros não gastam o nonce)
  v_name := btrim(coalesce(p_payload ->> 'name', ''));
  v_email := nullif(lower(btrim(coalesce(p_payload ->> 'email', ''))), '');
  v_phone := nullif(regexp_replace(coalesce(p_payload ->> 'phone', ''), '[^0-9]', '', 'g'), '');
  v_message := nullif(btrim(coalesce(p_payload ->> 'message', '')), '');
  v_interest := nullif(lower(btrim(coalesce(p_payload ->> 'interest', ''))), '');
  v_typology := nullif(btrim(coalesce(p_payload ->> 'typology', '')), '');

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

  if char_length(v_message) > 2000 then
    raise exception 'Mensagem longa demais (máximo 2.000 caracteres).' using errcode = '22023';
  end if;

  if v_interest is not null and v_interest not in ('buy', 'rent', 'invest', 'sell', 'info') then
    raise exception 'Interesse inválido.' using errcode = '22023';
  end if;

  if char_length(v_typology) > 80 then
    raise exception 'Tipologia inválida (máximo 80 caracteres).' using errcode = '22023';
  end if;

  v_text := nullif(btrim(coalesce(p_payload ->> 'property_id', '')), '');
  if v_text is not null then
    v_property_id := private.try_uuid(v_text);
    if v_property_id is null
       or not (v_property_id = any (v_property_ids))
       or not exists (
         select 1 from public.properties p
         where p.organization_id = v_org
           and p.id = v_property_id
       ) then
      raise exception 'Imóvel inválido para esta página.' using errcode = '22023';
    end if;
  end if;

  v_text := nullif(btrim(coalesce(p_payload ->> 'event_id', '')), '');
  if v_text is not null then
    v_event_id := private.try_uuid(v_text);
    if v_event_id is null then
      raise exception 'Identificador do evento inválido.' using errcode = '22023';
    end if;
  end if;

  if lower(coalesce(p_payload ->> 'consent', '')) <> 'true' then
    raise exception 'É necessário aceitar o uso dos dados para contato (LGPD).'
      using errcode = '22023';
  end if;

  -- Atribuição de campanha: só chaves conhecidas, texto aparado e cortado no
  -- limite (um parâmetro longo na URL não derruba o lead).
  if jsonb_typeof(p_payload -> 'utm') = 'object' then
    select coalesce(jsonb_object_agg(e.key, left(btrim(e.value #>> '{}'), 150)), '{}'::jsonb)
      into v_utm
    from jsonb_each(p_payload -> 'utm') as e
    where e.key in ('source', 'medium', 'campaign', 'content', 'term')
      and jsonb_typeof(e.value) in ('string', 'number')
      and btrim(e.value #>> '{}') <> '';
  end if;

  if jsonb_typeof(p_payload -> 'click_ids') = 'object' then
    select coalesce(jsonb_object_agg(e.key, left(btrim(e.value #>> '{}'), 255)), '{}'::jsonb)
      into v_click_ids
    from jsonb_each(p_payload -> 'click_ids') as e
    where e.key in ('gclid', 'gbraid', 'wbraid', 'fbclid', 'fbc', 'fbp')
      and jsonb_typeof(e.value) in ('string', 'number')
      and btrim(e.value #>> '{}') <> '';
  end if;

  -- URLs: só http/https, sem espaços ou caracteres de controle; senão, ignoradas.
  v_landing_url := left(btrim(coalesce(p_payload ->> 'landing_url', '')), 500);
  if v_landing_url !~* '^https?://' or v_landing_url ~ '[[:space:][:cntrl:]]' then
    v_landing_url := null;
  end if;

  v_referrer := left(btrim(coalesce(p_payload ->> 'referrer', '')), 500);
  if v_referrer !~* '^https?://' or v_referrer ~ '[[:space:][:cntrl:]]' then
    v_referrer := null;
  end if;

  -- Serializa os envios da mesma imobiliária: idempotência e limites valem
  -- mesmo com requisições simultâneas.
  perform pg_advisory_xact_lock(hashtextextended('submit_landing_lead:' || v_org::text, 0));

  -- event_id repetido: ignora (o nonce é consumido normalmente).
  if v_event_id is not null and exists (
    select 1 from public.leads l
    where l.organization_id = v_org
      and l.event_id = v_event_id
  ) then
    insert into private.capture_request_nonces (nonce_hash)
    values (encode(extensions.digest(p_nonce, 'sha256'), 'hex'))
    on conflict (nonce_hash) do nothing;

    if not found then
      raise exception 'Não foi possível enviar o formulário.' using errcode = '42501';
    end if;

    return;
  end if;

  if (
    select count(*)
    from private.landing_lead_attempts a
    where a.organization_id = v_org
      and a.created_at > now() - interval '1 minute'
  ) >= 60 then
    raise exception 'Muitas solicitações em pouco tempo. Tente novamente em instantes.'
      using errcode = '54000', detail = 'organization';
  end if;

  if v_client_key is not null and (
    select count(*)
    from private.landing_lead_attempts a
    where a.organization_id = v_org
      and a.client_key = v_client_key
      and a.created_at > now() - interval '10 minutes'
  ) >= 5 then
    raise exception 'Você enviou muitos contatos em pouco tempo. Aguarde alguns minutos e tente de novo.'
      using errcode = '54000', detail = 'client_key';
  end if;

  -- Nonce consumido só quando o envio é aceito.
  insert into private.capture_request_nonces (nonce_hash)
  values (encode(extensions.digest(p_nonce, 'sha256'), 'hex'))
  on conflict (nonce_hash) do nothing;

  if not found then
    raise exception 'Não foi possível enviar o formulário.' using errcode = '42501';
  end if;

  -- Responsável desativado depois de configurado: lead fica sem responsável.
  if v_assignee is not null and not exists (
    select 1 from public.memberships m
    where m.organization_id = v_org
      and m.user_id = v_assignee
      and m.active
  ) then
    v_assignee := null;
  end if;

  insert into public.leads (
    organization_id, name, email, phone, message, interest, source, landing_page_id,
    property_id, stage, assigned_to, utm, click_ids, landing_url, referrer, event_id,
    typology, consent_at
  )
  values (
    v_org, v_name, v_email, v_phone, v_message, v_interest, 'landing_page', v_page_id,
    v_property_id, 'new', v_assignee, v_utm, v_click_ids, v_landing_url, v_referrer, v_event_id,
    v_typology, now()
  )
  on conflict (organization_id, event_id) where event_id is not null do nothing;

  insert into private.landing_lead_attempts (organization_id, client_key)
  values (v_org, v_client_key);

  -- Limpeza em lotes, sem esperar travas de outras transações.
  delete from private.landing_lead_attempts a
  where a.id in (
    select b.id
    from private.landing_lead_attempts b
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
end;
$$;

revoke all on function public.submit_landing_lead(text, text, jsonb, text, text, text) from public;
grant execute on function public.submit_landing_lead(text, text, jsonb, text, text, text) to anon, authenticated;
