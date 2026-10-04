import { z } from "zod"

import { CLIENTS_PATH, isClientSource, type ClientSource } from "@/lib/clientes/constants"
import { sanitizeSearchTerm } from "@/lib/clientes/search"

/** Filtro de responsável que seleciona clientes sem responsável. */
export const UNASSIGNED_FILTER = "sem"

export type ClientListFilters = {
  busca: string
  tipo: "" | "pf" | "pj"
  /** uuid do membro, UNASSIGNED_FILTER ou "" (todos). */
  responsavel: string
  origem: "" | ClientSource
  etiqueta: string
  pagina: number
}

export type RawSearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

export function parseClientListFilters(params: RawSearchParams): ClientListFilters {
  const tipo = first(params.tipo)
  const responsavel = first(params.responsavel)
  const origem = first(params.origem)
  const pagina = Number.parseInt(first(params.pagina), 10)

  return {
    busca: sanitizeSearchTerm(first(params.busca)),
    tipo: tipo === "pf" || tipo === "pj" ? tipo : "",
    responsavel:
      responsavel === UNASSIGNED_FILTER || z.guid().safeParse(responsavel).success
        ? responsavel
        : "",
    origem: isClientSource(origem) ? origem : "",
    etiqueta: first(params.etiqueta).trim().slice(0, 40),
    pagina: Number.isFinite(pagina) && pagina > 0 ? Math.min(pagina, 10_000) : 1,
  }
}

export function hasActiveClientFilters(filters: ClientListFilters) {
  return Boolean(
    filters.busca || filters.tipo || filters.responsavel || filters.origem || filters.etiqueta
  )
}

/** URL da lista com os filtros informados (página 1 e valores vazios são omitidos). */
export function buildClientListHref(filters: Partial<ClientListFilters>) {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "" || (key === "pagina" && value === 1)) {
      continue
    }

    params.set(key, String(value))
  }

  const query = params.toString()
  return query ? `${CLIENTS_PATH}?${query}` : CLIENTS_PATH
}
