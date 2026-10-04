// Leitura do corpo do webhook da Meta.
//
// Premissa do módulo: o corpo é DADO HOSTIL. Ele chega por uma rota pública,
// sem sessão, e qualquer pessoa na internet pode postar nela. Nada aqui confia
// em formato: todo campo é conferido, todo texto é truncado, todo array tem
// teto, e o que não bate é descartado em silêncio em vez de derrubar a rota.
//
// A verificação da assinatura acontece ANTES de chamar qualquer coisa deste
// arquivo (ver apps/web/app/api/webhooks/whatsapp/route.ts). Aqui só se lê.
//
// Referências oficiais (conferidas em 16/09/2026):
//   developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages
//   .../webhooks/reference/messages/status
//   .../webhooks/reference/user_preferences
//   .../webhooks/reference/phone_number_quality_update

import {
  isWhatsappPricingCategory,
  isWhatsappUserPreferenceValue,
  WHATSAPP_MARKETING_CATEGORY,
  WHATSAPP_TEXT_MAX_LENGTH,
  type WhatsappPricingCategory,
  type WhatsappUserPreferenceValue,
} from "./protocol"

/** Tetos defensivos. Corpo maior que isto é recusado antes de virar trabalho. */
export const WHATSAPP_WEBHOOK_MAX_ENTRIES = 50
export const WHATSAPP_WEBHOOK_MAX_ITEMS_PER_CHANGE = 200
export const WHATSAPP_WEBHOOK_MAX_EVENTS = 500

/** Prefixo obrigatório do cabeçalho de assinatura da Meta. */
const SIGNATURE_PREFIX = "sha256="

/**
 * `X-Hub-Signature-256: sha256={hex}` → o hex, em minúsculas.
 * Devolve null para qualquer coisa que não seja exatamente isso: sem prefixo,
 * com espaço, com tamanho errado ou com caractere fora de [0-9a-f].
 */
export function parseHubSignature(header: string | null | undefined): string | null {
  if (typeof header !== "string" || !header.startsWith(SIGNATURE_PREFIX)) {
    return null
  }

  const digest = header.slice(SIGNATURE_PREFIX.length).toLowerCase()

  return /^[0-9a-f]{64}$/.test(digest) ? digest : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readArray(value: unknown, max: number): readonly unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : []
}

function readText(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()

  return trimmed.length > 0 ? trimmed.slice(0, max) : null
}

/** Identificador numérico da Meta (waba_id, phone_number_id, wa_id). */
function readNumericId(value: unknown, max = 30): string | null {
  const text = readText(value, max)

  return text !== null && /^[0-9]+$/.test(text) ? text : null
}

/**
 * Carimbo de tempo da Meta. Vem em SEGUNDOS, e como string nos `statuses` e
 * como número em `user_preferences`. Fora de uma janela sã (2020 a 2100) é
 * descartado: relógio errado no payload não pode escrever data no nosso banco.
 */
export function readWhatsappTimestamp(value: unknown): string | null {
  const seconds =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[0-9]{1,15}$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN

  if (!Number.isFinite(seconds) || seconds < 1_577_836_800 || seconds > 4_102_444_800) {
    return null
  }

  return new Date(seconds * 1000).toISOString()
}

export type WhatsappInboundMessageEvent = {
  kind: "message"
  wabaId: string
  phoneNumberId: string
  displayPhoneNumber: string | null
  wamid: string
  contactWaId: string
  contactName: string | null
  body: string | null
  /** Tipo cru da Meta (text, image, audio, button, interactive…). */
  messageType: string | null
  sentAt: string | null
}

export type WhatsappStatusEvent = {
  kind: "status"
  wabaId: string
  phoneNumberId: string
  wamid: string
  status: string
  recipientWaId: string | null
  errorCode: number | null
  errorTitle: string | null
  pricingCategory: WhatsappPricingCategory | null
  pricingType: string | null
  at: string | null
}

export type WhatsappUserPreferenceEvent = {
  kind: "user_preference"
  wabaId: string
  phoneNumberId: string
  contactWaId: string
  value: WhatsappUserPreferenceValue
  detail: string | null
  at: string | null
}

export type WhatsappQualityEvent = {
  kind: "quality"
  wabaId: string
  /** Este webhook identifica o número pelo NÚMERO EXIBIDO, não pelo id. */
  displayPhoneNumber: string | null
  phoneNumberId: string | null
  event: string | null
  currentLimit: string | null
}

export type WhatsappWebhookEvent =
  | WhatsappInboundMessageEvent
  | WhatsappStatusEvent
  | WhatsappUserPreferenceEvent
  | WhatsappQualityEvent

export type WhatsappWebhookReadResult = {
  events: WhatsappWebhookEvent[]
  /** Quantas entradas foram descartadas por não baterem com o formato. */
  discarded: number
}

const PRICING_TYPES = new Set(["regular", "free_customer_service", "free_entry_point"])

function readMessageBody(message: Record<string, unknown>): string | null {
  const type = readText(message.type, 40)

  if (type === "text" && isRecord(message.text)) {
    return readText(message.text.body, WHATSAPP_TEXT_MAX_LENGTH)
  }

  if (type === "button" && isRecord(message.button)) {
    return readText(message.button.text, WHATSAPP_TEXT_MAX_LENGTH)
  }

  if (type === "interactive" && isRecord(message.interactive)) {
    const interactive = message.interactive
    for (const key of ["button_reply", "list_reply"] as const) {
      const reply = interactive[key]
      if (isRecord(reply)) {
        return readText(reply.title, WHATSAPP_TEXT_MAX_LENGTH)
      }
    }
  }

  // Mídia e tipos que não carregam texto: a legenda, quando houver.
  for (const key of ["image", "video", "document", "audio", "sticker"] as const) {
    const media = message[key]
    if (isRecord(media)) {
      return readText(media.caption, WHATSAPP_TEXT_MAX_LENGTH)
    }
  }

  return null
}

function readMessages(
  wabaId: string,
  value: Record<string, unknown>,
  push: (event: WhatsappWebhookEvent) => void,
  fail: () => void
) {
  const metadata = isRecord(value.metadata) ? value.metadata : {}
  const phoneNumberId = readNumericId(metadata.phone_number_id)
  const displayPhoneNumber = readText(metadata.display_phone_number, 30)

  if (!phoneNumberId) {
    fail()
    return
  }

  const names = new Map<string, string>()
  for (const raw of readArray(value.contacts, WHATSAPP_WEBHOOK_MAX_ITEMS_PER_CHANGE)) {
    if (!isRecord(raw)) continue
    const waId = readNumericId(raw.wa_id, 20)
    const profile = isRecord(raw.profile) ? readText(raw.profile.name, 200) : null
    if (waId && profile) {
      names.set(waId, profile)
    }
  }

  for (const raw of readArray(value.messages, WHATSAPP_WEBHOOK_MAX_ITEMS_PER_CHANGE)) {
    if (!isRecord(raw)) {
      fail()
      continue
    }

    const wamid = readText(raw.id, 200)
    const contactWaId = readNumericId(raw.from, 20)

    if (!wamid || !contactWaId) {
      fail()
      continue
    }

    push({
      kind: "message",
      wabaId,
      phoneNumberId,
      displayPhoneNumber,
      wamid,
      contactWaId,
      contactName: names.get(contactWaId) ?? null,
      body: readMessageBody(raw),
      messageType: readText(raw.type, 40),
      sentAt: readWhatsappTimestamp(raw.timestamp),
    })
  }

  for (const raw of readArray(value.statuses, WHATSAPP_WEBHOOK_MAX_ITEMS_PER_CHANGE)) {
    if (!isRecord(raw)) {
      fail()
      continue
    }

    const wamid = readText(raw.id, 200)
    const status = readText(raw.status, 40)

    if (!wamid || !status) {
      fail()
      continue
    }

    // A Meta manda um array de erros; o primeiro é o que descreve a falha.
    const firstError = readArray(raw.errors, 10).find(isRecord)
    const errorCode =
      firstError && typeof firstError.code === "number" && Number.isFinite(firstError.code)
        ? Math.trunc(firstError.code)
        : null
    const errorTitle = firstError ? readText(firstError.title, 300) : null

    const pricing = isRecord(raw.pricing) ? raw.pricing : null
    const pricingCategory =
      pricing && isWhatsappPricingCategory(pricing.category) ? pricing.category : null
    const pricingTypeRaw = pricing ? readText(pricing.type, 40) : null
    const pricingType = pricingTypeRaw && PRICING_TYPES.has(pricingTypeRaw) ? pricingTypeRaw : null

    push({
      kind: "status",
      wabaId,
      phoneNumberId,
      wamid,
      status,
      recipientWaId: readNumericId(raw.recipient_id, 20),
      errorCode,
      errorTitle,
      pricingCategory,
      pricingType,
      at: readWhatsappTimestamp(raw.timestamp),
    })
  }
}

function readUserPreferences(
  wabaId: string,
  value: Record<string, unknown>,
  push: (event: WhatsappWebhookEvent) => void,
  fail: () => void
) {
  const metadata = isRecord(value.metadata) ? value.metadata : {}
  const phoneNumberId = readNumericId(metadata.phone_number_id)

  if (!phoneNumberId) {
    fail()
    return
  }

  for (const raw of readArray(value.user_preferences, WHATSAPP_WEBHOOK_MAX_ITEMS_PER_CHANGE)) {
    if (!isRecord(raw)) {
      fail()
      continue
    }

    const contactWaId = readNumericId(raw.wa_id, 20)
    const category = readText(raw.category, 40)

    // Hoje a Meta só entrega `marketing_messages`. Categoria desconhecida é
    // descartada: não vamos adivinhar o que ela quer dizer.
    if (!contactWaId || category !== WHATSAPP_MARKETING_CATEGORY) {
      fail()
      continue
    }

    if (!isWhatsappUserPreferenceValue(raw.value)) {
      fail()
      continue
    }

    push({
      kind: "user_preference",
      wabaId,
      phoneNumberId,
      contactWaId,
      value: raw.value,
      detail: readText(raw.detail, 300),
      at: readWhatsappTimestamp(raw.timestamp),
    })
  }
}

/**
 * Lê o corpo do webhook e devolve só os eventos que este produto trata.
 * Nunca lança: corpo inválido vira `{ events: [], discarded: n }` e a rota
 * responde 200 — reentrega eterna de um payload quebrado não ajuda ninguém.
 */
export function readWhatsappWebhook(payload: unknown): WhatsappWebhookReadResult {
  const events: WhatsappWebhookEvent[] = []
  let discarded = 0

  const push = (event: WhatsappWebhookEvent) => {
    if (events.length < WHATSAPP_WEBHOOK_MAX_EVENTS) {
      events.push(event)
    }
  }
  const fail = () => {
    discarded += 1
  }

  if (!isRecord(payload) || payload.object !== "whatsapp_business_account") {
    return { events, discarded: 1 }
  }

  for (const entry of readArray(payload.entry, WHATSAPP_WEBHOOK_MAX_ENTRIES)) {
    if (!isRecord(entry)) {
      fail()
      continue
    }

    // `entry[].id` é o id da WABA: é a nossa chave de imobiliária.
    const wabaId = readNumericId(entry.id)

    if (!wabaId) {
      fail()
      continue
    }

    for (const change of readArray(entry.changes, WHATSAPP_WEBHOOK_MAX_ENTRIES)) {
      if (!isRecord(change) || !isRecord(change.value)) {
        fail()
        continue
      }

      const field = readText(change.field, 60)
      const value = change.value

      if (field === "messages") {
        readMessages(wabaId, value, push, fail)
        continue
      }

      if (field === "user_preferences") {
        readUserPreferences(wabaId, value, push, fail)
        continue
      }

      if (field === "phone_number_quality_update") {
        push({
          kind: "quality",
          wabaId,
          displayPhoneNumber: readText(value.display_phone_number, 30),
          phoneNumberId: readNumericId(value.phone_number_id),
          event: readText(value.event, 60),
          currentLimit: readText(value.current_limit, 40),
        })
        continue
      }

      // Campo que não tratamos ainda (account_update, templates, etc.):
      // não é erro, é só fora de escopo — e por isso não conta como descarte.
    }
  }

  return { events, discarded }
}

/**
 * Chave de idempotência do evento. A Meta reentrega quando não recebe 200 a
 * tempo, e a mesma entrega pode chegar com o corpo serializado de outro jeito —
 * por isso a chave é do EVENTO, nunca o hash do corpo.
 */
export function whatsappWebhookEventKey(event: WhatsappWebhookEvent): string {
  switch (event.kind) {
    case "message":
      return `msg:${event.wamid}`
    case "status":
      // O mesmo wamid passa por sent, delivered e read: o estado entra na chave.
      return `st:${event.wamid}:${event.status}:${event.errorCode ?? ""}`
    case "user_preference":
      return `pref:${event.phoneNumberId}:${event.contactWaId}:${event.value}:${event.at ?? ""}`
    case "quality":
      return `qual:${event.wabaId}:${event.displayPhoneNumber ?? event.phoneNumberId ?? ""}:${event.event ?? ""}:${event.currentLimit ?? ""}`
  }
}
