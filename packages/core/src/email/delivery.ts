// Regras puras de entrega pela API transacional da Brevo (POST /v3/smtp/email):
// como interpretar a resposta e normalizar tags. O envio (fetch, chave, retry)
// fica no app (apps/web/lib/email).

export type EmailFailureReason =
  | "not_configured"
  | "rate_limited"
  | "invalid_recipient"
  | "provider_error"
  /** Negado pela cota diária da plataforma antes de chamar o provedor (email/quota). */
  | "daily_quota"

export type BrevoResponseOutcome =
  | { kind: "sent"; messageId: string | null }
  /** Mesmo idempotencyKey já aceito nos últimos 30 min: o e-mail já saiu. */
  | { kind: "duplicate" }
  /** Falha temporária (5xx): pode tentar de novo com o mesmo idempotencyKey. */
  | { kind: "retry" }
  | { kind: "failed"; reason: EmailFailureReason }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Código de erro da Brevo (ex.: "invalid_parameter"), seguro para log; null se ausente. */
export function readBrevoErrorCode(body: unknown): string | null {
  const code = isRecord(body) ? body.code : null
  return typeof code === "string" && /^[a-z_]{1,64}$/.test(code) ? code : null
}

function mentionsRecipient(body: unknown) {
  const message = isRecord(body) ? body.message : null
  return typeof message === "string" && /e-?mail|recipient|\bto\b/i.test(message)
}

/**
 * Interpreta a resposta da Brevo:
 * - 2xx: enviado (messageId quando vier);
 * - 400 `duplicate_parameter`: idempotência (já enviado);
 * - 400 sobre destinatário/e-mail: invalid_recipient; outros 400: provider_error;
 * - 401/403: chave recusada ou IP/remetente não autorizado (not_configured);
 * - 402: sem créditos/cota diária do plano (rate_limited); 429: rate_limited;
 * - 5xx: retry.
 */
export function classifyBrevoResponse(status: number, body: unknown): BrevoResponseOutcome {
  if (status >= 200 && status < 300) {
    const messageId = isRecord(body) ? body.messageId : null

    return {
      kind: "sent",
      messageId: typeof messageId === "string" && messageId.length <= 256 ? messageId : null,
    }
  }

  if (status >= 400 && status < 500 && readBrevoErrorCode(body) === "duplicate_parameter") {
    return { kind: "duplicate" }
  }

  if (status >= 500) {
    return { kind: "retry" }
  }

  switch (status) {
    case 400:
      return {
        kind: "failed",
        reason: mentionsRecipient(body) ? "invalid_recipient" : "provider_error",
      }
    case 401:
    case 403:
      return { kind: "failed", reason: "not_configured" }
    case 402:
    case 429:
      return { kind: "failed", reason: "rate_limited" }
    default:
      return { kind: "failed", reason: "provider_error" }
  }
}

const MAX_TAGS = 10
const MAX_TAG_LENGTH = 50

/** Tags para os relatórios da Brevo: minúsculas, [a-z0-9_-], até 50 caracteres, até 10, sem repetição. */
export function normalizeEmailTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return []
  }

  const result: string[] = []

  for (const tag of tags) {
    if (typeof tag !== "string") {
      continue
    }

    const normalized = tag
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_TAG_LENGTH)

    if (normalized && !result.includes(normalized)) {
      result.push(normalized)
    }

    if (result.length === MAX_TAGS) {
      break
    }
  }

  return result
}
