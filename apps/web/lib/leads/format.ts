import { onlyDigits } from "@workspace/core/br/documents"
import {
  LEAD_SLA_DEFAULT_WARNING_PERCENT,
  leadSlaState,
  slaDeadlineMs,
  slaMinutesLeft,
  toEpochMs,
  type LeadSlaState,
} from "@workspace/core/leads/routing"
import { withWhatsappText } from "@workspace/core/leads/whatsapp-message"

import type { Json } from "@workspace/database/types"

import { formatDate } from "@/lib/format"
import { formatPhoneDisplay } from "@/lib/captacao/masks"
import { LEAD_RESPONSE_TARGET_MINUTES, OPEN_LEAD_STAGES } from "@/lib/leads/constants"
import type { LeadStage } from "@/lib/leads/db-types"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// -----------------------------------------------------------------------------
// Tempo relativo ("há 2 h")
// -----------------------------------------------------------------------------

/** "agora", "há 5 min", "há 2 h", "há 3 d" ou a data (a partir de 30 dias). */
export function formatRelativeShort(iso: string, nowMs: number) {
  const time = Date.parse(iso)

  if (Number.isNaN(time)) return "—"

  const elapsed = Math.max(0, nowMs - time)

  if (elapsed < MINUTE) return "agora"
  if (elapsed < HOUR) return `há ${Math.floor(elapsed / MINUTE)} min`
  if (elapsed < DAY) return `há ${Math.floor(elapsed / HOUR)} h`
  if (elapsed < 30 * DAY) return `há ${Math.floor(elapsed / DAY)} d`

  return `em ${formatDate(iso)}`
}

/** Duração curta para cronômetros: "menos de 1 min", "4 min", "2 h", "3 d". */
export function formatDurationShort(durationMs: number) {
  const elapsed = Math.max(0, durationMs)

  if (elapsed < MINUTE) return "menos de 1 min"
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h`

  return `${Math.floor(elapsed / DAY)} d`
}

/** Tempo decorrido curto para cronômetros: "menos de 1 min", "4 min", "2 h", "3 d". */
export function formatElapsedShort(iso: string, nowMs: number) {
  const time = Date.parse(iso)

  if (Number.isNaN(time)) return "—"

  return formatDurationShort(nowMs - time)
}

/**
 * Lead em aberto ainda sem o primeiro contato (cronômetro rodando). Olha o
 * primeiro contato, que o banco grava uma vez só: registrar um novo contato ou
 * mexer no último não reabre nem encerra o prazo. Mudar a etapa não é contato:
 * o lead arrastado de "Novo" para "Em contato" sem registro continua aqui.
 */
export function isLeadWithoutContact(lead: { stage: LeadStage; firstContactAt: string | null }) {
  return OPEN_LEAD_STAGES.includes(lead.stage) && !lead.firstContactAt
}

// -----------------------------------------------------------------------------
// SLA de primeiro contato (prazo configurável por imobiliária)
// -----------------------------------------------------------------------------

/** Campos de prazo que os selos e avisos leem (subconjunto de `LeadItem`). */
export type LeadSlaFields = {
  stage: LeadStage
  firstContactAt: string | null
  createdAt: string
  assignedAt?: string | null
  firstResponseDueAt?: string | null
}

/** Prazo configurado da imobiliária (`lead_routing_settings`, já com os padrões aplicados). */
export type LeadSlaConfig = {
  slaMinutes: number
  warningPercent: number
}

export const DEFAULT_LEAD_SLA_CONFIG: LeadSlaConfig = {
  slaMinutes: LEAD_RESPONSE_TARGET_MINUTES,
  warningPercent: LEAD_SLA_DEFAULT_WARNING_PERCENT,
}

/** Quando o cronômetro começou: a entrega ao responsável atual ou, sem ela, a entrada. */
function leadSlaStartMs(lead: LeadSlaFields) {
  return toEpochMs(lead.assignedAt ?? null) ?? toEpochMs(lead.createdAt)
}

/**
 * Prazo do primeiro contato em epoch ms. Usa `first_response_due_at` (calculado
 * pelo banco) sempre que existe; sem prazo gravado — lead ainda sem responsável
 * ou na fila do plantão — calcula a partir da entrada, para o cronômetro não
 * sumir de quem está esperando.
 */
export function leadSlaDueAtMs(lead: LeadSlaFields, slaMinutes: number) {
  const dueAt = toEpochMs(lead.firstResponseDueAt ?? null)

  if (dueAt !== null) {
    return dueAt
  }

  const startedAt = leadSlaStartMs(lead)
  return startedAt === null ? null : slaDeadlineMs(startedAt, slaMinutes)
}

export type LeadSlaView = {
  state: LeadSlaState
  dueAtMs: number | null
  /** Minutos que faltam para o prazo (0 depois de estourar). */
  minutesLeft: number
  /** Há quanto tempo estourou, em ms (0 enquanto está dentro do prazo). */
  overdueMs: number
}

const IDLE_SLA_VIEW: LeadSlaView = { state: "idle", dueAtMs: null, minutesLeft: 0, overdueMs: 0 }

/** Estado do prazo do lead para a interface (idle/ok/warning/breached) e os tempos do rótulo. */
export function getLeadSlaView(
  lead: LeadSlaFields,
  nowMs: number,
  config: LeadSlaConfig = DEFAULT_LEAD_SLA_CONFIG
): LeadSlaView {
  if (!isLeadWithoutContact(lead)) {
    return IDLE_SLA_VIEW
  }

  const dueAtMs = leadSlaDueAtMs(lead, config.slaMinutes)
  const state = leadSlaState({
    assignedAtMs: leadSlaStartMs(lead),
    dueAtMs,
    nowMs,
    warningPercent: config.warningPercent,
  })

  return {
    state,
    dueAtMs,
    minutesLeft: slaMinutesLeft(dueAtMs, nowMs),
    overdueMs: dueAtMs === null ? 0 : Math.max(0, nowMs - dueAtMs),
  }
}

/** Lead novo, sem contato registrado e fora do prazo configurado pela imobiliária. */
export function isLeadAwaitingContact(
  lead: LeadSlaFields,
  nowMs: number,
  slaMinutes: number = LEAD_RESPONSE_TARGET_MINUTES
) {
  return (
    getLeadSlaView(lead, nowMs, { ...DEFAULT_LEAD_SLA_CONFIG, slaMinutes }).state === "breached"
  )
}

// -----------------------------------------------------------------------------
// Contato
// -----------------------------------------------------------------------------

/** Dígitos do telefone brasileiro, sem o 55 do país quando vier junto. */
export function leadPhoneDigits(value: string | null | undefined) {
  let digits = onlyDigits(value ?? "")

  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2)
  }

  return digits
}

export function formatLeadPhone(value: string | null | undefined) {
  const digits = leadPhoneDigits(value)
  return digits ? (formatPhoneDisplay(digits) ?? digits) : null
}

/** Telefone mascarado para listas (LGPD): "(11) *****-4321". */
export function maskLeadPhone(value: string | null | undefined) {
  const digits = leadPhoneDigits(value)

  if (digits.length < 10) {
    return digits ? "***" : null
  }

  const hidden = "*".repeat(digits.length - 6)
  return `(${digits.slice(0, 2)}) ${hidden}-${digits.slice(-4)}`
}

/**
 * Conversa no WhatsApp em um clique (wa.me), opcionalmente com a mensagem já
 * escrita. O telefone só vai no link que o próprio usuário abre — nunca em log.
 */
export function leadWhatsappHref(value: string | null | undefined, message?: string | null) {
  const digits = leadPhoneDigits(value)

  if (digits.length !== 10 && digits.length !== 11) {
    return null
  }

  return withWhatsappText(`https://wa.me/55${digits}`, message)
}

export function leadTelHref(value: string | null | undefined) {
  const digits = leadPhoneDigits(value)
  return digits.length === 10 || digits.length === 11 ? `tel:+55${digits}` : null
}

export function leadMailtoHref(email: string | null | undefined, subject?: string) {
  if (!email) return null

  const address = encodeURIComponent(email.trim())
  return subject ? `mailto:${address}?subject=${encodeURIComponent(subject)}` : `mailto:${address}`
}

/** Celular brasileiro (11 dígitos com 9 após o DDD): provável WhatsApp. */
export function isMobilePhone(value: string | null | undefined) {
  const digits = leadPhoneDigits(value)
  return digits.length === 11 && digits[2] === "9"
}

// -----------------------------------------------------------------------------
// UTM
// -----------------------------------------------------------------------------

export const UTM_KEYS = ["source", "medium", "campaign", "content", "term"] as const

export type UtmKey = (typeof UTM_KEYS)[number]
export type LeadUtm = Partial<Record<UtmKey, string>>

export const UTM_LABELS: Record<UtmKey, string> = {
  source: "Fonte (utm_source)",
  medium: "Mídia (utm_medium)",
  campaign: "Campanha (utm_campaign)",
  content: "Conteúdo (utm_content)",
  term: "Termo (utm_term)",
}

// -----------------------------------------------------------------------------
// Possível duplicado (chaves de comparação)
// -----------------------------------------------------------------------------

/** Só dígitos, sem o 55 do país, últimos 11; null se não parece telefone. */
export function duplicatePhoneKey(value: string | null | undefined) {
  const digits = leadPhoneDigits(value).slice(-11)
  return digits.length >= 10 ? digits : null
}

/** E-mail minúsculo e sem espaços; null se vazio. */
export function duplicateEmailKey(value: string | null | undefined) {
  const email = (value ?? "").replace(/\s+/g, "").toLowerCase()
  return email.includes("@") ? email : null
}

// -----------------------------------------------------------------------------
// Anúncios (click ids)
// -----------------------------------------------------------------------------

export const CLICK_ID_KEYS = ["gclid", "gbraid", "wbraid", "fbclid", "fbc", "fbp"] as const

export type ClickIdKey = (typeof CLICK_ID_KEYS)[number]
export type LeadClickIds = Partial<Record<ClickIdKey, string>>

export type LeadAdPlatform = "google_ads" | "meta_ads"

export const LEAD_AD_PLATFORM_LABELS: Record<LeadAdPlatform, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
}

/** Parâmetros de URL que carregam identificadores de clique de anúncio. */
const CLICK_ID_URL_PARAMS = ["gclid", "gbraid", "wbraid", "fbclid", "msclkid", "dclid"] as const

/** Lê `leads.click_ids` (jsonb) aceitando só strings não vazias. */
export function readLeadClickIds(value: Json | null | undefined): LeadClickIds {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  const clickIds: LeadClickIds = {}

  for (const key of CLICK_ID_KEYS) {
    const raw = value[key]

    if (typeof raw === "string" && raw.trim()) {
      clickIds[key] = raw.trim().slice(0, 500)
    }
  }

  return clickIds
}

/** Click ids presentes na query string da URL de entrada (quando `click_ids` não veio). */
export function readClickIdsFromUrl(url: string | null | undefined): LeadClickIds {
  if (!url) return {}

  try {
    const params = new URL(url).searchParams
    const clickIds: LeadClickIds = {}

    for (const key of ["gclid", "gbraid", "wbraid", "fbclid"] as const) {
      const raw = params.get(key)
      if (raw) clickIds[key] = raw.slice(0, 500)
    }

    return clickIds
  } catch {
    return {}
  }
}

/** Google Ads pela presença de gclid/gbraid/wbraid; Meta Ads por fbclid/fbc. */
export function detectAdPlatforms(clickIds: LeadClickIds): LeadAdPlatform[] {
  const platforms: LeadAdPlatform[] = []

  if (clickIds.gclid || clickIds.gbraid || clickIds.wbraid) platforms.push("google_ads")
  if (clickIds.fbclid || clickIds.fbc) platforms.push("meta_ads")

  return platforms
}

/** Remove da URL os parâmetros de click id (para quem não pode ver os ids crus). */
export function stripClickIdParams(url: string | null | undefined) {
  if (!url) return null

  try {
    const parsed = new URL(url)

    for (const key of CLICK_ID_URL_PARAMS) {
      parsed.searchParams.delete(key)
    }

    return parsed.toString()
  } catch {
    return null
  }
}

/** URL http(s) segura para virar link; senão null. */
export function safeHttpUrl(url: string | null | undefined) {
  if (!url) return null

  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null
  } catch {
    return null
  }
}

/** Lê `leads.utm` (jsonb) aceitando só strings não vazias. */
export function readLeadUtm(value: Json | null | undefined): LeadUtm {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  const utm: LeadUtm = {}

  for (const key of UTM_KEYS) {
    const raw = value[key] ?? value[`utm_${key}`]

    if (typeof raw === "string" && raw.trim()) {
      utm[key] = raw.trim().slice(0, 200)
    }
  }

  return utm
}
