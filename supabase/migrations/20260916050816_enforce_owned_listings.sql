-- =============================================================================
-- O banco passa a aplicar `owned_listings` e `photos_per_listing`
-- =============================================================================
-- Até aqui esses dois limites eram só rótulo na página de planos: o banco só
-- aplicava `users` e `landing_pages`. Agora eles valem de verdade, no mesmo
-- molde de private.enforce_billing_landing_pages().
--
-- A definição que sustenta a régua comercial:
--
--   "imóvel próprio"  = imóvel com pelo menos UMA foto no nosso bucket
--                       (property_media.kind = 'image' e storage_path não nulo)
--   "imóvel importado" = as fotos vivem na origem (external_url). Não ocupa
--                       nada nosso, então não conta em limite nenhum.
--
-- É por isso que a promessa "imóveis importados são ilimitados" se sustenta
-- sozinha: o que não está no nosso bucket não entra na contagem, por construção.

-- -----------------------------------------------------------------------------
-- 1. Foto de imóvel importado passa a ser possível
-- -----------------------------------------------------------------------------
-- A regra antiga exigia storage_path para toda imagem, o que impedia o
-- importador de XML/API de apontar para a foto hospedada na origem. Agora a
-- imagem aceita UMA das duas origens, nunca as duas; vídeo e tour seguem só
-- com URL externa.
alter table public.property_media drop constraint if exists property_media_source;

alter table public.property_media add constraint property_media_source check (
  (
    kind = 'image'
    and (
      (storage_path is not null and external_url is null)
      or (storage_path is null and external_url ~ '^https://')
    )
  )
  or (kind in ('video', 'tour') and storage_path is null and external_url ~ '^https://')
);

-- -----------------------------------------------------------------------------
-- 2. Contadores
-- -----------------------------------------------------------------------------
-- Fotos que ocupam o nosso armazenamento neste imóvel.
create or replace function private.owned_photo_count(p_property_id uuid, p_exclude uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.property_media m
  where m.property_id = p_property_id
    and m.kind = 'image'
    and m.storage_path is not null
    and (p_exclude is null or m.id <> p_exclude);
$$;

revoke all on function private.owned_photo_count(uuid, uuid) from public, anon, authenticated;

-- Imóveis da imobiliária que já ocupam armazenamento (≥ 1 foto no bucket).
create or replace function private.owned_listing_count(p_organization_id uuid, p_except uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct m.property_id)::integer
  from public.property_media m
  where m.organization_id = p_organization_id
    and m.kind = 'image'
    and m.storage_path is not null
    and (p_except is null or m.property_id <> p_except);
$$;

revoke all on function private.owned_listing_count(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Trava
-- -----------------------------------------------------------------------------
-- Duas checagens numa passada só, porque as duas dependem da mesma linha nova:
--   · photos_per_listing → fotos deste imóvel no bucket + 1 <= limite
--   · owned_listings     → só quando ESTE imóvel ainda não ocupava nada, isto é,
--                          quando a linha nova é a primeira foto dele
--
-- Igual ao trigger de landing pages: sem usuário na sessão (rotinas do servidor,
-- importador, migração) o trigger sai fora — quem controla ali é o código que
-- roda com a chave do servidor, não o limite comercial da tela.
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
  perform pg_advisory_xact_lock(
    hashtextextended('billing_owned_listings:' || new.organization_id::text, 0)
  );

  v_photo_limit := private.billing_limit(new.organization_id, 'photos_per_listing');

  if v_photo_limit is not null and v_photo_limit >= 0 then
    v_photos := private.owned_photo_count(new.property_id, new.id);

    if v_photos + 1 > v_photo_limit then
      raise exception 'limite_photos_per_listing'
        using errcode = 'P0001',
              detail = jsonb_build_object('limit', v_photo_limit, 'usage', v_photos)::text;
    end if;
  else
    v_photos := private.owned_photo_count(new.property_id, new.id);
  end if;

  -- O imóvel só entra na conta de "imóveis próprios" na PRIMEIRA foto dele.
  if v_photos = 0 then
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

-- Prefixo a0_ pela mesma razão dos outros triggers de cobrança: o Postgres
-- dispara triggers do mesmo evento em ordem alfabética, e a checagem de limite
-- tem que rodar antes dos que preenchem coluna.
drop trigger if exists a0_billing_owned_listings on public.property_media;

create trigger a0_billing_owned_listings
  before insert or update of kind, storage_path on public.property_media
  for each row execute function private.enforce_billing_owned_listings();

-- -----------------------------------------------------------------------------
-- 4. Índice que as duas contagens usam
-- -----------------------------------------------------------------------------
-- Parcial: só as linhas que ocupam armazenamento entram, que é exatamente o
-- conjunto contado. Mantém o índice pequeno mesmo com muita foto importada.
create index if not exists property_media_owned_idx
  on public.property_media (organization_id, property_id)
  where kind = 'image' and storage_path is not null;

comment on function private.enforce_billing_owned_listings() is
  'Aplica limits.owned_listings e limits.photos_per_listing. Conta só foto no bucket próprio (kind = image com storage_path); foto importada por XML/API fica na origem e não consome limite.';
