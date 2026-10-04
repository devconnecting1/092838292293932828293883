// Convite de calendário (.ics) no formato iCalendar da RFC 5545
// (https://www.rfc-editor.org/rfc/rfc5545). Abre no Google Agenda, no Outlook
// e no Calendário da Apple. Módulo puro: quem chama decide origem e dados.
//
// Pontos da especificação seguidos aqui:
// - §3.1: linhas terminadas em CRLF e dobradas em até 75 octetos, com a
//   continuação começando por um espaço;
// - §3.3.5: DATE-TIME em UTC ("19980119T070000Z");
// - §3.3.11: TEXT escapa "\" ";" "," e quebra de linha ("\n");
// - §3.6 e §3.7.3/§3.7.4: VCALENDAR com PRODID e VERSION:2.0;
// - §3.6.1: VEVENT com UID e DTSTAMP (obrigatórios) e DTSTART (obrigatório sem
//   METHOD); DTEND e DURATION não aparecem juntos;
// - §3.6.6: VALARM com ACTION:DISPLAY exige DESCRIPTION e TRIGGER;
// - §3.8.4.7: UID globalmente único, com o domínio à direita do "@";
// - §8.1: tipo de mídia text/calendar e extensão .ics.

import {
  CALENDAR_ALARM_MINUTES_BEFORE,
  DEFAULT_VISIT_DURATION_MINUTES,
  toSaoPauloDateKey,
} from "./reminders"
import { cleanText, isUuid, normalizeEmailOrigin } from "./sanitize"

export const ICS_CONTENT_TYPE = "text/calendar; charset=utf-8"

export const ICS_PRODUCT_ID = "-//CRM Imobiliario//Agenda de visitas//PT-BR"

/** Limite de octetos por linha antes da dobra (RFC 5545 §3.1). */
const MAX_LINE_OCTETS = 75

const CRLF = "\r\n"

export type CalendarEventStatus = "CONFIRMED" | "TENTATIVE" | "CANCELLED"

export type CalendarEventInput = {
  /** Identificador estável (ex.: id da visita): reimportar atualiza em vez de duplicar. */
  uid: string
  /** Domínio à direita do "@" no UID (ex.: host do CRM). */
  domain: string
  startsAt: Date | string
  endsAt?: Date | string | null
  /** Sem término: início + esta duração (padrão 60 min). */
  defaultDurationMinutes?: number
  summary: string
  location?: string | null
  description?: string | null
  /** Link de volta para o CRM (https). */
  url?: string | null
  status?: CalendarEventStatus
  /** Minutos antes do início para o alarme; null/0 = sem alarme. */
  alarmMinutesBefore?: number | null
  /** DTSTAMP (momento em que o arquivo foi gerado). */
  now?: Date
}

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null
  }

  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** DATE-TIME em UTC: "20260916T173000Z" (RFC 5545 §3.3.5, forma 2). */
export function formatIcsDateTime(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
}

/**
 * Valor TEXT (RFC 5545 §3.3.11): limpa caracteres de controle e escapa barra
 * invertida, ponto e vírgula, vírgula e quebra de linha.
 */
export function escapeIcsText(value: unknown, maxLength = 2000): string {
  return cleanText(value, { multiline: true, maxLength })
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
}

function utf8Length(value: string) {
  return new TextEncoder().encode(value).length
}

/**
 * Dobra uma linha de conteúdo em pedaços de até 75 octetos (RFC 5545 §3.1),
 * sem partir caracteres multibyte; cada continuação começa com um espaço.
 */
export function foldIcsLine(line: string): string {
  if (utf8Length(line) <= MAX_LINE_OCTETS) {
    return line
  }

  const parts: string[] = []
  let current = ""
  let currentOctets = 0
  // A continuação já gasta 1 octeto com o espaço inicial.
  let limit = MAX_LINE_OCTETS

  for (const char of line) {
    const octets = utf8Length(char)

    if (currentOctets + octets > limit) {
      parts.push(current)
      current = ""
      currentOctets = 0
      limit = MAX_LINE_OCTETS - 1
    }

    current += char
    currentOctets += octets
  }

  parts.push(current)

  return parts.join(`${CRLF} `)
}

function sanitizeUidPart(value: string, pattern: RegExp, fallback: string) {
  const cleaned = value.toLowerCase().replace(pattern, "").slice(0, 120)
  return cleaned || fallback
}

function safeUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null
  }

  try {
    const url = new URL(value.trim())

    if (url.username || url.password) {
      return null
    }

    const loopback = url.hostname === "localhost" || url.hostname.endsWith(".localhost")

    return url.protocol === "https:" || (url.protocol === "http:" && loopback) ? url.href : null
  } catch {
    return null
  }
}

/**
 * Monta o arquivo .ics de um evento (VCALENDAR com um VEVENT e, opcionalmente,
 * um VALARM). Devolve null se o início for inválido. Linhas em CRLF, dobradas.
 */
export function buildCalendarEvent(input: CalendarEventInput): string | null {
  const startsAt = toValidDate(input.startsAt)

  if (!startsAt) {
    return null
  }

  const duration =
    typeof input.defaultDurationMinutes === "number" && input.defaultDurationMinutes > 0
      ? Math.floor(input.defaultDurationMinutes)
      : 60
  const endCandidate = toValidDate(input.endsAt)
  const endsAt =
    endCandidate && endCandidate.getTime() > startsAt.getTime()
      ? endCandidate
      : new Date(startsAt.getTime() + duration * 60_000)
  const now = input.now && !Number.isNaN(input.now.getTime()) ? input.now : new Date()
  const uid = `${sanitizeUidPart(input.uid, /[^a-z0-9-]/g, "evento")}@${sanitizeUidPart(input.domain, /[^a-z0-9.-]/g, "crm-imobiliario")}`
  const summary = escapeIcsText(input.summary, 200) || "Visita"
  const location = escapeIcsText(input.location, 300)
  const description = escapeIcsText(input.description, 2000)
  const url = safeUrl(input.url)
  const alarm =
    typeof input.alarmMinutesBefore === "number" && input.alarmMinutesBefore > 0
      ? Math.min(Math.floor(input.alarmMinutesBefore), 7 * 24 * 60)
      : null

  const lines = [
    "BEGIN:VCALENDAR",
    `PRODID:${ICS_PRODUCT_ID}`,
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDateTime(now)}`,
    `DTSTART:${formatIcsDateTime(startsAt)}`,
    `DTEND:${formatIcsDateTime(endsAt)}`,
    `SUMMARY:${summary}`,
    location ? `LOCATION:${location}` : null,
    description ? `DESCRIPTION:${description}` : null,
    url ? `URL:${url}` : null,
    `STATUS:${input.status ?? "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    ...(alarm
      ? [
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          `DESCRIPTION:${summary}`,
          `TRIGGER:-PT${alarm}M`,
          "END:VALARM",
        ]
      : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => Boolean(line))

  return lines.map(foldIcsLine).join(CRLF) + CRLF
}

/** Nome de arquivo seguro: "visita-imv-000123.ics". */
export function calendarFileName(base: string): string {
  const slug = cleanText(base, { maxLength: 60 })
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return `${slug || "visita"}.ics`
}

// Visita -----------------------------------------------------------------------

export type VisitCalendarParams = {
  /** Origem da imobiliária: vira o domínio do UID e o link de volta. */
  origin: string
  visitId: string
  startsAt: string
  endsAt?: string | null
  /** appointment_status: "canceled" vira STATUS:CANCELLED. */
  status?: string | null
  propertyCode?: string | null
  propertyTitle?: string | null
  /** Já no modo de exibição do imóvel (formatDisplayAddress). */
  address?: string | null
  meetingPoint?: string | null
  now?: Date
}

export type VisitCalendarFile = { content: string; fileName: string }

/**
 * Convite .ics de uma visita. Sem dados do cliente (o arquivo sai do CRM para o
 * calendário da pessoa): imóvel, endereço no modo de exibição, ponto de
 * encontro e o link da agenda. Null se a origem, o id ou o início forem inválidos.
 */
export function buildVisitCalendar(params: VisitCalendarParams): VisitCalendarFile | null {
  const origin = normalizeEmailOrigin(params.origin)
  const dayKey = toSaoPauloDateKey(params.startsAt)

  if (!origin || !isUuid(params.visitId) || !dayKey) {
    return null
  }

  const code = cleanText(params.propertyCode, { maxLength: 30 })
  const title = cleanText(params.propertyTitle, { maxLength: 100 })
  const property = code && title ? `${code} · ${title}` : code || title
  const meeting = cleanText(params.meetingPoint, { maxLength: 300 })
  const agendaUrl = `${origin}/agenda?dia=${dayKey}`
  const content = buildCalendarEvent({
    uid: `visita-${params.visitId}`,
    domain: new URL(origin).hostname,
    startsAt: params.startsAt,
    endsAt: params.endsAt,
    defaultDurationMinutes: DEFAULT_VISIT_DURATION_MINUTES,
    summary: property ? `Visita: ${property}` : "Visita a imóvel",
    location: params.address ?? null,
    description: [meeting ? `Ponto de encontro: ${meeting}` : null, `Abrir no CRM: ${agendaUrl}`]
      .filter(Boolean)
      .join("\n"),
    url: agendaUrl,
    status: params.status === "canceled" ? "CANCELLED" : "CONFIRMED",
    alarmMinutesBefore: CALENDAR_ALARM_MINUTES_BEFORE,
    now: params.now,
  })

  return content
    ? { content, fileName: calendarFileName(code ? `visita ${code}` : "visita") }
    : null
}
