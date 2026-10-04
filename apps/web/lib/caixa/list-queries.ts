import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { isStateCode } from "@workspace/core/br/states"
import { PROPERTY_TYPE_VALUES, type PropertyType } from "@workspace/core/properties/enums"
import type { Database, Tables } from "@workspace/database/types"

import {
  CAIXA_LIST_PARAMS,
  CAIXA_PAGE_SIZE,
  CAIXA_SORT_VALUES,
  type CaixaSort,
} from "@/lib/caixa/constants"

type ServerSupabaseClient = SupabaseClient<Database>

type SearchParams = Record<string, string | string[] | undefined>

export type CaixaListFilters = {
  q: string
  uf: string
  city: string
  neighborhood: string
  type: PropertyType | ""
  saleMode: string
  minPrice: number | null
  maxPrice: number | null
  /** `true` = só quem aceita financiamento; `null` = tanto faz. */
  financing: boolean | null
  onlyFavorites: boolean
  sort: CaixaSort
  page: number
}

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""
}

function positiveInteger(value: string, max: number) {
  const digits = value.replace(/\D/g, "")

  if (!digits) {
    return null
  }

  const parsed = Number(digits)

  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null
}

function pickSort(value: string): CaixaSort {
  return (CAIXA_SORT_VALUES as readonly string[]).includes(value)
    ? (value as CaixaSort)
    : "novidades"
}

function pickType(value: string): PropertyType | "" {
  return (PROPERTY_TYPE_VALUES as readonly string[]).includes(value) ? (value as PropertyType) : ""
}

export function parseCaixaListFilters(params: SearchParams): CaixaListFilters {
  const uf = first(params[CAIXA_LIST_PARAMS.uf]).toUpperCase()
  const financing = first(params[CAIXA_LIST_PARAMS.financing])

  return {
    q: first(params[CAIXA_LIST_PARAMS.q]).slice(0, 100),
    uf: isStateCode(uf) ? uf : "",
    city: first(params[CAIXA_LIST_PARAMS.city]).slice(0, 120),
    neighborhood: first(params[CAIXA_LIST_PARAMS.neighborhood]).slice(0, 120),
    type: pickType(first(params[CAIXA_LIST_PARAMS.type])),
    saleMode: first(params[CAIXA_LIST_PARAMS.saleMode]).slice(0, 80),
    minPrice: positiveInteger(first(params[CAIXA_LIST_PARAMS.minPrice]), 999_999_999_999),
    maxPrice: positiveInteger(first(params[CAIXA_LIST_PARAMS.maxPrice]), 999_999_999_999),
    financing: financing === "sim" ? true : financing === "nao" ? false : null,
    onlyFavorites: first(params[CAIXA_LIST_PARAMS.favorites]) === "1",
    sort: pickSort(first(params[CAIXA_LIST_PARAMS.sort])),
    page: Math.max(1, positiveInteger(first(params[CAIXA_LIST_PARAMS.page]), 100_000) ?? 1),
  }
}

export function hasActiveCaixaFilters(filters: CaixaListFilters) {
  return Boolean(
    filters.q ||
    filters.uf ||
    filters.city ||
    filters.neighborhood ||
    filters.type ||
    filters.saleMode ||
    filters.minPrice != null ||
    filters.maxPrice != null ||
    filters.financing != null ||
    filters.onlyFavorites
  )
}

/** searchParams (sem a página) para montar links de paginação. */
export function caixaFiltersToSearchParams(filters: CaixaListFilters) {
  const params = new URLSearchParams()

  if (filters.q) params.set(CAIXA_LIST_PARAMS.q, filters.q)
  if (filters.uf) params.set(CAIXA_LIST_PARAMS.uf, filters.uf)
  if (filters.city) params.set(CAIXA_LIST_PARAMS.city, filters.city)
  if (filters.neighborhood) params.set(CAIXA_LIST_PARAMS.neighborhood, filters.neighborhood)
  if (filters.type) params.set(CAIXA_LIST_PARAMS.type, filters.type)
  if (filters.saleMode) params.set(CAIXA_LIST_PARAMS.saleMode, filters.saleMode)
  if (filters.minPrice != null) params.set(CAIXA_LIST_PARAMS.minPrice, String(filters.minPrice))
  if (filters.maxPrice != null) params.set(CAIXA_LIST_PARAMS.maxPrice, String(filters.maxPrice))
  if (filters.financing != null) {
    params.set(CAIXA_LIST_PARAMS.financing, filters.financing ? "sim" : "nao")
  }
  if (filters.onlyFavorites) params.set(CAIXA_LIST_PARAMS.favorites, "1")
  if (filters.sort !== "novidades") params.set(CAIXA_LIST_PARAMS.sort, filters.sort)

  return params
}

export type CaixaListingItem = {
  numero: string
  uf: string
  cidade: string
  bairro: string | null
  endereco: string
  preco: number
  valorAvaliacao: number | null
  /** Como a Caixa publica. Nunca calculado a partir de preço e avaliação. */
  desconto: number | null
  aceitaFinanciamento: boolean | null
  descricao: string | null
  modalidade: string | null
  link: string
  tipo: PropertyType
  areaTotal: number | null
  areaPrivativa: number | null
  areaTerreno: number | null
  quartos: number | null
  vagas: number | null
  listaGeradaEm: string | null
  saiuDaListaEm: string | null
  isFavorite: boolean
  linkCount: number
}

export type CaixaListResult = {
  items: CaixaListingItem[]
  total: number
  page: number
  pageCount: number
  /** Página pedida além da última. */
  outOfRange: boolean
}

type SearchRow = Database["public"]["Functions"]["search_caixa_listings"]["Returns"][number]

function toItem(row: SearchRow): CaixaListingItem {
  return {
    numero: row.numero,
    uf: row.uf,
    cidade: row.cidade,
    bairro: row.bairro,
    endereco: row.endereco,
    preco: Number(row.preco),
    valorAvaliacao: row.valor_avaliacao === null ? null : Number(row.valor_avaliacao),
    desconto: row.desconto === null ? null : Number(row.desconto),
    aceitaFinanciamento: row.aceita_financiamento,
    descricao: row.descricao,
    modalidade: row.modalidade,
    link: row.link,
    tipo: row.tipo,
    areaTotal: row.area_total === null ? null : Number(row.area_total),
    areaPrivativa: row.area_privativa === null ? null : Number(row.area_privativa),
    areaTerreno: row.area_terreno === null ? null : Number(row.area_terreno),
    quartos: row.quartos,
    vagas: row.vagas,
    listaGeradaEm: row.lista_gerada_em,
    saiuDaListaEm: row.saiu_da_lista_em,
    isFavorite: row.is_favorite,
    linkCount: Number(row.link_count ?? 0),
  }
}

function rpcArgs(organizationId: string, filters: CaixaListFilters) {
  return {
    p_organization_id: organizationId,
    // `undefined` sai do corpo do POST e o Postgres usa o default da função.
    p_term: filters.q || undefined,
    p_uf: filters.uf || undefined,
    p_cidade: filters.city || undefined,
    p_bairro: filters.neighborhood || undefined,
    p_tipo: filters.type || undefined,
    p_modalidade: filters.saleMode || undefined,
    p_min_price: filters.minPrice ?? undefined,
    p_max_price: filters.maxPrice ?? undefined,
    p_financiamento: filters.financing ?? undefined,
    p_only_favorites: filters.onlyFavorites,
    // Na lista geral, imóvel que saiu do arquivo fica de fora. Nos favoritos
    // ele continua aparecendo, com o aviso de que saiu — some sem explicação
    // seria pior do que ver "saiu da lista da Caixa em DD/MM".
    p_include_delisted: filters.onlyFavorites,
    p_sort: filters.sort,
  }
}

export async function listCaixaListings(
  supabase: ServerSupabaseClient,
  organizationId: string,
  filters: CaixaListFilters
): Promise<CaixaListResult> {
  const { data, error } = await supabase.rpc("search_caixa_listings", {
    ...rpcArgs(organizationId, filters),
    p_limit: CAIXA_PAGE_SIZE,
    p_offset: (filters.page - 1) * CAIXA_PAGE_SIZE,
  })

  if (error) {
    throw new Error(`Não foi possível carregar os imóveis da Caixa (${error.code ?? "erro"}).`)
  }

  const rows = data ?? []
  let total = Number(rows[0]?.total_count ?? 0)

  // O total vem repetido em cada linha, então uma página vazia não o traz — e
  // a tela precisa distinguir "o filtro não achou nada" de "esta página não
  // existe". A segunda chamada só acontece nesse caso raro.
  if (rows.length === 0 && filters.page > 1) {
    const { data: firstPage } = await supabase.rpc("search_caixa_listings", {
      ...rpcArgs(organizationId, filters),
      p_limit: 1,
      p_offset: 0,
    })

    total = Number(firstPage?.[0]?.total_count ?? 0)
  }

  return {
    items: rows.map(toItem),
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / CAIXA_PAGE_SIZE)),
    outOfRange: rows.length === 0 && filters.page > 1 && total > 0,
  }
}

export type CaixaFacets = {
  ufs: { uf: string; count: number }[]
  cidades: { cidade: string; count: number }[]
  modalidades: { modalidade: string; count: number }[]
}

function readFacetList<T>(value: unknown, read: (item: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(value)) {
    return []
  }

  const result: T[] = []

  for (const item of value) {
    if (typeof item === "object" && item !== null) {
      const parsed = read(item as Record<string, unknown>)

      if (parsed !== null) {
        result.push(parsed)
      }
    }
  }

  return result
}

/** Opções dos selects de filtro, contadas no banco. */
export async function getCaixaFacets(
  supabase: ServerSupabaseClient,
  uf: string
): Promise<CaixaFacets> {
  const { data, error } = await supabase.rpc("caixa_catalog_facets", {
    p_uf: uf || undefined,
  })

  if (error || typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ufs: [], cidades: [], modalidades: [] }
  }

  const payload = data as Record<string, unknown>

  return {
    ufs: readFacetList(payload.ufs, (item) =>
      typeof item.uf === "string" ? { uf: item.uf, count: Number(item.count ?? 0) } : null
    ),
    cidades: readFacetList(payload.cidades, (item) =>
      typeof item.cidade === "string"
        ? { cidade: item.cidade, count: Number(item.count ?? 0) }
        : null
    ),
    modalidades: readFacetList(payload.modalidades, (item) =>
      typeof item.modalidade === "string"
        ? { modalidade: item.modalidade, count: Number(item.count ?? 0) }
        : null
    ),
  }
}

export type CaixaCatalogStatus = Pick<
  Tables<"caixa_catalog_status">,
  "lista_gerada_em" | "last_changed_at" | "last_checked_at" | "total_ativo"
>

/**
 * Estado do catálogo para a tela. `lista_gerada_em` é a data que a própria
 * Caixa declara no arquivo (a idade do dado); `last_changed_at` é quando a
 * nossa cópia mudou de verdade. `last_checked_at` só diz que alguém tentou
 * carregar (inclusive um arquivo igual ao anterior).
 */
export async function getCaixaCatalogStatus(
  supabase: ServerSupabaseClient
): Promise<CaixaCatalogStatus | null> {
  const { data, error } = await supabase
    .from("caixa_catalog_status")
    .select("lista_gerada_em, last_changed_at, last_checked_at, total_ativo")
    .maybeSingle()

  if (error) {
    return null
  }

  return data
}
