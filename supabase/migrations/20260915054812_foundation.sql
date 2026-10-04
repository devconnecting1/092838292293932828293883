-- =============================================================================
-- 0100 - Fundação: schema privado, funções utilitárias e enums
-- =============================================================================

-- Schema "private": NÃO deve ser exposto na API do Supabase (Settings > API >
-- Exposed schemas). Guarda funções auxiliares de RLS, triggers e contadores.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Funções utilitárias genéricas
-- -----------------------------------------------------------------------------

-- Atualiza updated_at em todo UPDATE.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Impede mover uma linha de uma imobiliária para outra.
create or replace function private.lock_organization_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id é imutável em %', tg_table_name
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Converte texto em uuid sem lançar erro (usado para caminhos do Storage).
create or replace function private.try_uuid(value text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then value::uuid
  end;
$$;

revoke all on function private.set_updated_at() from public;
revoke all on function private.lock_organization_id() from public;
revoke all on function private.try_uuid(text) from public;
grant execute on function private.try_uuid(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

-- Base
create type public.organization_plan as enum ('small', 'medium', 'large');
create type public.app_role as enum ('owner', 'manager', 'broker', 'capturer', 'assistant', 'finance');

-- Imóveis
create type public.listing_purpose as enum ('sale', 'rent', 'sale_rent');
create type public.property_usage as enum ('residential', 'commercial', 'rural', 'industrial');
create type public.property_type as enum (
  'apartment', 'house', 'condo_house', 'penthouse', 'studio', 'flat', 'land',
  'commercial_room', 'office', 'store', 'warehouse', 'building', 'farm', 'ranch', 'other'
);
create type public.address_display as enum ('full', 'street', 'neighborhood');
create type public.property_status as enum ('draft', 'active', 'reserved', 'sold', 'rented', 'inactive');
create type public.media_kind as enum ('image', 'video', 'tour');
create type public.key_status as enum ('available', 'checked_out', 'lost');
create type public.proposal_status as enum ('draft', 'sent', 'countered', 'accepted', 'rejected', 'withdrawn');
create type public.capture_request_status as enum ('new', 'contacted', 'converted', 'discarded');

-- Clientes e agenda
create type public.client_kind as enum ('pf', 'pj');
create type public.activity_type as enum ('note', 'call', 'email', 'whatsapp', 'visit', 'meeting', 'status_change');
create type public.appointment_status as enum ('scheduled', 'confirmed', 'done', 'no_show', 'canceled');
create type public.task_status as enum ('open', 'done', 'canceled');
create type public.task_priority as enum ('low', 'medium', 'high');
