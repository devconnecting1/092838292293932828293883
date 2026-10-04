import "server-only"

import {
  AUTHORIZATION_LIST_FILTERS,
  isAuthorizationListFilter,
  type AuthorizationListFilter,
  type AuthorizationState,
} from "@workspace/core/properties/authorization-alerts"
import type { Tables } from "@workspace/database/types"

import {
  LISTING_PURPOSES,
  PROPERTIES_PAGE_SIZE,
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
} from "@/lib/imoveis/constants"
import type { ServerSupabaseClient } from "@/lib/imoveis/queries"

type SearchParams = Record<string, string | string[] | undefined>

export type PropertyListFilters = {
  q: string
  status: (typeof PROPERTY_STATUSES)[number] | ""
  purpose: (typeof LISTING_PURPOSES)[number] | ""
  type: (typeof PROPERTY_TYPES)[number] | ""
  minPrice: number | null
  maxPrice: number | null
  minBedrooms: number | null
  /** Autorização vencendo (30 dias) ou vencida; só imóveis em carteira. */
  authorization: AuthorizationListFilter | ""
  page: number
}

/** Nomes dos searchParams em pt-BR. */
export const PROPERTY_LIST_PARAMS = {
  q: "q",
  status: "status",
  purpose: "finalidade",
  type: "tipo",
  minPrice: "precoMin",
  maxPrice: "precoMax",
  minBedrooms: "quartos",
  authorization: "autorizacao",
  page: "pagina",
} as const

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""
}

function pick<T extends string>(value: string, allowed: readonly T[]): T | "" {
  return (allowed as readonly string[]).includes(value) ? (value as T) : ""
}

function positiveInteger(value: string, max: number) {
  const digits = value.replace(/\D/g, "")
  if (!digits) return null
  const parsed = Number(digits)
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null
}

function parseAuthorizationFilter(value: string): AuthorizationListFilter | "" {
  return isAuthorizationListFilter(value) ? value : ""
}

export function parsePropertyListFilters(params: SearchParams): PropertyListFilters {
  return {
    q: first(params[PROPERTY_LIST_PARAMS.q]).slice(0, 100),
    status: pick(first(params[PROPERTY_LIST_PARAMS.status]), PROPERTY_STATUSES),
    purpose: pick(first(params[PROPERTY_LIST_PARAMS.purpose]), LISTING_PURPOSES),
    type: pick(first(params[PROPERTY_LIST_PARAMS.type]), PROPERTY_TYPES),
    minPrice: positiveInteger(first(params[PROPERTY_LIST_PARAMS.minPrice]), 999_999_999_999),
    maxPrice: positiveInteger(first(params[PROPERTY_LIST_PARAMS.maxPrice]), 999_999_999_999),
    minBedrooms: positiveInteger(first(params[PROPERTY_LIST_PARAMS.minBedrooms]), 99),
    authorization: parseAuthorizationFilter(first(params[PROPERTY_LIST_PARAMS.authorization])),
    page: Math.max(1, positiveInteger(first(params[PROPERTY_LIST_PARAMS.page]), 100_000) ?? 1),
  }
}

export function hasActiveFilters(filters: PropertyListFilters) {
  return Boolean(
    filters.q ||
    filters.status ||
    filters.purpose ||
    filters.type ||
    filters.minPrice != null ||
    filters.maxPrice != null ||
    filters.minBedrooms != null ||
    filters.authorization
  )
}

/** searchParams (sem a página) para montar links de paginação. */
export function filtersToSearchParams(filters: PropertyListFilters) {
  const params = new URLSearchParams()
  if (filters.q) params.set(PROPERTY_LIST_PARAMS.q, filters.q)
  if (filters.status) params.set(PROPERTY_LIST_PARAMS.status, filters.status)
  if (filters.purpose) params.set(PROPERTY_LIST_PARAMS.purpose, filters.purpose)
  if (filters.type) params.set(PROPERTY_LIST_PARAMS.type, filters.type)
  if (filters.minPrice != null) params.set(PROPERTY_LIST_PARAMS.minPrice, String(filters.minPrice))
  if (filters.maxPrice != null) params.set(PROPERTY_LIST_PARAMS.maxPrice, String(filters.maxPrice))
  if (filters.minBedrooms != null)
    params.set(PROPERTY_LIST_PARAMS.minBedrooms, String(filters.minBedrooms))
  if (filters.authorization) params.set(PROPERTY_LIST_PARAMS.authorization, filters.authorization)
  return params
}

export type PropertyListItem = Pick<
  Tables<"properties">,
  | "id"
  | "code"
  | "title"
  | "neighborhood"
  | "city"
  | "state"
  | "purpose"
  | "type"
  | "status"
  | "sale_price"
  | "rent_price"
  | "imob_score"
  | "captured_by"
  | "broker_id"
  | "published_to_portals"
  | "is_restricted"
> & {
  coverPath: string | null
  /** Nome do proprietário que casou com a busca (para explicar o resultado). */
  matchedOwner: string | null
  /** Situação da autorização hoje (null se o banco não informou). */
  authorizationState: AuthorizationState | null
  /** Último dia coberto pela autorização (AAAA-MM-DD). */
  authorizationEndsOn: string | null
}

const AUTHORIZATION_STATES: readonly AuthorizationState[] = [
  "none",
  "active",
  "expiring",
  "expired",
  "upcoming",
]

function toAuthorizationState(value: string | null): AuthorizationState | null {
  return AUTHORIZATION_STATES.find((state) => state === value) ?? null
}

export type PropertyListResult = {
  items: PropertyListItem[]
  total: number
  page: number
  pageCount: number
  /** Página pedida além da última. */
  outOfRange: boolean
}

export async function listProperties(
  supabase: ServerSupabaseClient,
  organizationId: string,
  filters: PropertyListFilters
): Promise<PropertyListResult> {
  // Tudo no Postgres (public.search_properties): filtros, busca por endereço e
  // por nome do proprietário, capa, paginação e total. `security invoker`, então
  // o RLS de properties e de clients continua decidindo o que aparece.
  const authorizationParam = filters.authorization
    ? AUTHORIZATION_LIST_FILTERS[filters.authorization]
    : undefined
  const { data, error } = await supabase.rpc("search_properties", {
    p_organization_id: organizationId,
    // `undefined` sai do corpo do POST e o Postgres usa o default da função.
    p_term: filters.q || undefined,
    p_status: filters.status || undefined,
    p_purpose: filters.purpose || undefined,
    p_type: filters.type || undefined,
    p_min_price: filters.minPrice ?? undefined,
    p_max_price: filters.maxPrice ?? undefined,
    p_min_bedrooms: filters.minBedrooms ?? undefined,
    p_authorization: authorizationParam,
    p_limit: PROPERTIES_PAGE_SIZE,
    p_offset: (filters.page - 1) * PROPERTIES_PAGE_SIZE,
  })

  if (error) {
    throw new Error(`Não foi possível carregar os imóveis (${error.code ?? "erro"}).`)
  }

  const rows = data ?? []
  const items: PropertyListItem[] = rows.map((row) => ({
    id: row.id,
    code: row.code,
    title: row.title,
    neighborhood: row.neighborhood,
    city: row.city,
    state: row.state,
    purpose: row.purpose,
    type: row.type,
    status: row.status,
    sale_price: row.sale_price,
    rent_price: row.rent_price,
    imob_score: row.imob_score,
    captured_by: row.captured_by,
    broker_id: row.broker_id,
    published_to_portals: row.published_to_portals,
    is_restricted: row.is_restricted,
    coverPath: row.cover_path,
    matchedOwner: row.matched_owner,
    authorizationState: toAuthorizationState(row.authorization_state),
    authorizationEndsOn: row.authorization_ends_on,
  }))

  // O total vem repetido em cada linha, então uma página vazia não o traz. Nesse
  // caso a tela não consegue distinguir "o filtro não achou nada" de "a página
  // pedida passou da última" — duas mensagens bem diferentes para o usuário.
  // Uma segunda chamada, só com a primeira linha, resolve; ela só acontece
  // quando a página vem vazia depois da primeira, que é o caso raro.
  let total = rows[0]?.total_count ?? 0

  if (items.length === 0 && filters.page > 1) {
    const { data: firstPage } = await supabase.rpc("search_properties", {
      p_organization_id: organizationId,
      p_term: filters.q || undefined,
      p_status: filters.status || undefined,
      p_purpose: filters.purpose || undefined,
      p_type: filters.type || undefined,
      p_min_price: filters.minPrice ?? undefined,
      p_max_price: filters.maxPrice ?? undefined,
      p_min_bedrooms: filters.minBedrooms ?? undefined,
      p_authorization: authorizationParam,
      p_limit: 1,
      p_offset: 0,
    })

    total = firstPage?.[0]?.total_count ?? 0
  }

  return {
    items,
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / PROPERTIES_PAGE_SIZE)),
    // Fora de alcance é só quando existe resultado em outra página. Filtro que
    // não achou nada continua sendo "nenhum imóvel encontrado".
    outOfRange: items.length === 0 && filters.page > 1 && total > 0,
  }
}
