/** Busca única do cabeçalho do CRM. Arquivo puro: usado no servidor e no navegador. */

/** Termo mínimo (em caracteres) para buscar; igual ao da RPC search_crm. */
export const GLOBAL_SEARCH_MIN_LENGTH = 2

/** Máximo de caracteres enviados ao servidor. */
export const GLOBAL_SEARCH_MAX_LENGTH = 80

/** Resultados por grupo (clientes, leads e imóveis). */
export const GLOBAL_SEARCH_LIMIT_PER_GROUP = 5

export type GlobalSearchEntity = "client" | "lead" | "property"

export type GlobalSearchItem = {
  entity: GlobalSearchEntity
  id: string
  title: string
  /** Linha de apoio já formatada (tipo, etapa, telefone, código, bairro). */
  description: string
  href: string
}

export type GlobalSearchGroup = {
  entity: GlobalSearchEntity
  label: string
  items: GlobalSearchItem[]
}

export type GlobalSearchResponse = { ok: true; groups: GlobalSearchGroup[] } | { ok: false }

/** Espaços repetidos viram um; corta no tamanho máximo. */
export function normalizeGlobalSearchTerm(value: unknown) {
  if (typeof value !== "string") {
    return ""
  }

  return value.replace(/\s+/g, " ").trim().slice(0, GLOBAL_SEARCH_MAX_LENGTH)
}
