-- =============================================================================
-- Imóvel vendido, alugado ou inativo deixa de contar em `owned_listings`
-- =============================================================================
-- Decisão do dono (16/09/2026): o limite de imóveis próprios com foto
-- (Corretor 5, Imobiliária 20, Equipe 50, Rede 150) mede a carteira em
-- andamento. Imóvel que saiu da carteira não ocupa vaga, mesmo com fotos no
-- nosso bucket. O limite de fotos por imóvel continua valendo para todo imóvel,
-- em qualquer status.
--
-- O enum public.property_status não tem "arquivado": o estado equivalente é
-- 'inactive' (rótulo "Inativo" no app). Saem da contagem:
--   sold     → Vendido
--   rented   → Alugado
--   inactive → Inativo (o "arquivado" do app)
-- Continuam contando: draft (Rascunho), active (Ativo) e reserved (Reservado —
-- negócio em andamento, o imóvel ainda está na carteira e pode voltar a ativo).
--
-- A lista é de EXCLUSÃO de propósito: se um status novo entrar no enum, ele
-- conta até alguém decidir o contrário — o engano fica a favor do limite.
--
-- Brecha fechada junto: inativar um imóvel para liberar a vaga, subir fotos em
-- outro e depois reativar o primeiro. A volta de um status que não conta para
-- um que conta passa pela mesma régua do upload e é recusada com o mesmo código
-- (limite_owned_listings) e o mesmo detail {limit, usage}, que o app já traduz.

-- -----------------------------------------------------------------------------
-- 1. Status que tiram o imóvel da carteira (fonte única da regra)
-- -----------------------------------------------------------------------------
-- Immutable e sem argumento: o planejador troca a chamada pela constante, então
-- `status <> all (...)` continua aproveitando o índice (organization_id, status).
create or replace function private.owned_listing_exempt_statuses()
returns public.property_status[]
language sql
immutable
set search_path = ''
as $$
  select array['sold', 'rented', 'inactive']::public.property_status[];
$$;

revoke all on function private.owned_listing_exempt_statuses() from public, anon, authenticated;

comment on function private.owned_listing_exempt_statuses() is
  'Status de imóvel que NÃO contam em limits.owned_listings: sold (Vendido), rented (Alugado) e inactive (Inativo, o arquivado do app). Lista de exclusão: status novo no enum conta até decisão em contrário.';

-- -----------------------------------------------------------------------------
-- 2. Contagem de imóveis próprios: só os que ainda estão na carteira
-- -----------------------------------------------------------------------------
create or replace function private.owned_listing_count(p_organization_id uuid, p_except uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.properties p
  where p.organization_id = p_organization_id
    and p.status <> all (private.owned_listing_exempt_statuses())
    and (p_except is null or p.id <> p_except)
    and exists (
      select 1
      from public.property_media m
      where m.organization_id = p.organization_id
        and m.property_id = p.id
        and m.kind = 'image'
        and m.storage_path is not null
    );
$$;

revoke all on function private.owned_listing_count(uuid, uuid) from public, anon, authenticated;

comment on function private.owned_listing_count(uuid, uuid) is
  'Imóveis da imobiliária que consomem limits.owned_listings: pelo menos uma foto no bucket próprio (kind = image com storage_path) e status fora de private.owned_listing_exempt_statuses(). p_except tira um imóvel da conta (o que está sendo checado).';

-- -----------------------------------------------------------------------------
-- 3. Upload: primeira foto em imóvel fora da carteira não pede vaga
-- -----------------------------------------------------------------------------
-- Mesma trava de antes, com uma diferença: se o imóvel está vendido, alugado ou
-- inativo, a primeira foto dele não ocupa vaga (a contagem acima já o ignora),
-- então a checagem de owned_listings não roda. Se ele voltar para a carteira
-- depois, quem cobra a vaga é o gatilho de status (seção 4).
create or replace function private.enforce_billing_owned_listings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photo_limit integer;
  v_listing_limit integer;
  v_photos integer;
  v_listings integer;
  v_status public.property_status;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  -- Só foto no nosso bucket ocupa espaço. Vídeo, tour e foto importada saem aqui.
  if new.kind <> 'image' or new.storage_path is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.kind = 'image' and old.storage_path is not null then
    -- Já contava antes e continua contando: nada muda no consumo.
    return new;
  end if;

  if tg_op = 'INSERT' and not private.is_member(new.organization_id) then
    return new;
  end if;

  -- Serializa a imobiliária: sem isso, dois uploads simultâneos passam os dois.
  -- Mesma chave do gatilho de status em properties.
  perform pg_advisory_xact_lock(
    hashtextextended('billing_owned_listings:' || new.organization_id::text, 0)
  );

  v_photos := private.owned_photo_count(new.property_id, new.id);
  v_photo_limit := private.billing_limit(new.organization_id, 'photos_per_listing');

  -- Fotos por imóvel: vale em qualquer status.
  if v_photo_limit is not null and v_photo_limit >= 0 and v_photos + 1 > v_photo_limit then
    raise exception 'limite_photos_per_listing'
      using errcode = 'P0001',
            detail = jsonb_build_object('limit', v_photo_limit, 'usage', v_photos)::text;
  end if;

  -- O imóvel só entra na conta de "imóveis próprios" na PRIMEIRA foto dele, e
  -- só se estiver na carteira. O status é lido depois do lock para enxergar uma
  -- reativação concorrente que já foi confirmada.
  if v_photos = 0 then
    select p.status into v_status
    from public.properties p
    where p.organization_id = new.organization_id
      and p.id = new.property_id;

    if v_status = any (private.owned_listing_exempt_statuses()) then
      return new;
    end if;

    v_listing_limit := private.billing_limit(new.organization_id, 'owned_listings');

    if v_listing_limit is not null and v_listing_limit >= 0 then
      v_listings := private.owned_listing_count(new.organization_id, new.property_id);

      if v_listings + 1 > v_listing_limit then
        raise exception 'limite_owned_listings'
          using errcode = 'P0001',
                detail = jsonb_build_object('limit', v_listing_limit, 'usage', v_listings)::text;
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_billing_owned_listings() from public, anon, authenticated;

comment on function private.enforce_billing_owned_listings() is
  'Aplica limits.owned_listings e limits.photos_per_listing no upload. Conta só foto no bucket próprio (kind = image com storage_path); foto importada por XML/API fica na origem e não consome limite. Primeira foto de imóvel vendido, alugado ou inativo não pede vaga; fotos por imóvel valem em qualquer status.';

-- -----------------------------------------------------------------------------
-- 4. Reativação: voltar para a carteira pede vaga
-- -----------------------------------------------------------------------------
-- Dispara só quando o status muda de um que não conta (vendido, alugado,
-- inativo) para um que conta (rascunho, ativo, reservado) e o imóvel tem foto no
-- nosso bucket. Sair da carteira, trocar entre dois status que contam ou entre
-- dois que não contam não mexe no consumo.
--
-- Igual aos outros gatilhos de cobrança: sem usuário na sessão (rotinas do
-- servidor, importador, migração) o gatilho sai fora.
create or replace function private.enforce_billing_owned_listings_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_listings integer;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if not (old.status = any (private.owned_listing_exempt_statuses()))
     or new.status = any (private.owned_listing_exempt_statuses()) then
    return new;
  end if;

  v_limit := private.billing_limit(new.organization_id, 'owned_listings');

  if v_limit is null or v_limit < 0 then
    return new;
  end if;

  -- Mesma chave do upload: uma foto nova e uma reativação simultâneas não
  -- conseguem passar as duas pela última vaga.
  perform pg_advisory_xact_lock(
    hashtextextended('billing_owned_listings:' || new.organization_id::text, 0)
  );

  -- Imóvel sem foto no nosso bucket (importado ou sem fotos) não ocupa vaga.
  if not exists (
    select 1
    from public.property_media m
    where m.organization_id = new.organization_id
      and m.property_id = new.id
      and m.kind = 'image'
      and m.storage_path is not null
  ) then
    return new;
  end if;

  v_listings := private.owned_listing_count(new.organization_id, new.id);

  if v_listings + 1 > v_limit then
    raise exception 'limite_owned_listings'
      using errcode = 'P0001',
            detail = jsonb_build_object('limit', v_limit, 'usage', v_listings)::text;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_billing_owned_listings_status() from public, anon, authenticated;

comment on function private.enforce_billing_owned_listings_status() is
  'Aplica limits.owned_listings na volta de um imóvel com foto no bucket próprio para a carteira (de vendido, alugado ou inativo para rascunho, ativo ou reservado). Recusa com limite_owned_listings e detail {limit, usage}, o mesmo erro do upload.';

-- Prefixo a0_ como os outros gatilhos de cobrança: roda antes dos que preenchem
-- coluna. O WHEN evita chamar a função em update que não troca o status.
drop trigger if exists a0_billing_owned_listings_status on public.properties;

create trigger a0_billing_owned_listings_status
  before update of status on public.properties
  for each row
  when (old.status is distinct from new.status)
  execute function private.enforce_billing_owned_listings_status();

comment on trigger a0_billing_owned_listings_status on public.properties is
  'Recusa reativar imóvel com foto própria (vendido/alugado/inativo → rascunho/ativo/reservado) quando a imobiliária já está no limite de imóveis próprios.';
