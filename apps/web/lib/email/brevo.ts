import "server-only"

import { randomUUID } from "node:crypto"

import {
  classifyBrevoResponse,
  normalizeEmailTags,
  readBrevoErrorCode,
} from "@workspace/core/email/delivery"
import { cleanText, isUuid } from "@workspace/core/email/sanitize"

import { normalizeRecipient } from "@/lib/email/address"
import type { EmailSender } from "@/lib/email/config"
import type { EmailAddress, EmailMessage, EmailProvider, EmailSendResult } from "@/lib/email/types"

/** Host fixo: a chave nunca segue para outro destino (sem redirecionamento). */
const BREVO_API_ORIGIN = "https://api.brevo.com"
const SEND_PATH = "/v3/smtp/email"
const DEFAULT_TIMEOUT_MS = 10_000
const RETRY_DELAY_MS = 750
const MAX_RESPONSE_CHARS = 16_384

export type BrevoProviderOptions = {
  apiKey: string
  sender: EmailSender | null
  replyTo?: EmailAddress | null
  timeoutMs?: number
  /** Para testes. */
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function isTimeout(error: unknown) {
  const name = typeof error === "object" && error !== null && "name" in error ? error.name : null
  return name === "TimeoutError" || name === "AbortError"
}

async function readResponseBody(response: Response): Promise<unknown> {
  try {
    const raw = (await response.text()).slice(0, MAX_RESPONSE_CHARS)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const MAX_ATTACHMENTS = 3
/** Anexos só para convites e afins: acima disso, algo está errado. */
const MAX_ATTACHMENT_BYTES = 256 * 1024
const ATTACHMENT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,80}\.(ics|pdf|txt|csv)$/i

/**
 * Anexos no formato da API (`attachment: [{ name, content }]`, conteúdo em
 * base64). Extensões limitadas às que a Brevo aceita e que o CRM usa; nome e
 * tamanho validados. https://developers.brevo.com/reference/sendtransacemail
 */
function normalizeAttachments(attachments: EmailMessage["attachments"]) {
  const result: { name: string; content: string }[] = []

  for (const attachment of attachments ?? []) {
    if (result.length === MAX_ATTACHMENTS) {
      break
    }

    if (
      typeof attachment?.name !== "string" ||
      typeof attachment.content !== "string" ||
      !ATTACHMENT_NAME_PATTERN.test(attachment.name)
    ) {
      continue
    }

    const bytes = Buffer.from(attachment.content, "utf8")

    if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES) {
      continue
    }

    result.push({ name: attachment.name, content: bytes.toString("base64") })
  }

  return result
}

/** Só status e código da Brevo: nunca destinatário, corpo ou chave. */
function logFailure(detail: string) {
  console.error(`[email] Brevo: ${detail}`)
}

/**
 * API transacional da Brevo (POST https://api.brevo.com/v3/smtp/email), via fetch.
 * - `idempotencyKey` (UUID) igual nas duas tentativas: a Brevo não duplica o envio;
 * - timeout por tentativa (AbortSignal.timeout);
 * - no máximo 1 nova tentativa, só para 5xx ou timeout.
 */
export function createBrevoProvider(options: BrevoProviderOptions): EmailProvider {
  const endpoint = new URL(SEND_PATH, BREVO_API_ORIGIN)
  const fetchImpl = options.fetch ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    kind: "brevo",
    async send(message): Promise<EmailSendResult> {
      const sender = options.sender

      if (!sender) {
        return { ok: false, reason: "not_configured" }
      }

      const to = normalizeRecipient(message.to)

      if (!to) {
        return { ok: false, reason: "invalid_recipient" }
      }

      const subject = cleanText(message.subject, { maxLength: 200 })

      if (!subject || !message.html || !message.text) {
        logFailure("mensagem sem assunto ou corpo")
        return { ok: false, reason: "provider_error" }
      }

      const replyTo = normalizeRecipient(message.replyTo ?? options.replyTo)
      const tags = normalizeEmailTags(message.tags)
      const attachments = normalizeAttachments(message.attachments)
      const idempotencyKey = isUuid(message.idempotencyKey)
        ? message.idempotencyKey.toLowerCase()
        : randomUUID()
      const body = JSON.stringify({
        sender: { email: sender.email, name: sender.name },
        to: [to],
        subject,
        htmlContent: message.html,
        textContent: message.text,
        ...(replyTo ? { replyTo } : {}),
        ...(tags.length > 0 ? { tags } : {}),
        ...(attachments.length > 0 ? { attachment: attachments } : {}),
      })

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const canRetry = attempt === 1
        let response: Response

        try {
          response = await fetchImpl(endpoint, {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
              "api-key": options.apiKey,
              idempotencyKey,
            },
            body,
            redirect: "error",
            cache: "no-store",
            signal: AbortSignal.timeout(timeoutMs),
          })
        } catch (error) {
          if (isTimeout(error)) {
            if (canRetry) {
              await sleep(RETRY_DELAY_MS)
              continue
            }

            logFailure("tempo esgotado")
            return { ok: false, reason: "provider_error" }
          }

          logFailure(
            `falha de conexão (${error instanceof Error ? error.name : "erro desconhecido"})`
          )
          return { ok: false, reason: "provider_error" }
        }

        const responseBody = await readResponseBody(response)
        const outcome = classifyBrevoResponse(response.status, responseBody)

        switch (outcome.kind) {
          case "sent":
            return { ok: true, messageId: outcome.messageId }
          case "duplicate":
            return { ok: true, messageId: null }
          case "retry":
            if (canRetry) {
              await sleep(RETRY_DELAY_MS)
              continue
            }

            logFailure(`indisponível (HTTP ${response.status})`)
            return { ok: false, reason: "provider_error" }
          case "failed": {
            const code = readBrevoErrorCode(responseBody)
            logFailure(
              `envio recusado (HTTP ${response.status}${code ? `, ${code}` : ""}): ${outcome.reason}`
            )
            return { ok: false, reason: outcome.reason }
          }
        }
      }

      return { ok: false, reason: "provider_error" }
    },
  }
}
