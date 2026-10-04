// Helpers do navegador para o service worker e os avisos no celular. Só rodam
// no cliente (chamados em efeitos e eventos): nada aqui toca em segredo.

import { SERVICE_WORKER_PATH } from "@/lib/auth/routes"

/**
 * Service worker mínimo do CRM (public/sw.js): só push, sem cache de páginas.
 * O caminho vem de lib/auth/routes.ts, que o mantém público no proxy.
 */
export const SERVICE_WORKER_URL = SERVICE_WORKER_PATH

export type PushSupport =
  /** Navegador sem Service Worker, Push API ou Notification API. */
  | "unsupported"
  /** iPhone/iPad fora do app na tela de início: o Safari só libera push lá. */
  | "ios-needs-home-screen"
  | "supported"

/** iPhone, iPod ou iPad (o iPadOS se apresenta como Mac com tela de toque). */
export function isAppleMobileDevice(): boolean {
  const ua = navigator.userAgent

  return (
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)
  )
}

/** Aberto como app instalado (tela de início ou janela própria). */
export function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function getPushSupport(): PushSupport {
  const hasApis =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window

  // WebKit: push só para web app adicionado à tela de início (iOS/iPadOS 16.4+).
  // https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
  if (isAppleMobileDevice() && !isStandaloneDisplay()) {
    return "ios-needs-home-screen"
  }

  return hasApis && window.isSecureContext ? "supported" : "unsupported"
}

/** Chave pública VAPID (base64url) no formato que o PushManager aceita. */
export function applicationServerKeyFrom(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = window.atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index)
  }

  return bytes
}

/** Registro do service worker (registra se ainda não houver). */
export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/")

  if (existing) {
    return existing
  }

  return navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: "/",
    updateViaCache: "none",
  })
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  const registration = await getServiceWorkerRegistration()
  return registration.pushManager.getSubscription()
}

/** Objeto simples (endpoint + chaves) para mandar a uma Server Action. */
export function serializePushSubscription(subscription: PushSubscription) {
  return subscription.toJSON() as {
    endpoint?: string
    keys?: Record<string, string>
  }
}

/**
 * Cancela a inscrição deste navegador. Devolve o endpoint cancelado (para o
 * servidor apagar o registro) ou null quando não havia inscrição. Use também
 * ao sair da conta num aparelho compartilhado.
 */
export async function unsubscribeThisDevice(): Promise<string | null> {
  if (!("serviceWorker" in navigator)) {
    return null
  }

  const registration = await navigator.serviceWorker.getRegistration("/")
  const subscription = await registration?.pushManager.getSubscription()

  if (!subscription) {
    return null
  }

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()

  return endpoint
}
