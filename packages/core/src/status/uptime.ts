/**
 * Página de status — disponibilidade (uptime).
 *
 * O banco guarda por parte e por dia (calendário de São Paulo) quantas
 * medições automáticas houve e quantas estavam "no ar" (operacional ou
 * lentidão). Disponibilidade = no ar ÷ total, em %, com até 2 casas; sem
 * medição, null (a barra fica cinza, nunca vermelha). Espelho de
 * `public.get_public_status`.
 */

import type { PublicStatusComponent, StatusDay } from "./public"

/** Dias mostrados na barra de disponibilidade. */
export const STATUS_HISTORY_DAYS = 90

/** Dias de incidentes resolvidos listados na página. */
export const STATUS_PAST_INCIDENT_DAYS = 14

export const STATUS_TIME_ZONE = "America/Sao_Paulo"

/** Arredonda para até 2 casas (0,005 sobe), sem passar de 0–100. */
export function roundUptimePct(value: number): number {
  const clamped = Math.min(100, Math.max(0, value))
  return Math.round((clamped + Number.EPSILON) * 100) / 100
}

/**
 * Disponibilidade em % a partir das medições boas e do total; null sem
 * medição (ou com números inválidos). Nunca devolve 100 quando houve falha:
 * 99,999% vira 99,99%.
 */
export function uptimePct(good: number, total: number): number | null {
  if (!Number.isFinite(good) || !Number.isFinite(total) || total <= 0 || good < 0) {
    return null
  }

  const safeGood = Math.min(good, total)

  if (safeGood === total) {
    return 100
  }

  // Multiplica antes de dividir: com inteiros, o resultado exato não sofre erro
  // de ponto flutuante antes do corte (igual ao floor(...)/100 do banco).
  return roundUptimePct(Math.floor((safeGood * 10000) / total) / 100)
}

export type DailyUptimeCounts = { good: number; total: number }

/** Disponibilidade de um período (soma dos dias); null se não houve medição. */
export function periodUptimePct(
  days: Iterable<DailyUptimeCounts | null | undefined>
): number | null {
  let good = 0
  let total = 0

  for (const day of days) {
    if (day && Number.isFinite(day.good) && Number.isFinite(day.total) && day.total > 0) {
      good += Math.min(Math.max(day.good, 0), day.total)
      total += day.total
    }
  }

  return uptimePct(good, total)
}

const DAY_KEY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: STATUS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** "AAAA-MM-DD" do instante no calendário de São Paulo; null se inválido. */
export function statusDayKey(value: Date | string | number): string | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : DAY_KEY_FORMAT.format(date)
}

/**
 * Os `count` dias do calendário de São Paulo terminando no dia de `now`, do
 * mais antigo para o mais recente.
 */
export function statusDayKeys(now: Date, count: number = STATUS_HISTORY_DAYS): string[] {
  const today = statusDayKey(now)

  if (!today || count <= 0) {
    return []
  }

  const [year, month, day] = today.split("-").map(Number) as [number, number, number]
  const keys: string[] = []

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    keys.push(new Date(Date.UTC(year, month - 1, day - offset)).toISOString().slice(0, 10))
  }

  return keys
}

/** Resumo de "X de Y dias sem problema" para a legenda da barra. */
export function countDaysWithoutProblems(days: readonly StatusDay[]): number {
  return days.filter(
    (day) => day.worstLevel === "operational" || day.worstLevel === "under_maintenance"
  ).length
}

export type UptimeCoverage = {
  /** Primeiro dia da barra com medição automática (AAAA-MM-DD); null sem medição. */
  measuredSince: string | null
  /** A barra tem os 90 dias e o primeiro deles foi medido. */
  fullWindow: boolean
}

/**
 * De quando é a disponibilidade mostrada: o percentual soma só os dias com
 * medição, então com menos de 90 dias medidos a página diz "desde" em vez de
 * "em 90 dias".
 */
export function uptimeCoverage(days: readonly StatusDay[]): UptimeCoverage {
  const first = days.find((day) => day.uptimePct !== null)

  return {
    measuredSince: first?.date ?? null,
    fullWindow: days.length >= STATUS_HISTORY_DAYS && days[0]?.uptimePct != null,
  }
}

/** Textos sob a barra de disponibilidade quando não há percentual. */
export const UPTIME_CAPTIONS = {
  /** A parte não tem sinal automático ligado: só a equipe acompanha. */
  noAutomaticSignal: "Sem medição automática · acompanhado pela equipe",
  /** Sinal ligado, mas nenhuma medição ainda. */
  waitingFirstMeasurement: "Aguardando a primeira medição",
  /** Retrato antigo, sem a informação do sinal. */
  noMeasurement: "Sem medição nos últimos 90 dias",
} as const

/** "17/09/2026" a partir de "2026-09-17" (o próprio texto se não for data). */
export function formatStatusDayKey(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : dateKey
}

/**
 * Frase sob a barra: "99,95% disponível em 90 dias" com a janela inteira
 * medida; "100% disponível desde 17/09/2026" com menos; sem percentual, diz se
 * falta sinal automático ou se ainda não houve medição. `formatPct` formata o
 * número como a página mostra (ex.: "99,95%").
 */
export function uptimeCaption(
  component: Pick<PublicStatusComponent, "uptime90dPct" | "days" | "automaticSignal">,
  formatPct: (pct: number) => string
): string {
  if (component.uptime90dPct === null) {
    if (component.automaticSignal === false) {
      return UPTIME_CAPTIONS.noAutomaticSignal
    }

    return component.automaticSignal === true
      ? UPTIME_CAPTIONS.waitingFirstMeasurement
      : UPTIME_CAPTIONS.noMeasurement
  }

  const pct = formatPct(component.uptime90dPct)
  const { measuredSince, fullWindow } = uptimeCoverage(component.days)

  if (fullWindow || !measuredSince) {
    return `${pct} disponível em ${STATUS_HISTORY_DAYS} dias`
  }

  return `${pct} disponível desde ${formatStatusDayKey(measuredSince)}`
}
