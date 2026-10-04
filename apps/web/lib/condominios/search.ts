/**
 * Busca e paginação da lista de condomínios (searchParams `q` e `pagina`).
 * Puro: roda no servidor e no navegador.
 */

export const CONDOMINIUM_SEARCH_MAX_LENGTH = 80
export const CONDOMINIUMS_PATH = "/condominios"

type SearchParamValue = string | string[] | undefined

function firstValue(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] : value
}

/** Texto digitado na busca, como o usuário vê (sem saneamento). */
export function readSearchQuery(value: SearchParamValue) {
  const raw = firstValue(value)
  return typeof raw === "string" ? raw.trim().slice(0, CONDOMINIUM_SEARCH_MAX_LENGTH) : ""
}

/** Página 1-based; valores ausentes ou inválidos viram 1. */
export function parsePageParam(value: SearchParamValue) {
  const raw = firstValue(value)
  if (typeof raw !== "string" || !/^\d{1,6}$/.test(raw)) return 1
  const page = Number(raw)
  return page >= 1 ? page : 1
}

/**
 * Termo seguro para o filtro `.or()` do PostgREST: remove vírgula, parênteses,
 * aspas e curingas, que quebrariam ou ampliariam o filtro.
 */
export function sanitizeCondominiumSearch(value: string) {
  return value
    .replace(/[,()"'`\\%_*:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CONDOMINIUM_SEARCH_MAX_LENGTH)
}

/** Filtro `.or()`: nome, bairro ou cidade. */
export function buildCondominiumSearchFilter(term: string) {
  return [`name.ilike.%${term}%`, `neighborhood.ilike.%${term}%`, `city.ilike.%${term}%`].join(",")
}

export function buildCondominiumsHref({ query, page }: { query?: string; page?: number }) {
  const params = new URLSearchParams()
  if (query) params.set("q", query)
  if (page && page > 1) params.set("pagina", String(page))
  const search = params.toString()
  return search ? `${CONDOMINIUMS_PATH}?${search}` : CONDOMINIUMS_PATH
}
