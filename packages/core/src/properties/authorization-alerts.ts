/**
 * Autorização de venda/locação vencendo: regras puras usadas na lista de
 * imóveis, no Painel e nos avisos por e-mail. Espelha o banco
 * (private.listing_authorization_state e private.authorization_alert_milestone,
 * migração 20260916230047_authorization_expiry_alerts): mudou aqui, muda lá.
 *
 * Datas são sempre "AAAA-MM-DD" no fuso de São Paulo.
 */

import type { PropertyStatus } from "./enums"

/** "Vencendo" = a cobertura acaba em até 30 dias (hoje inclusive). */
export const AUTHORIZATION_EXPIRING_WINDOW_DAYS = 30

/** Marcos dos avisos por e-mail, do mais distante ao mais próximo. */
export const AUTHORIZATION_ALERT_MILESTONES = [30, 15, 7, 1] as const

export type AuthorizationAlertMilestone = (typeof AUTHORIZATION_ALERT_MILESTONES)[number]

/**
 * none: nenhuma autorização; active: vigente; expiring: vigente e acaba na
 * janela; expired: todas vencidas; upcoming: só autorização que ainda vai começar.
 */
export type AuthorizationState = "none" | "active" | "expiring" | "expired" | "upcoming"

/** Status em que a autorização importa (imóvel em carteira). */
export const AUTHORIZATION_TRACKED_STATUSES: readonly PropertyStatus[] = [
  "draft",
  "active",
  "reserved",
]

export function isAuthorizationTrackedStatus(status: PropertyStatus): boolean {
  return AUTHORIZATION_TRACKED_STATUSES.includes(status)
}

/**
 * Filtro da lista de imóveis: valor da URL (pt-BR) → valor da RPC.
 * `not_valid` = sem autorização vigente (none, expired ou upcoming), espelho de
 * private.authorization_filter_states (migração listing_publication_rules).
 */
export const AUTHORIZATION_LIST_FILTERS = {
  vencendo: "expiring",
  vencida: "expired",
  sem: "not_valid",
} as const satisfies Record<string, AuthorizationState | "not_valid">

export type AuthorizationListFilter = keyof typeof AUTHORIZATION_LIST_FILTERS

export const AUTHORIZATION_LIST_FILTER_LABELS: Record<AuthorizationListFilter, string> = {
  vencendo: `Vencendo em ${AUTHORIZATION_EXPIRING_WINDOW_DAYS} dias`,
  vencida: "Vencida",
  sem: "Sem autorização vigente",
}

export function isAuthorizationListFilter(value: unknown): value is AuthorizationListFilter {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(AUTHORIZATION_LIST_FILTERS, value)
  )
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 24 * 60 * 60 * 1000

function toUtcDay(value: string): number | null {
  const match = DATE_ONLY.exec(value)

  if (!match) {
    return null
  }

  const [, year, month, day] = match
  const time = Date.UTC(Number(year), Number(month) - 1, Number(day))
  const check = new Date(time)

  // Recusa datas que o Date "conserta" (ex.: 2026-02-31 viraria 3 de março).
  return check.getUTCMonth() === Number(month) - 1 && check.getUTCDate() === Number(day)
    ? time
    : null
}

/** Dias corridos de `from` até `to` (negativo se `to` já passou); null se alguma data for inválida. */
export function daysBetweenDates(from: string, to: string): number | null {
  const start = toUtcDay(from)
  const end = toUtcDay(to)

  return start === null || end === null ? null : Math.round((end - start) / DAY_MS)
}

/**
 * Marco do aviso para os dias que faltam: o menor de 30, 15, 7 e 1 que ainda
 * cobre o prazo. Um dia sem cron não perde o marco e nenhum marco se repete.
 */
export function authorizationAlertMilestone(
  daysLeft: number | null | undefined
): AuthorizationAlertMilestone | null {
  if (typeof daysLeft !== "number" || !Number.isFinite(daysLeft) || daysLeft < 0) {
    return null
  }

  const days = Math.floor(daysLeft)
  const ascending = [...AUTHORIZATION_ALERT_MILESTONES].sort((a, b) => a - b)

  return ascending.find((milestone) => days <= milestone) ?? null
}

export type AuthorizationPeriodInput = {
  starts_on: string
  ends_on: string | null
  exclusive?: boolean | null
}

export type AuthorizationSummary = {
  state: AuthorizationState
  /** Último dia coberto (null = sem prazo final ou sem autorização). */
  endsOn: string | null
  /** Dias de hoje até endsOn (null sem data final). */
  daysLeft: number | null
}

/** Situação da autorização do imóvel na data (mesma regra do banco). */
export function summarizeAuthorizations(
  authorizations: readonly AuthorizationPeriodInput[],
  today: string
): AuthorizationSummary {
  if (authorizations.length === 0) {
    return { state: "none", endsOn: null, daysLeft: null }
  }

  const openEnded = authorizations.some((item) => item.ends_on == null)
  const endsOn = openEnded
    ? null
    : authorizations.reduce<string | null>(
        (latest, item) =>
          item.ends_on && (!latest || item.ends_on > latest) ? item.ends_on : latest,
        null
      )
  const daysLeft = endsOn ? daysBetweenDates(today, endsOn) : null
  const activeToday = authorizations.some(
    (item) => item.starts_on <= today && (item.ends_on == null || item.ends_on >= today)
  )

  let state: AuthorizationState

  if (activeToday) {
    state =
      openEnded || daysLeft === null || daysLeft > AUTHORIZATION_EXPIRING_WINDOW_DAYS
        ? "active"
        : "expiring"
  } else if (authorizations.some((item) => item.starts_on > today)) {
    state = "upcoming"
  } else {
    state = "expired"
  }

  return { state, endsOn, daysLeft }
}

/** "vence hoje", "vence amanhã", "vence em 12 dias", "venceu há 3 dias". */
export function describeAuthorizationDeadline(daysLeft: number): string {
  const days = Math.trunc(daysLeft)

  if (days === 0) return "vence hoje"
  if (days === 1) return "vence amanhã"
  if (days > 1) return `vence em ${days} dias`
  if (days === -1) return "venceu ontem"

  return `venceu há ${Math.abs(days)} dias`
}
