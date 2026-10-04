import { z } from "zod"

import { addDays, toDateKey, zonedToIso } from "@/lib/agenda/datetime"
import { isLeadSource, LEADS_PATH } from "@/lib/leads/constants"
import type { LeadSource } from "@/lib/leads/db-types"

/** Filtro de responsável: leads sem responsável. */
export const UNASSIGNED_FILTER = "sem"
/** Filtro de responsável: leads atribuídos ao usuário atual. */
export const MINE_FILTER = "meus"

export const LEAD_PERIODS = ["todos", "hoje", "7d", "30d", "90d"] as const
export type LeadPeriod = (typeof LEAD_PERIODS)[number]

export const LEAD_PERIOD_LABELS: Record<LeadPeriod, string> = {
  todos: "Todo o período",
  hoje: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
}

export const LEAD_VIEWS = ["quadro", "lista"] as const
export type LeadView = (typeof LEAD_VIEWS)[number]

export function isLeadView(value: unknown): value is LeadView {
  return value === "quadro" || value === "lista"
}

/**
 * Celular: abaixo de 640 px (o `sm` do Tailwind), onde a lista vira cartões.
 * Nele a visão padrão é a lista; no computador continua o quadro. O servidor
 * não sabe a largura da tela, então o padrão do celular é aplicado no navegador.
 */
export const LEAD_PHONE_MEDIA_QUERY = "(max-width: 639.98px)"
export const LEAD_PHONE_DEFAULT_VIEW: LeadView = "lista"

/** Só no navegador; no servidor (sem `window`) é sempre falso. */
export function isLeadPhoneViewport() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(LEAD_PHONE_MEDIA_QUERY).matches
  )
}

/** Última visão escolhida no celular (só a preferência, nenhum dado pessoal). */
const LEAD_PHONE_VIEW_STORAGE_KEY = "leads:visao-celular"

export function readLeadPhoneView(): LeadView | null {
  try {
    const stored = window.localStorage.getItem(LEAD_PHONE_VIEW_STORAGE_KEY)
    return isLeadView(stored) ? stored : null
  } catch {
    // Navegação privada ou armazenamento bloqueado: vale o padrão do celular.
    return null
  }
}

export function rememberLeadPhoneView(view: LeadView) {
  try {
    window.localStorage.setItem(LEAD_PHONE_VIEW_STORAGE_KEY, view)
  } catch {
    // Sem armazenamento, a escolha continua valendo pelo endereço da página.
  }
}

export const CAMPAIGN_MAX_LENGTH = 120

export type LeadListFilters = {
  /** uuid do membro, MINE_FILTER, UNASSIGNED_FILTER ou "" (todos). */
  responsavel: string
  origem: "" | LeadSource
  /** uuid da landing page ou "". */
  pagina: string
  /** utm.campaign exato ou "". */
  campanha: string
  periodo: LeadPeriod
  visao: LeadView
}

export type RawSearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

function isGuid(value: string) {
  return z.guid().safeParse(value).success
}

export function parseLeadListFilters(params: RawSearchParams): LeadListFilters {
  const responsavel = first(params.responsavel)
  const origem = first(params.origem)
  const pagina = first(params.pagina)
  const periodo = first(params.periodo)
  const visao = first(params.visao)

  return {
    responsavel:
      responsavel === UNASSIGNED_FILTER || responsavel === MINE_FILTER || isGuid(responsavel)
        ? responsavel
        : "",
    origem: isLeadSource(origem) ? origem : "",
    pagina: isGuid(pagina) ? pagina : "",
    campanha: first(params.campanha).trim().slice(0, CAMPAIGN_MAX_LENGTH),
    periodo: (LEAD_PERIODS as readonly string[]).includes(periodo)
      ? (periodo as LeadPeriod)
      : "todos",
    visao: visao === "lista" ? "lista" : "quadro",
  }
}

export function hasActiveLeadFilters(filters: LeadListFilters) {
  return Boolean(
    filters.responsavel ||
    filters.origem ||
    filters.pagina ||
    filters.campanha ||
    filters.periodo !== "todos"
  )
}

/** URL do funil com os filtros (valores vazios e padrões são omitidos). */
export function buildLeadListHref(filters: Partial<LeadListFilters>) {
  const params = new URLSearchParams()
  // No celular o quadro não é o padrão: quem escolhe o quadro fica com ele no
  // endereço, e a troca para a lista (padrão do celular) não o desfaz.
  const omitBoardView = !isLeadPhoneViewport()

  for (const [key, value] of Object.entries(filters)) {
    if (
      value === undefined ||
      value === "" ||
      (key === "periodo" && value === "todos") ||
      (key === "visao" && value === "quadro" && omitBoardView)
    ) {
      continue
    }

    params.set(key, String(value))
  }

  const query = params.toString()
  return query ? `${LEADS_PATH}?${query}` : LEADS_PATH
}

/** Início do período (ISO, fuso de Brasília) ou null para "todo o período". */
export function getPeriodStartIso(period: LeadPeriod, now: Date) {
  const todayKey = toDateKey(now)

  switch (period) {
    case "hoje":
      return zonedToIso(todayKey)
    case "7d":
      return zonedToIso(addDays(todayKey, -6))
    case "30d":
      return zonedToIso(addDays(todayKey, -29))
    case "90d":
      return zonedToIso(addDays(todayKey, -89))
    default:
      return null
  }
}
