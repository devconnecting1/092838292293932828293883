import "server-only"

// Cliente HTTP da Graph API da Meta (WhatsApp Cloud API).
//
// Molde: lib/email/brevo.ts. As regras que importam aqui:
//   - Host fixo e caminho montado com `new URL`: o token nunca segue para outro
//     destino, e `redirect: "error"` impede redirecionamento.
//   - NUNCA lança: devolve `{ ok: true, ... }` ou `{ ok: false, reason }`. Uma
//     falha da Meta não pode derrubar uma tela nem um webhook.
//   - Log sem dado pessoal: só status HTTP e código de erro da Meta. Nada de
//     token, número do contato ou corpo da mensagem.
//   - Uma única nova tentativa, e só para 5xx ou timeout.
//
// Referências oficiais conferidas em 16/09/2026:
//   developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider
//   developers.facebook.com/docs/whatsapp/cloud-api/reference/registration
//   developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages

import {
  WHATSAPP_GRAPH_BASE_URL,
  WHATSAPP_GRAPH_VERSION,
  WHATSAPP_MESSAGING_LIMIT_FIELD,
} from "@workspace/core/whatsapp"

const DEFAULT_TIMEOUT_MS = 10_000
const RETRY_DELAY_MS = 750
const MAX_RESPONSE_CHARS = 16_384

export type GraphFailure = {
  ok: false
  /** Motivo curto e estável, para a tela traduzir. */
  reason:
    | "not_configured"
    | "invalid_response"
    | "unauthorized"
    | "rate_limited"
    | "meta_error"
    | "network"
  /** Código de erro da Meta, quando veio. */
  code: number | null
  /** Título do erro da Meta. Texto de terceiro: nunca vai cru para a tela. */
  title: string | null
}

export type GraphOptions = {
  /** Para testes. */
  fetch?: typeof fetch
  /** Para testes. */
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function logFailure(detail: string) {
  // Só operação, status e código da Meta. Nunca token, número ou corpo.
  console.error(`[whatsapp] Graph: ${detail}`)
}

async function readBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = (await response.text()).slice(0, MAX_RESPONSE_CHARS)

    if (!text) {
      return null
    }

    const parsed: unknown = JSON.parse(text)

    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function readMetaError(body: Record<string, unknown> | null): {
  code: number | null
  title: string | null
} {
  const error = body?.error

  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return { code: null, title: null }
  }

  const record = error as Record<string, unknown>
  const code = typeof record.code === "number" && Number.isFinite(record.code) ? record.code : null
  const title =
    typeof record.error_user_title === "string"
      ? record.error_user_title.slice(0, 300)
      : typeof record.message === "string"
        ? record.message.slice(0, 300)
        : null

  return { code, title }
}

function failureFromStatus(status: number, body: Record<string, unknown> | null): GraphFailure {
  const { code, title } = readMetaError(body)

  if (status === 401 || status === 403 || code === 190) {
    return { ok: false, reason: "unauthorized", code, title }
  }

  if (status === 429 || code === 80007) {
    return { ok: false, reason: "rate_limited", code, title }
  }

  return { ok: false, reason: "meta_error", code, title }
}

type GraphRequest = {
  operation: string
  path: string
  method: "GET" | "POST"
  token: string
  query?: Record<string, string>
  body?: Record<string, unknown>
}

async function request(
  input: GraphRequest,
  options: GraphOptions = {}
): Promise<{ ok: true; body: Record<string, unknown> } | GraphFailure> {
  const doFetch = options.fetch ?? fetch
  const sleep = options.sleep ?? delay
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // Host fixo: a credencial do cliente nunca segue para outro destino.
  const endpoint = new URL(`/${WHATSAPP_GRAPH_VERSION}${input.path}`, WHATSAPP_GRAPH_BASE_URL)

  for (const [name, value] of Object.entries(input.query ?? {})) {
    endpoint.searchParams.set(name, value)
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const canRetry = attempt === 1

    try {
      const response = await doFetch(endpoint, {
        method: input.method,
        headers: {
          Authorization: `Bearer ${input.token}`,
          ...(input.body ? { "Content-Type": "application/json" } : {}),
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      })

      const body = await readBody(response)

      if (response.ok) {
        return { ok: true, body: body ?? {} }
      }

      if (response.status >= 500 && canRetry) {
        await sleep(RETRY_DELAY_MS)
        continue
      }

      const failure = failureFromStatus(response.status, body)
      logFailure(`${input.operation} ${response.status} (meta ${failure.code ?? "sem código"})`)
      return failure
    } catch {
      if (canRetry) {
        await sleep(RETRY_DELAY_MS)
        continue
      }

      logFailure(`${input.operation} sem resposta`)
      return { ok: false, reason: "network", code: null, title: null }
    }
  }

  return { ok: false, reason: "network", code: null, title: null }
}

// ---------------------------------------------------------------------------
// Onboarding (Embedded Signup, Tech Provider)
// ---------------------------------------------------------------------------

export type ExchangeCodeResult =
  { ok: true; accessToken: string; expiresAt: string | null } | GraphFailure

/**
 * Troca o `code` do Embedded Signup pelo token do cliente.
 *
 * A Meta avisa que o code tem 30 SEGUNDOS de vida: a troca acontece no primeiro
 * passo da Server Action, antes de qualquer outra coisa.
 *
 * Este é o único ponto do produto que usa o app secret em chamada de saída.
 */
export async function exchangeEmbeddedSignupCode(
  code: string,
  appId: string,
  appSecret: string,
  options: GraphOptions = {}
): Promise<ExchangeCodeResult> {
  const doFetch = options.fetch ?? fetch
  const endpoint = new URL(`/${WHATSAPP_GRAPH_VERSION}/oauth/access_token`, WHATSAPP_GRAPH_BASE_URL)

  endpoint.searchParams.set("client_id", appId)
  endpoint.searchParams.set("client_secret", appSecret)
  endpoint.searchParams.set("code", code)

  try {
    const response = await doFetch(endpoint, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })

    const body = await readBody(response)

    if (!response.ok) {
      const failure = failureFromStatus(response.status, body)
      logFailure(`oauth/access_token ${response.status} (meta ${failure.code ?? "sem código"})`)
      return failure
    }

    const accessToken = typeof body?.access_token === "string" ? body.access_token : ""

    if (accessToken.length < 8) {
      logFailure("oauth/access_token sem access_token")
      return { ok: false, reason: "invalid_response", code: null, title: null }
    }

    const expiresIn = typeof body?.expires_in === "number" ? body.expires_in : null
    const expiresAt =
      expiresIn && Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null

    return { ok: true, accessToken, expiresAt }
  } catch {
    logFailure("oauth/access_token sem resposta")
    return { ok: false, reason: "network", code: null, title: null }
  }
}

/** Assina o app aos webhooks da WABA do cliente. */
export async function subscribeAppToWaba(
  wabaId: string,
  token: string,
  options: GraphOptions = {}
): Promise<{ ok: true } | GraphFailure> {
  const result = await request(
    { operation: "subscribed_apps", path: `/${wabaId}/subscribed_apps`, method: "POST", token },
    options
  )

  return result.ok ? { ok: true } : result
}

/**
 * Registra o número na Cloud API com um PIN de 6 dígitos (2FA).
 * O PIN é gerado pelo servidor e guardado no `metadata` da conexão — sem ele,
 * um re-registro futuro fica travado.
 */
export async function registerPhoneNumber(
  phoneNumberId: string,
  token: string,
  pin: string,
  options: GraphOptions = {}
): Promise<{ ok: true } | GraphFailure> {
  const result = await request(
    {
      operation: "register",
      path: `/${phoneNumberId}/register`,
      method: "POST",
      token,
      body: { messaging_product: "whatsapp", pin },
    },
    options
  )

  return result.ok ? { ok: true } : result
}

export type PhoneNumberInfo = {
  displayPhoneNumber: string | null
  verifiedName: string | null
  qualityRating: string | null
  messagingTier: string | null
  throughput: number | null
}

/** Lê o estado do número: nome verificado, qualidade e limite de envio. */
export async function fetchPhoneNumber(
  phoneNumberId: string,
  token: string,
  options: GraphOptions = {}
): Promise<{ ok: true; info: PhoneNumberInfo } | GraphFailure> {
  const result = await request(
    {
      operation: "phone_number",
      path: `/${phoneNumberId}`,
      method: "GET",
      token,
      query: {
        // `messaging_limit_tier` está depreciado: o campo vigente é o do portfólio.
        fields: [
          "display_phone_number",
          "verified_name",
          "quality_rating",
          "throughput",
          WHATSAPP_MESSAGING_LIMIT_FIELD,
        ].join(","),
      },
    },
    options
  )

  if (!result.ok) {
    return result
  }

  const body = result.body
  // `throughput` já veio como número e, em versões mais novas, como objeto
  // `{ level }`. Só o número interessa aqui; qualquer outra forma vira null em
  // vez de virar um palpite.
  const throughput = typeof body.throughput === "number" ? Math.trunc(body.throughput) : null
  const tier = body[WHATSAPP_MESSAGING_LIMIT_FIELD]

  return {
    ok: true,
    info: {
      displayPhoneNumber:
        typeof body.display_phone_number === "string"
          ? body.display_phone_number.slice(0, 30)
          : null,
      verifiedName:
        typeof body.verified_name === "string" ? body.verified_name.slice(0, 200) : null,
      qualityRating: typeof body.quality_rating === "string" ? body.quality_rating : null,
      messagingTier: typeof tier === "string" ? tier : null,
      throughput,
    },
  }
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

export type SendResult =
  | {
      ok: true
      wamid: string
      /**
       * `accepted` | `held_for_quality_assessment` | `paused`, só em template.
       * Nenhum deles significa entrega.
       */
      messageStatus: string | null
    }
  | GraphFailure

/**
 * Manda uma mensagem de texto dentro da janela de 24 h.
 *
 * A Meta é literal: "This response only indicates that the API successfully
 * accepted your request — it does not indicate successful delivery of your
 * message." Por isso o retorno se chama `wamid` e não `deliveredId`, e quem
 * grava o estado usa `accepted`, nunca `delivered`.
 */
export async function sendWhatsappText(
  input: { phoneNumberId: string; token: string; to: string; body: string },
  options: GraphOptions = {}
): Promise<SendResult> {
  const result = await request(
    {
      operation: "messages",
      path: `/${input.phoneNumberId}/messages`,
      method: "POST",
      token: input.token,
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "text",
        text: { preview_url: false, body: input.body },
      },
    },
    options
  )

  if (!result.ok) {
    return result
  }

  const messages = result.body.messages

  if (!Array.isArray(messages) || messages.length === 0) {
    logFailure("messages sem wamid na resposta")
    return { ok: false, reason: "invalid_response", code: null, title: null }
  }

  const first = messages[0]
  const record =
    typeof first === "object" && first !== null ? (first as Record<string, unknown>) : {}
  const wamid = typeof record.id === "string" ? record.id.slice(0, 200) : ""

  if (!wamid) {
    logFailure("messages sem wamid na resposta")
    return { ok: false, reason: "invalid_response", code: null, title: null }
  }

  return {
    ok: true,
    wamid,
    messageStatus: typeof record.message_status === "string" ? record.message_status : null,
  }
}
