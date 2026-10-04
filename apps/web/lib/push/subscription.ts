// Inscrição de push vinda do navegador (PushSubscription.toJSON()). Sem
// `server-only`: a validação é a mesma no servidor e no navegador.

/**
 * Serviços de push aceitos. O servidor faz POST no endpoint da inscrição, então
 * só vão endereços dos serviços dos navegadores (nunca uma URL qualquer):
 * - Chrome, Edge no Android, Samsung Internet, Opera e Brave: fcm.googleapis.com;
 * - Firefox: *.push.services.mozilla.com;
 * - Edge no Windows: *.notify.windows.com;
 * - Safari (macOS e app na tela de início do iPhone/iPad): *.push.apple.com
 *   (https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).
 */
const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com"]
const PUSH_SERVICE_DOMAINS = ["push.services.mozilla.com", "notify.windows.com", "push.apple.com"]

const MAX_ENDPOINT_LENGTH = 1024

/** 65 bytes (ponto P-256 não comprimido) em base64url sem padding. */
const P256DH_PATTERN = /^[A-Za-z0-9_-]{87}$/

/** 16 bytes em base64url sem padding. */
const AUTH_PATTERN = /^[A-Za-z0-9_-]{22}$/

export type PushSubscriptionInput = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) {
    return false
  }

  let url: URL

  try {
    url = new URL(endpoint)
  } catch {
    return false
  }

  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) {
    return false
  }

  const host = url.hostname.toLowerCase()

  return (
    PUSH_SERVICE_HOSTS.includes(host) ||
    PUSH_SERVICE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  )
}

function readKey(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== "string") {
    return null
  }

  // Alguns navegadores mandam base64 comum ou com padding: normaliza para base64url.
  const normalized = value.trim().replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")

  return pattern.test(normalized) ? normalized : null
}

/** Valida e normaliza a inscrição; null quando não serve para enviar push. */
export function parsePushSubscription(value: unknown): PushSubscriptionInput | null {
  if (typeof value !== "object" || value === null) {
    return null
  }

  const { endpoint, keys } = value as { endpoint?: unknown; keys?: unknown }

  if (typeof endpoint !== "string" || !isAllowedPushEndpoint(endpoint)) {
    return null
  }

  if (typeof keys !== "object" || keys === null) {
    return null
  }

  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown }
  const normalizedP256dh = readKey(p256dh, P256DH_PATTERN)
  const normalizedAuth = readKey(auth, AUTH_PATTERN)

  if (!normalizedP256dh || !normalizedAuth) {
    return null
  }

  return { endpoint, keys: { p256dh: normalizedP256dh, auth: normalizedAuth } }
}
