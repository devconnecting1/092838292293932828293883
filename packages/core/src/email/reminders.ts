// Regras puras dos lembretes (resumo diário, lembrete de visita, relatório
// semanal e tarefa de retorno): dias úteis, endereço conforme o modo de exibição
// do imóvel e datas no calendário de Brasília. Sem ambiente e sem rede.

import { cleanText, EMAIL_TIME_ZONE } from "./sanitize"

/** Lead em aberto sem contato há mais do que isto entra no resumo diário. */
export const DAILY_DIGEST_STALE_LEAD_DAYS = 3

/** Itens por seção do resumo (o banco devolve até 10; o total vem à parte). */
export const DAILY_DIGEST_SECTION_LIMIT = 10

/** O lembrete de visita sai até 2 horas antes do início. */
export const VISIT_REMINDER_MINUTES_BEFORE = 120

/** Alarme do convite de calendário (.ics). */
export const CALENDAR_ALARM_MINUTES_BEFORE = 60

/** Visita sem horário de término no convite: 1 hora. */
export const DEFAULT_VISIT_DURATION_MINUTES = 60

// Datas ------------------------------------------------------------------------

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function parseDateKey(value: string) {
  const match = DATE_KEY_PATTERN.exec(value)

  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return date
}

export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && parseDateKey(value) !== null
}

/** "AAAA-MM-DD" do instante no calendário de Brasília. */
export function toSaoPauloDateKey(value: Date | string | number): string | null {
  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: EMAIL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

/** "14:30" no relógio de Brasília; null se a data for inválida. */
export function formatSaoPauloTime(
  value: Date | string | number | null | undefined
): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: EMAIL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date)
}

export function addDaysToDateKey(dateKey: string, amount: number): string {
  const date = parseDateKey(dateKey)

  if (!date || !Number.isInteger(amount)) {
    return dateKey
  }

  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

/** "16/09" (curto) ou "quarta-feira, 16 de setembro" (longo) para uma data sem hora. */
export function formatDateKey(dateKey: string, style: "short" | "long" = "short"): string | null {
  const date = parseDateKey(dateKey)

  if (!date) {
    return null
  }

  date.setUTCHours(12)

  return new Intl.DateTimeFormat(
    "pt-BR",
    style === "long"
      ? { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }
      : { timeZone: "UTC", day: "2-digit", month: "2-digit" }
  ).format(date)
}

// Dias úteis -------------------------------------------------------------------

/**
 * Feriados nacionais de data fixa (MM-DD):
 * - Lei 662/1949, art. 1º, na redação da Lei 10.607/2002: 1º/1, 21/4, 1º/5,
 *   7/9, 2/11, 15/11 e 25/12;
 * - Lei 6.802/1980: 12/10 (Nossa Senhora Aparecida);
 * - Lei 14.759/2023: 20/11 (Dia Nacional de Zumbi e da Consciência Negra).
 * Carnaval, Sexta-feira Santa e Corpus Christi não são feriados nacionais por
 * lei federal (dependem de decreto local ou são ponto facultativo) e ficam de
 * fora: o prazo sugerido é só uma sugestão, a pessoa ajusta na tarefa.
 */
export const NATIONAL_HOLIDAYS = [
  "01-01",
  "04-21",
  "05-01",
  "09-07",
  "10-12",
  "11-02",
  "11-15",
  "11-20",
  "12-25",
] as const

const HOLIDAY_SET: ReadonlySet<string> = new Set(NATIONAL_HOLIDAYS)

/** Segunda a sexta que não é feriado nacional de data fixa. */
export function isBusinessDay(dateKey: string): boolean {
  const date = parseDateKey(dateKey)

  if (!date) {
    return false
  }

  const weekday = date.getUTCDay()

  return weekday !== 0 && weekday !== 6 && !HOLIDAY_SET.has(dateKey.slice(5))
}

/** Primeiro dia útil DEPOIS da data (sábado, domingo e feriado nacional pulam). */
export function nextBusinessDay(dateKey: string): string {
  if (!parseDateKey(dateKey)) {
    return dateKey
  }

  let candidate = addDaysToDateKey(dateKey, 1)

  // Nenhuma sequência de fim de semana + feriados passa de 4 dias; 10 é folga.
  for (let guard = 0; guard < 10 && !isBusinessDay(candidate); guard += 1) {
    candidate = addDaysToDateKey(candidate, 1)
  }

  return candidate
}

// Endereço ---------------------------------------------------------------------

export type AddressDisplayMode = "full" | "street" | "neighborhood"

export type DisplayAddressInput = {
  addressDisplay: AddressDisplayMode | string | null | undefined
  street?: string | null
  streetNumber?: string | null
  neighborhood?: string | null
  city?: string | null
  state?: string | null
}

function part(value: string | null | undefined, maxLength = 120) {
  return cleanText(value, { maxLength }) || null
}

/**
 * Endereço respeitando o modo de exibição do imóvel (o mesmo da ficha e dos
 * portais): "full" = rua, número e bairro; "street" = rua sem número;
 * "neighborhood" (ou modo desconhecido) = só bairro e cidade.
 * Ex.: "Rua das Flores, 123 — Centro, São Paulo/SP".
 */
export function formatDisplayAddress(input: DisplayAddressInput): string | null {
  const mode = input.addressDisplay
  const street =
    mode === "full"
      ? [part(input.street), part(input.streetNumber, 20)].filter(Boolean).join(", ")
      : mode === "street"
        ? part(input.street)
        : null
  const cityState = [part(input.city, 80), part(input.state, 2)?.toUpperCase()]
    .filter(Boolean)
    .join("/")
  const place = [part(input.neighborhood, 80), cityState].filter(Boolean).join(", ")

  return [street, place].filter(Boolean).join(" — ") || null
}

// Convite de calendário ----------------------------------------------------------

export const VISIT_CALENDAR_PATH_PREFIX = "/agenda/visitas"

/** Caminho do convite .ics da visita, gerado sob demanda (exige sessão). */
export function visitCalendarPath(appointmentId: string) {
  return `${VISIT_CALENDAR_PATH_PREFIX}/${encodeURIComponent(appointmentId.toLowerCase())}/convite`
}

// Tarefa de retorno ------------------------------------------------------------

export const FOLLOW_UP_TITLE_MAX_LENGTH = 200

/** "Retorno da visita: Maria (IMV-000123)" — cabe no limite de título da tarefa. */
export function visitFollowUpTitle({
  clientName,
  propertyCode,
}: {
  clientName?: string | null
  propertyCode?: string | null
}): string {
  const client = cleanText(clientName, { maxLength: 80 })
  const code = cleanText(propertyCode, { maxLength: 30 })
  const subject = client && code ? `${client} (${code})` : client || code

  return cleanText(subject ? `Retorno da visita: ${subject}` : "Retorno da visita", {
    maxLength: FOLLOW_UP_TITLE_MAX_LENGTH,
  })
}
